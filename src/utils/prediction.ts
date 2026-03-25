/**
 * prediction.ts — 頂底預測（Generation 3.0）
 * 
 * 架構：「微觀訂單流與動態矩陣」
 * 
 * 核心進化：
 * 1. ATR 動態閾值（市場波動感知）
 * 2. FVG 檢測與否決（流動性真空）
 * 3. POI 狀態機（Fresh/Mitigated）
 * 4. 增強評分機制
 * 
 * 評分：滿分 100+ 分，閾值動態調整
 * 概率：動態 Sigmoid 映射
 */

import { StockData, PredictionResult, TechnicalIndicators } from '../types';
import { calculateAllIndicators } from './indicators';
import { detectSFP, SFPMatch } from './sfp';
import { detectCHOCH, detectTrendChange, CHOCHMatch } from './choch';
import { detectCVDBreach, CVDBreach } from './cvd';
import { detectPOI, POIMatch } from './poi';
import { detectFVG, checkFVGStatus, calculateATR, calculateATRPercent } from './fvg';
import { POIManager, poiManager } from './poi-state';

// 追蹤當前分析的標的
let currentSymbol = '';

/**
 * 設定當前分析的股票標的（調用預測前必須設定）
 */
export function setPredictionSymbol(symbol: string): void {
  if (currentSymbol !== symbol) {
    currentSymbol = symbol;
    poiManager.setSymbol(symbol);
  }
}

/**
 * 初始化 POI 系統（從 IndexedDB 載入）
 */
export async function initPredictionSystem(symbol: string): Promise<void> {
  currentSymbol = symbol;
  await poiManager.init(symbol);
}

export function predictTopBottom(data: StockData[]): PredictionResult {
  // 需要足夠歷史數據
  if (!data || data.length < 65) {
    return {
      type: 'neutral',
      probability: 0,
      signals: [],
      recommendation: '數據不足，無法預測',
    };
  }

  const cur = data[data.length - 1];
  if (!cur || !cur.close || !cur.high || !cur.low) {
    return {
      type: 'neutral',
      probability: 0,
      signals: [],
      recommendation: '數據不完整，無法預測',
    };
  }

  const indicators = calculateAllIndicators(data);
  const atrPercent = calculateATRPercent(data);
  const fvgStatus = checkFVGStatus(data);

  // 首次調用時從歷史數據初始化 POI
  if (poiManager.getAllPOIs().length === 0 && data.length > 30) {
    poiManager.initFromHistory(data);
  }

  // ══════════════════════════════════════════════════════════════
  //  1. 動態閾值計算（基於 ATR）
  // ══════════════════════════════════════════════════════════════
  
  const dynamicThreshold = calculateDynamicThreshold(atrPercent);
  const strongThreshold = dynamicThreshold + 20;

  // ══════════════════════════════════════════════════════════════
  //  2. 前置否決條件（Veto Filters）—— 此时尚未评分，仅检查趋势/FVG方向
  // ══════════════════════════════════════════════════════════════
  
  const vetoResult = checkVetoFilters(data, indicators, fvgStatus, 0, 0, true);
  if (vetoResult.vetoed) {
    return {
      type: 'neutral',
      probability: 0,
      signals: [vetoResult.reason],
      recommendation: vetoResult.reason,
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  3. POI 狀態更新
  // ══════════════════════════════════════════════════════════════
  
  poiManager.updateStates(cur.close);
  const poiProximity = poiManager.checkProximity(cur.close);

  // ══════════════════════════════════════════════════════════════
  //  4. 多因子評分
  // ══════════════════════════════════════════════════════════════

  let topScore = 0;
  let bottomScore = 0;
  const signals: string[] = [];
  let sfpMatch: SFPMatch | null = null;
  let chochMatch: CHOCHMatch | null = null;
  let cvdMatch: CVDBreach | null = null;
  let poiMatch: POIMatch | null = null;
  let fvgMatch = false;

  // 4.1 SFP (假突破) — 最高 35 分
  sfpMatch = detectSFP(data);
  if (sfpMatch) {
    if (sfpMatch.type === 'top') {
      topScore += sfpMatch.strength;
    } else {
      bottomScore += sfpMatch.strength;
    }
    signals.push(`【SFP】${sfpMatch.reason}`);
  }

  // 4.2 CHOCH (結構轉變) — 最高 30 分
  if (sfpMatch) {
    chochMatch = detectCHOCH(data, sfpMatch.type);
  }
  if (!chochMatch) {
    chochMatch = detectTrendChange(data);
  }
  
  if (chochMatch) {
    // 加強：如果有成交量配合
    let chochScore = chochMatch.strength;
    if (cur.volume > indicators.poc * 0.5) {
      chochScore = Math.min(30, chochScore + 5); // 最多加 5 分
      signals.push(`【CHOCH】${chochMatch.reason}（帶量確認）`);
    } else {
      signals.push(`【CHOCH】${chochMatch.reason}`);
    }
    
    if (chochMatch.type === 'top') {
      topScore += chochScore;
    } else {
      bottomScore += chochScore;
    }
  }

  // 4.3 CVD (成交量背離) — 最高 20 分
  cvdMatch = detectCVDBreach(data);
  if (cvdMatch) {
    if (cvdMatch.type === 'top') {
      topScore += cvdMatch.strength;
    } else {
      bottomScore += cvdMatch.strength;
    }
    signals.push(`【CVD】${cvdMatch.reason}`);
  }

  // 4.4 FVG 檢測 — 最高 15 分
  const fvgs = detectFVG(data, 3);
  if (fvgs.length > 0) {
    const latestFVG = fvgs[0];
    fvgMatch = true;
    signals.push(`【FVG】${latestFVG.reason}`);
    
    // FVG 對信號的增強
    if (latestFVG.type === 'bullish' && bottomScore > topScore) {
      bottomScore += latestFVG.strength; // 底部 + FVG 上漲動能
    }
    if (latestFVG.type === 'bearish' && topScore > bottomScore) {
      topScore += latestFVG.strength; // 頂部 + FVG 下跌動能
    }
  }

  // 4.5 POI 狀態加成 — 最高 15 分
  if (poiProximity.hasSupport || poiProximity.hasResistance) {
    if (poiProximity.hasSupport && bottomScore > topScore) {
      bottomScore += poiProximity.supportStrength;
      signals.push(`【POI】臨近支撐位，強度 ${poiProximity.supportStrength}`);
    }
    if (poiProximity.hasResistance && topScore > bottomScore) {
      topScore += poiProximity.resistanceStrength;
      signals.push(`【POI】臨近阻力位，強度 ${poiProximity.resistanceStrength}`);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  4.6 波動率加成（高波動市場降低閾值但增加權重）
  // ══════════════════════════════════════════════════════════════
  if (atrPercent > 2) {
    const volBonus = Math.min(10, Math.round(atrPercent));
    if (bottomScore > 0) bottomScore += volBonus;
    if (topScore > 0) topScore += volBonus;
    signals.push(`【VOL】高波動市場，權重加成 +${volBonus}`);
  }

  // ══════════════════════════════════════════════════════════════
  //  4.7 二次否決：評分完成後，用真實分數再次過濾 FVG 方向衝突
  // ══════════════════════════════════════════════════════════════
  const vetoResult2 = checkVetoFilters(data, indicators, fvgStatus, topScore, bottomScore);
  if (vetoResult2.vetoed) {
    return {
      type: 'neutral',
      probability: 0,
      signals: [...signals, vetoResult2.reason],
      recommendation: vetoResult2.reason,
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  5. 判定邏輯（動態閾值）
  // ══════════════════════════════════════════════════════════════

  // 計算動態 Sigmoid 概率
  const sigmoid = (score: number) => {
    // 根據 ATR 調整曲線
    const k = atrPercent > 2 ? 0.12 : 0.15; // 高波動時曲線更平滑
    return 1 / (1 + Math.exp(-k * (score - dynamicThreshold)));
  };

  let finalType: 'top' | 'bottom' | 'neutral' = 'neutral';
  let probability = 0;
  let recommendation = '';

  if (topScore > bottomScore && topScore >= dynamicThreshold) {
    finalType = 'top';
    probability = sigmoid(topScore);
    
    if (topScore >= strongThreshold && probability > 0.80) {
      recommendation = buildRecommendation('top', topScore, sfpMatch !== null, chochMatch !== null, fvgMatch);
    } else {
      recommendation = '潛在頂部信號，觀察為主';
    }
  } else if (bottomScore > topScore && bottomScore >= dynamicThreshold) {
    finalType = 'bottom';
    probability = sigmoid(bottomScore);
    
    if (bottomScore >= strongThreshold && probability > 0.80) {
      recommendation = buildRecommendation('bottom', bottomScore, sfpMatch !== null, chochMatch !== null, fvgMatch);
    } else {
      recommendation = '潛在底部信號，觀察為主';
    }
  } else {
    return {
      type: 'neutral',
      probability: 0,
      signals: signals.length > 0 ? signals : ['未檢測到明顯信號'],
      recommendation: '市場無明確方向，保持觀望',
    };
  }

  return {
    type: finalType,
    probability,
    signals,
    recommendation,
  };
}

// ══════════════════════════════════════════════════════════════
//  動態閾值計算
// ══════════════════════════════════════════════════════════════

function calculateDynamicThreshold(atrPercent: number): number {
  // 基礎閾值 55
  const baseThreshold = 55;
  
  // 低波動市場（ATR < 1%）→ 提高閾值，減少雜訊
  if (atrPercent < 1) {
    return baseThreshold + 10; // 65
  }
  
  // 高波動市場（ATR > 2.5%）→ 降低閾值，更敏感
  if (atrPercent > 2.5) {
    return baseThreshold - 8; // 47
  }
  
  return baseThreshold;
}

// ══════════════════════════════════════════════════════════════
//  Veto Filters — 強制過濾
// ══════════════════════════════════════════════════════════════

function checkVetoFilters(
  data: StockData[], 
  indicators: TechnicalIndicators,
  fvgStatus: ReturnType<typeof checkFVGStatus>,
  topScore: number,
  bottomScore: number,
  preScoring: boolean = false,
): { vetoed: boolean; reason: string } {
  const cur = data[data.length - 1];

  // 1. 強趨勢過濾
  if (indicators.adx > 35) {
    if (indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ma20) {
      return {
        vetoed: true,
        reason: '強上升趨勢中，逆勢摸底風險極高',
      };
    }
    if (indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ma20) {
      return {
        vetoed: true,
        reason: '強下降趨勢中，逆勢摸頂風險極高',
      };
    }
  }

  // 2. FVG 否決（正在填補 FVG 時禁止逆勢）— 需要真實分數，預評分階段跳過
  if (!preScoring && fvgStatus.filling) {
    if (fvgStatus.direction === 'bullish' && bottomScore > topScore) {
      return {
        vetoed: true,
        reason: '價格正在填補向上 FVG，逆勢做空危險',
      };
    }
    if (fvgStatus.direction === 'bearish' && topScore > bottomScore) {
      return {
        vetoed: true,
        reason: '價格正在填補向下 FVG，逆勢做多危險',
      };
    }
  }

  // 3. 價格已跌穿支撐或突破阻力超過 5%，結構已破壞 — 需要真實分數，預評分階段跳過
  if (preScoring) return { vetoed: false, reason: '' };
  const { highs, lows } = findRecentHighLow(data, 60);

  if (lows.length > 0) {
    const nearestLow = lows[lows.length - 1].price;
    const distToLow = (cur.close - nearestLow) / nearestLow;
    // 跌穿支撐超過 5% 且底部信號 → 結構已破，否決
    if (distToLow < -0.05 && bottomScore > topScore) {
      return {
        vetoed: true,
        reason: `已跌穿支撐位 ${Math.abs(distToLow * 100).toFixed(1)}%，底部信號無效`,
      };
    }
  }

  if (highs.length > 0) {
    const nearestHigh = highs[0].price;
    const distToHigh = (cur.close - nearestHigh) / nearestHigh;
    // 突破阻力超過 5% 且頂部信號 → 強勢突破中，否決
    if (distToHigh > 0.05 && topScore > bottomScore) {
      return {
        vetoed: true,
        reason: `已突破阻力位 ${(distToHigh * 100).toFixed(1)}%，頂部信號無效`,
      };
    }
  }

  return { vetoed: false, reason: '' };
}

function findRecentHighLow(data: StockData[], lookback: number) {
  const highs: { price: number; idx: number }[] = [];
  const lows: { price: number; idx: number }[] = [];

  const start = Math.max(10, data.length - lookback);
  
  for (let i = start; i < data.length - 2; i++) {
    if (!data[i] || data[i].high === undefined || data[i].low === undefined) continue;

    let isHigh = true;
    for (let j = 1; j <= 3; j++) {
      if (!data[i-j] || !data[i+j] || data[i].high <= data[i-j].high || data[i].high <= data[i+j].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) highs.push({ price: data[i].high, idx: i });

    let isLow = true;
    for (let j = 1; j <= 3; j++) {
      if (!data[i-j] || !data[i+j] || data[i].low >= data[i-j].low || data[i].low >= data[i+j].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) lows.push({ price: data[i].low, idx: i });
  }

  return { highs, lows };
}

// ══════════════════════════════════════════════════════════════
//  建議文案
// ══════════════════════════════════════════════════════════════

function buildRecommendation(
  type: 'top' | 'bottom',
  score: number,
  hasSFP: boolean,
  hasCHOCH: boolean,
  hasFVG: boolean,
): string {
  const hasAll = hasSFP && hasCHOCH && hasFVG;
  
  if (type === 'top') {
    if (hasAll) {
      return '【強烈頂部】SFP + CHOCH + FVG 三重確認，80%+ 概率反轉，建議減倉';
    }
    if (hasSFP && hasCHOCH) {
      return '【頂部確認】SFP 假突破 + CHOCH 結構轉變，較高概率反轉';
    }
    return '【頂部觀察】技術面顯示潛在頂部，建議謹慎';
  } else {
    if (hasAll) {
      return '【強烈底部】SFP + CHOCH + FVG 三重確認，80%+ 概率反彈，可分批布局';
    }
    if (hasSFP && hasCHOCH) {
      return '【底部確認】SFP 假突破 + CHOCH 結構轉變，較高概率反彈';
    }
    return '【底部觀察】技術面顯示潛在底部，建議謹慎';
  }
}
