/**
 * cvd.ts — Cumulative Volume Delta (成交量 delta 背離)
 * 
 * 核心邏輯：價格創出新高/新低，但成交量/Delta 沒有跟隨
 * 這代表沒有真實買盤/賣盤支撐，可能是假突破
 */

import { StockData } from '../types';

export interface CVDBreach {
  type: 'top' | 'bottom';
  priceLevel: number;      // 價格新高/低的水平
  volumeStrength: number;   // 成交量異常程度 0-20
  strength: number;          // 0-20 分
  reason: string;
}

/**
 * 檢測成交量背離
 * @param data 歷史 K 線數據
 */
export function detectCVDBreach(data: StockData[]): CVDBreach | null {
  if (data.length < 20) return null;

  const cur = data[data.length - 1];
  const prev = data[data.length - 2];
  
  // 找近期最高/最低點
  let highestPrice = -Infinity;
  let lowestPrice = Infinity;
  let highestVolume = -Infinity;
  let volumeAtHigh = 0;
  let volumeAtLow = 0;
  
  for (let i = data.length - 20; i < data.length; i++) {
    if (data[i].high > highestPrice) {
      highestPrice = data[i].high;
      highestVolume = data[i].volume;
      volumeAtHigh = data[i].volume;
    }
    if (data[i].low < lowestPrice) {
      lowestPrice = data[i].low;
      volumeAtLow = data[i].volume;
    }
  }

  // 計算平均成交量
  const avgVolume = data.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;

  // 價格創出新低，但成交量異常放大 → 恐慌拋售，可能是底部
  if (cur.close < lowestPrice * 1.005) {
    const volumeRatio = cur.volume / avgVolume;
    
    // 巨量下跌（恐慌盤）= 潛在底部
    if (volumeRatio > 1.8) {
      return {
        type: 'bottom',
        priceLevel: lowestPrice,
        volumeStrength: volumeRatio,
        strength: Math.min(20, 10 + Math.round(volumeRatio * 5)),
        reason: `巨量下跌（${volumeRatio.toFixed(1)}x 均量），恐慌盤湧出`,
      };
    }
    
    // 價格新低但成交量萎縮 → 背離，可能見底
    if (volumeRatio < 0.7) {
      return {
        type: 'bottom',
        priceLevel: lowestPrice,
        volumeStrength: volumeRatio,
        strength: 18,
        reason: '價格新低但成交量萎縮，賣壓衰竭',
      };
    }
  }

  // 價格創出新高，但成交量沒有跟隨 → 背離，可能是頂部
  if (cur.close > highestPrice * 0.995) {
    const volumeRatio = cur.volume / avgVolume;
    
    // 價格新高但成交量低於平均 → 量價背離
    if (volumeRatio < 0.8) {
      return {
        type: 'top',
        priceLevel: highestPrice,
        volumeStrength: volumeRatio,
        strength: 20,
        reason: '價格新高但成交量萎縮，量價背離',
      };
    }
  }

  // 檢查當前 K 線的成交量異常
  const currentVolRatio = cur.volume / avgVolume;
  
  // 爆量長影線（主力接盤跡象）
  const upperWick = cur.high - Math.max(cur.close, cur.open);
  const lowerWick = Math.min(cur.close, cur.open) - cur.low;
  const body = Math.abs(cur.close - cur.open);
  
  if (upperWick > body * 2 && currentVolRatio > 1.5) {
    return {
      type: 'top',
      priceLevel: cur.high,
      volumeStrength: currentVolRatio,
      strength: 15,
      reason: '爆量長上影線，上漲乏力',
    };
  }
  
  if (lowerWick > body * 2 && currentVolRatio > 1.5) {
    return {
      type: 'bottom',
      priceLevel: cur.low,
      volumeStrength: currentVolRatio,
      strength: 15,
      reason: '爆量長下影線，主動接盤',
    };
  }

  return null;
}

/**
 * 計算簡單的 Volume Delta（需要 Tick 數據，這裡用價格漲跌近似）
 */
export function calculateSimpleDelta(data: StockData[]): number[] {
  const deltas: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    const close = data[i].close;
    const prevClose = data[i-1].close;
    const volume = data[i].volume;
    
    // 上漲時視為買盤 delta，下跌時視為賣盤 delta
    const delta = close > prevClose ? volume : -volume;
    deltas.push(delta);
  }
  
  return deltas;
}

/**
 * 計算 Cumulative Volume Delta
 */
export function calculateCVD(data: StockData[]): number[] {
  const deltas = calculateSimpleDelta(data);
  const cvd: number[] = [];
  let cumulative = 0;
  
  for (const d of deltas) {
    cumulative += d;
    cvd.push(cumulative);
  }
  
  return cvd;
}
