/**
 * poi.ts — Point of Interest (興趣區) + 大級別共振
 * 
 * 核心邏輯：信號發生在重要支撐/阻力區域時，勝率大幅提升
 * 包括：Order Block、VAH/VAL、重要高低點、斐波那契回撤位
 */

import { StockData, TechnicalIndicators } from '../types';
import { calculateAllIndicators } from './indicators';

export interface POIMatch {
  type: 'support' | 'resistance';
  level: number;         // 支撐/阻力位價格
  distance: number;      // 距離當前價格的百分比
  strength: number;       // 0-15 分
  reason: string;
}

/**
 * 檢測當前價格是否在重要支撐/阻力區域
 * @param data 歷史 K 線數據
 * @param indicators 技術指標（包含 VAH/VAL/POC）
 */
export function detectPOI(data: StockData[], indicators: TechnicalIndicators): POIMatch | null {
  if (data.length < 30) return null;

  const cur = data[data.length - 1];
  const close = cur.close;

  const pois: POIMatch[] = [];

  // 1. Volume Profile 興趣區（VAH/VAL）
  if (indicators.valueAreaHigh > 0 && indicators.valueAreaLow > 0) {
    const distToVAH = Math.abs(close - indicators.valueAreaHigh) / close;
    const distToVAL = Math.abs(close - indicators.valueAreaLow) / close;
    const distToPOC = Math.abs(close - indicators.poc) / close;

    // 價格在 VAH 附近 → 阻力
    if (distToVAH < 0.02) {
      pois.push({
        type: 'resistance',
        level: indicators.valueAreaHigh,
        distance: distToVAH,
        strength: 12,
        reason: `接近 VAH 阻力位 $${indicators.valueAreaHigh.toFixed(2)}`,
      });
    }
    
    // 價格在 VAL 附近 → 支撐
    if (distToVAL < 0.02) {
      pois.push({
        type: 'support',
        level: indicators.valueAreaLow,
        distance: distToVAL,
        strength: 12,
        reason: `接近 VAL 支撐位 $${indicators.valueAreaLow.toFixed(2)}`,
      });
    }

    // 價格偏離 POC
    if (distToPOC > 0.03) {
      pois.push({
        type: close > indicators.poc ? 'resistance' : 'support',
        level: indicators.poc,
        distance: distToPOC,
        strength: 8,
        reason: `偏離 POC $${indicators.poc.toFixed(2)}，均值回歸機會`,
      });
    }
  }

  // 2. 布林帶邊界
  if (indicators.bollUp > 0) {
    const distToUpper = Math.abs(close - indicators.bollUp) / close;
    const distToLower = Math.abs(close - indicators.bollDn) / close;

    if (distToUpper < 0.015) {
      pois.push({
        type: 'resistance',
        level: indicators.bollUp,
        distance: distToUpper,
        strength: 10,
        reason: `接近布林上軌 $${indicators.bollUp.toFixed(2)}`,
      });
    }
    
    if (distToLower < 0.015) {
      pois.push({
        type: 'support',
        level: indicators.bollDn,
        distance: distToLower,
        strength: 10,
        reason: `接近布林下軌 $${indicators.bollDn.toFixed(2)}`,
      });
    }
  }

  // 3. 歷史高低點（Scan 30-60 根 K 線）
  const { highs, lows } = findSwingPoints(data, 30);
  
  for (const h of highs) {
    const dist = Math.abs(close - h.price) / close;
    if (dist < 0.025) { // 2.5% 內
      pois.push({
        type: 'resistance',
        level: h.price,
        distance: dist,
        strength: 15,
        reason: `接近歷史高點 $${h.price.toFixed(2)}`,
      });
      break;
    }
  }
  
  for (const l of lows) {
    const dist = Math.abs(close - l.price) / close;
    if (dist < 0.025) {
      pois.push({
        type: 'support',
        level: l.price,
        distance: dist,
        strength: 15,
        reason: `接近歷史低點 $${l.price.toFixed(2)}`,
      });
      break;
    }
  }

  // 4. EMA 密集區
  const emaLevels = [
    { price: indicators.ema9, name: 'EMA9' },
    { price: indicators.ema21, name: 'EMA21' },
  ];
  
  for (const ema of emaLevels) {
    if (!ema.price || ema.price <= 0) continue;
    const dist = Math.abs(close - ema.price) / close;
    if (dist < 0.01) { // 1% 內
      pois.push({
        type: close > ema.price ? 'support' : 'resistance',
        level: ema.price,
        distance: dist,
        strength: 6,
        reason: `接近 ${ema.name} $${ema.price.toFixed(2)}`,
      });
    }
  }

  // 返回最強的 POI
  if (pois.length > 0) {
    pois.sort((a, b) => b.strength - a.strength);
    return pois[0];
  }

  return null;
}

/**
 * 尋找波段高低點
 */
function findSwingPoints(
  data: StockData[], 
  lookback: number
): { highs: { price: number; idx: number }[]; lows: { price: number; idx: number }[] } {
  const highs: { price: number; idx: number }[] = [];
  const lows: { price: number; idx: number }[] = [];

  const start = Math.max(5, data.length - lookback);
  
  for (let i = start; i < data.length - 5; i++) {
    // 局部高點
    let isHigh = true;
    for (let j = 1; j <= 4; j++) {
      if (data[i].high <= data[i-j].high || data[i].high <= data[i+j].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) {
      highs.push({ price: data[i].high, idx: i });
    }

    // 局部低點
    let isLow = true;
    for (let j = 1; j <= 4; j++) {
      if (data[i].low >= data[i-j].low || data[i].low >= data[i+j].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      lows.push({ price: data[i].low, idx: i });
    }
  }

  return { highs, lows };
}

/**
 * 計算斐波那契回撤位
 */
export function calculateFibonacci(high: number, low: number): number[] {
  const diff = high - low;
  return [
    high,                                    // 0%
    high - diff * 0.236,                    // 23.6%
    high - diff * 0.382,                     // 38.2%
    high - diff * 0.5,                       // 50%
    high - diff * 0.618,                     // 61.8%
    high - diff * 0.786,                     // 78.6%
    low,                                     // 100%
  ];
}
