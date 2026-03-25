/**
 * choch.ts — Change of Character (結構轉變)
 * 
 * 核心邏輯：當 SFP 發生後，次級別價格突破反向高低點
 * 這代表短期趨勢已經改變，確認信號
 */

import { StockData } from '../types';

export interface CHOCHMatch {
  type: 'top' | 'bottom';
  breakLevel: number;     // 突破的高點或低點
  strength: number;        // 0-30 分
  reason: string;
}

/**
 * 檢測 CHOCH 信號
 * @param data 歷史 K 線數據
 * @param sfpType SFP 類型（需要相反的結構轉變）
 */
export function detectCHOCH(data: StockData[], sfpType: 'top' | 'bottom'): CHOCHMatch | null {
  if (data.length < 10) return null;

  const cur = data[data.length - 1];
  const prev = data[data.length - 2];

  // 找最近的高低點
  let recentHigh = -Infinity;
  let recentLow = Infinity;
  
  for (let i = data.length - 10; i < data.length - 2; i++) {
    recentHigh = Math.max(recentHigh, data[i].high);
    recentLow = Math.min(recentLow, data[i].low);
  }

  // SFP 發生在頂部 → 尋找向下突破結構（確認下跌的 CHOCH）
  if (sfpType === 'top') {
    // 價格跌破最近的低點（意味著上漲趨勢結束）
    if (cur.close < recentLow && prev.close >= recentLow) {
      return {
        type: 'top',
        breakLevel: recentLow,
        strength: 30,
        reason: `價格跌破近期低點 $${recentLow.toFixed(2)}，上漲趨勢結束，頂部確認`,
      };
    }
    // 連續陰線也視為趨勢轉向跡象
    const trendBroken = cur.close < prev.close && cur.close < data[data.length - 3].close;
    if (trendBroken) {
      return {
        type: 'top',
        breakLevel: recentHigh,
        strength: 20,
        reason: '連續陰線，下跌趨勢形成跡象',
      };
    }
  }

  // SFP 發生在底部 → 尋找向上突破結構（確認上漲的 CHOCH）
  if (sfpType === 'bottom') {
    // 價格突破最近的高點（意味著下跌趨勢結束）
    if (cur.close > recentHigh && prev.close <= recentHigh) {
      return {
        type: 'bottom',
        breakLevel: recentHigh,
        strength: 30,
        reason: `價格突破近期高點 $${recentHigh.toFixed(2)}，下跌趨勢結束，底部確認`,
      };
    }
    // 連續陽線視為趨勢轉向跡象
    const trendBroken = cur.close > prev.close && cur.close > data[data.length - 3].close;
    if (trendBroken) {
      return {
        type: 'bottom',
        breakLevel: recentLow,
        strength: 20,
        reason: '連續陽線，上漲趨勢形成跡象',
      };
    }
  }

  return null;
}

/**
 * 獨立檢測趨勢結構（不依賴 SFP）
 */
export function detectTrendChange(data: StockData[]): CHOCHMatch | null {
  if (data.length < 15) return null;

  // 使用 EMA 判斷趨勢
  const ema9 = calculateEMA(data.map(d => d.close), 9);
  const ema21 = calculateEMA(data.map(d => d.close), 21);
  
  if (!ema9 || !ema21) return null;

  const prevEma9 = calculateEMA(data.slice(0, -1).map(d => d.close), 9);
  const prevEma21 = calculateEMA(data.slice(0, -1).map(d => d.close), 21);
  
  if (!prevEma9 || !prevEma21) return null;

  // 金叉（趨勢由空轉多）
  if (ema9 > ema21 && prevEma9 <= prevEma21) {
    return {
      type: 'bottom',
      breakLevel: ema21,
      strength: 25,
      reason: 'EMA9/21 金叉，趨勢由空轉多',
    };
  }

  // 死叉（趨勢由多轉空）
  if (ema9 < ema21 && prevEma9 >= prevEma21) {
    return {
      type: 'top',
      breakLevel: ema21,
      strength: 25,
      reason: 'EMA9/21 死叉，趨勢由多轉空',
    };
  }

  return null;
}

function calculateEMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  
  return ema;
}
