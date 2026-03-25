/**
 * fvg.ts — Fair Value Gap (公平價值缺口 / 失衡區)
 * 
 * 核心邏輯：當價格快速離開某區間，留下沒有成交的「空白地帶」
 * 這些 FVG 通常會被回補（價格回歸填補缺口）
 * 
 * 識別方式：
 * - 向上 FVG：第 N 根 K 線的低點 > 第 N-2 根 K 線的高點
 * - 向下 FVG：第 N 根 K 線的高點 < 第 N-2 根 K 線的低點
 */

import { StockData } from '../types';

export interface FVG {
  type: 'bullish' | 'bearish';
  top: number;        // FVG 頂部
  bottom: number;     // FVG 底部
  mid: number;        // 中點
  size: number;       // 缺口大小（%)
  age: number;        // 多少根 K 線前
  strength: number;    // 強度 0-15
  reason: string;
}

/**
 * 檢測 FVG
 * @param data 歷史 K 線數據
 * @param maxAge 最多檢測多少根 K 線前的 FVG
 */
export function detectFVG(data: StockData[], maxAge: number = 5): FVG[] {
  const fvgs: FVG[] = [];
  
  if (data.length < 3) return fvgs;

  const cur = data[data.length - 1];

  for (let i = 1; i <= maxAge; i++) {
    if (data.length < i + 2) break;
    
    const prev1 = data[data.length - 1 - i];     // 第 N-1 根
    const prev2 = data[data.length - 1 - i - 1];  // 第 N-2 根

    if (!prev1 || !prev2) continue;

    // 向上 FVG：第 N 根的低點高於第 N-2 根的高點（價格跳空上漲）
    if (cur.low > prev2.high) {
      if (prev2.high <= 0) continue;  // 防止除以零（損毀數據防護）
      const gap = cur.low - prev2.high;
      const gapPercent = (gap / prev2.high) * 100;
      
      // 忽略太小的缺口（雜訊）
      if (gapPercent > 0.1) {
        const strength = Math.min(15, Math.round(gapPercent * 10));
        fvgs.push({
          type: 'bullish',
          top: cur.low,
          bottom: prev2.high,
          mid: (cur.low + prev2.high) / 2,
          size: gapPercent,
          age: i,
          strength,
          reason: `向上 FVG，缺口 ${gapPercent.toFixed(2)}%，需回補`,
        });
      }
    }

    // 向下 FVG：第 N 根的高點低於第 N-2 根的低點（價格跳空下跌）
    if (cur.high < prev2.low) {
      if (prev2.low <= 0) continue;  // 防止除以零（損毀數據防護）
      const gap = prev2.low - cur.high;
      const gapPercent = (gap / prev2.low) * 100;
      
      if (gapPercent > 0.1) {
        const strength = Math.min(15, Math.round(gapPercent * 10));
        fvgs.push({
          type: 'bearish',
          top: prev2.low,
          bottom: cur.high,
          mid: (prev2.low + cur.high) / 2,
          size: gapPercent,
          age: i,
          strength,
          reason: `向下 FVG，缺口 ${gapPercent.toFixed(2)}%，需回補`,
        });
      }
    }
  }

  return fvgs;
}

/**
 * 檢查當前價格是否位於 FVG 內部（需要回補）
 * @param data 歷史 K 線數據
 * @param threshold FVG 剩餘空間百分比閾值
 */
export function checkFVGStatus(data: StockData[], threshold: number = 0.5): {
  filling: boolean;      // 正在填補 FVG
  filled: boolean;       // FVG 已完全填補
  direction: 'bullish' | 'bearish' | null;
  fvg: FVG | null;
} {
  if (data.length < 3) {
    return { filling: false, filled: false, direction: null, fvg: null };
  }

  const fvgs = detectFVG(data, 3);
  if (fvgs.length === 0) {
    return { filling: false, filled: false, direction: null, fvg: null };
  }

  const cur = data[data.length - 1];
  const latestFVG = fvgs[0]; // 最新的 FVG

  // 檢查是否正在填補
  if (latestFVG.type === 'bullish') {
    // 向上 FVG：價格回落進 FVG 區間
    if (cur.close < latestFVG.top && cur.close > latestFVG.bottom) {
      return { filling: true, filled: false, direction: 'bullish', fvg: latestFVG };
    }
    // 完全填補
    if (cur.close <= latestFVG.bottom) {
      return { filling: false, filled: true, direction: 'bullish', fvg: latestFVG };
    }
  } else {
    // 向下 FVG：價格反彈進 FVG 區間
    if (cur.close > latestFVG.bottom && cur.close < latestFVG.top) {
      return { filling: true, filled: false, direction: 'bearish', fvg: latestFVG };
    }
    // 完全填補
    if (cur.close >= latestFVG.top) {
      return { filling: false, filled: true, direction: 'bearish', fvg: latestFVG };
    }
  }

  return { filling: false, filled: false, direction: null, fvg: latestFVG };
}

/**
 * 計算 ATR（用於動態閾值）
 */
export function calculateATR(data: StockData[], period: number = 14): number {
  if (data.length < period + 1) return 0;

  let atrSum = 0;
  
  for (let i = data.length - period; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    atrSum += tr;
  }
  
  return atrSum / period;
}

/**
 * 計算相對 ATR（ATR / 價格）
 */
export function calculateATRPercent(data: StockData[], period: number = 14): number {
  if (data.length < 2) return 0;
  
  const atr = calculateATR(data, period);
  const currentPrice = data[data.length - 1].close;
  
  return (atr / currentPrice) * 100;
}
