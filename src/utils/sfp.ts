/**
 * sfp.ts — Swing Failure Pattern (流動性掠奪)
 * 
 * 核心邏輯：價格刺穿重要高低點（掃止損），但收盤卻收在內側
 * 這是主力吸收流動性的經典信號
 */

import { StockData } from '../types';

export interface SFPMatch {
  type: 'top' | 'bottom';
  level: number;        // 刺穿的高/低點價格
  wick: number;          // 影線長度
  body: number;          // 實體長度
  strength: number;      // 0-35 分
  reason: string;
}

/**
 * 檢測 SFP 信號
 * @param data 歷史 K 線數據
 * @param lookback 向前掃描多少根 K 線找重要高低點
 */
export function detectSFP(data: StockData[], lookback: number = 20): SFPMatch | null {
  if (data.length < lookback + 5) return null;

  const cur = data[data.length - 1];
  const prev = data[data.length - 2];
  
  // 掃描歷史高低點
  const highs: { price: number; idx: number }[] = [];
  const lows: { price: number; idx: number }[] = [];

  for (let i = data.length - lookback; i < data.length - 2; i++) {
    // 局部高點
    if (i > 2 && i < data.length - 3) {
      if (data[i].high > data[i-1].high && data[i].high > data[i-2].high &&
          data[i].high > data[i+1].high && data[i].high > data[i+2].high) {
        highs.push({ price: data[i].high, idx: i });
      }
      // 局部低點
      if (data[i].low < data[i-1].low && data[i].low < data[i-2].low &&
          data[i].low < data[i+1].low && data[i].low < data[i+2].low) {
        lows.push({ price: data[i].low, idx: i });
      }
    }
  }

  // 檢查假突破高點（頂部 SFP）
  for (const h of highs.reverse()) {
    // 價格刺穿高點
    if (cur.high > h.price || (prev.high > h.price && cur.high > h.price)) {
      // 但收盤價在內側（沒有完全站穩）
      const closeAbove = cur.close > h.price;
      const wickRatio = (cur.high - Math.max(cur.close, cur.open)) / (cur.high - cur.low + 0.001);
      
      // 經典 SFP：長上影線 + 收盤在內側
      if (!closeAbove && wickRatio > 0.3) {
        const strength = Math.min(35, 20 + Math.round(wickRatio * 25));
        return {
          type: 'top',
          level: h.price,
          wick: cur.high - Math.max(cur.close, cur.open),
          body: Math.abs(cur.close - cur.open),
          strength,
          reason: `假突破高點 $${h.price.toFixed(2)}，收於內側，影線比例 ${(wickRatio*100).toFixed(0)}%`,
        };
      }
    }
  }

  // 檢查假突破低點（底部 SFP）
  for (const l of lows.reverse()) {
    if (cur.low < l.price || (prev.low < l.price && cur.low < l.price)) {
      const closeBelow = cur.close < l.price;
      const wickRatio = (Math.min(cur.close, cur.open) - cur.low) / (cur.high - cur.low + 0.001);
      
      if (!closeBelow && wickRatio > 0.3) {
        const strength = Math.min(35, 20 + Math.round(wickRatio * 25));
        return {
          type: 'bottom',
          level: l.price,
          wick: Math.min(cur.close, cur.open) - cur.low,
          body: Math.abs(cur.close - cur.open),
          strength,
          reason: `假突破低點 $${l.price.toFixed(2)}，收於內側，影線比例 ${(wickRatio*100).toFixed(0)}%`,
        };
      }
    }
  }

  return null;
}
