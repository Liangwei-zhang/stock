/**
 * liquidation.ts — 清算檢測模組 (Gen 3.1)
 * 
 * 核心邏輯：
 * 1. 基於 Order Book 估算清算位
 * 2. 檢測Liquidation Sweep（清算掠奪）
 * 3. 大單買賣牆檢測
 */

import { StockData } from '../types';
import { fetchOrderBook, estimateLiquidations, calculateOrderBookImbalance, detectWhaleOrders } from '../services/cryptoService';

export interface LiquidationSignal {
  type: 'buy' | 'sell' | 'neutral';
  level: number;           // 0-15 分
  price: number;           // 清算發生的價格
  size: number;           // 估計清算量
  reason: string;
}

export interface OrderBookAnalysis {
  imbalance: number;       // -1 到 1
  buyWallStrength: number; // 買牆強度
  sellWallStrength: number;// 賣牆強度
  whaleBuy: boolean;
  whaleSell: boolean;
  whaleSize: number;
  liquiditySweep: boolean;  // 是否發生清算掠奪
  sweepDirection: 'up' | 'down' | null;
}

/**
 * 清算信號檢測
 */
export async function detectLiquidationSignal(symbol: string): Promise<LiquidationSignal | null> {
  const liq = await estimateLiquidations(symbol);
  const orderBook = await fetchOrderBook(symbol);
  
  if (!liq || !orderBook) return null;
  
  const imbalance = calculateOrderBookImbalance(orderBook);
  const whales = detectWhaleOrders(orderBook);
  
  // 檢測清算掠奪
  // 邏輯：當 Order Book 嚴重失衡（>0.7 或 <-0.7）時，價格可能掃過清算位
  
  // 清算信號評分
  let score = 0;
  let signalType: 'buy' | 'sell' | 'neutral' = 'neutral';
  let reason = '';
  
  // 1. 賣牆遠強於買牆 = 潛在多單清算
  if (liq.sellWall > liq.buyWall * 2) {
    score += 8;
    signalType = 'sell';
    reason = `賣牆強度 ${(liq.sellWall / liq.buyWall).toFixed(1)}x，多單風險高`;
  }
  
  // 2. 買牆遠強於賣牆 = 潛在空單清算
  if (liq.buyWall > liq.sellWall * 2) {
    score += 8;
    signalType = 'buy';
    reason = `買牆強度 ${(liq.buyWall / liq.sellWall).toFixed(1)}x，空單風險高`;
  }
  
  // 3. 大單進場（Whale）
  if (whales.whaleBuy) {
    score += 7;
    reason += ' | Whale 大單買入';
  }
  if (whales.whaleSell) {
    score += 7;
    reason += ' | Whale 大單賣出';
  }
  
  if (score === 0) return null;
  
  return {
    type: signalType,
    level: Math.min(15, score),
    price: signalType === 'buy' ? liq.sellLiquidation : liq.buyLiquidation,
    size: signalType === 'buy' ? liq.sellWall : liq.buyWall,
    reason,
  };
}

/**
 * 完整 Order Book 分析
 */
export async function analyzeOrderBook(symbol: string): Promise<OrderBookAnalysis | null> {
  const orderBook = await fetchOrderBook(symbol);
  if (!orderBook) return null;
  
  const liq = await estimateLiquidations(symbol);
  const whales = detectWhaleOrders(orderBook);
  const imbalance = calculateOrderBookImbalance(orderBook);
  
  // 檢測清算掠奪
  let sweepDirection: 'up' | 'down' | null = null;
  
  if (liq) {
    // 如果買牆極強且價格接近賣方清算位，可能向上掃盪
    if (liq.buyWall > liq.sellWall * 3 && imbalance > 0.5) {
      sweepDirection = 'up';
    }
    // 如果賣牆極強且價格接近買方清算位，可能向下掃盪
    if (liq.sellWall > liq.buyWall * 3 && imbalance < -0.5) {
      sweepDirection = 'down';
    }
  }
  
  return {
    imbalance,
    buyWallStrength: liq?.buyWall || 0,
    sellWallStrength: liq?.sellWall || 0,
    whaleBuy: whales.whaleBuy,
    whaleSell: whales.whaleSell,
    whaleSize: whales.whaleSize,
    liquiditySweep: sweepDirection !== null,
    sweepDirection,
  };
}

/**
 * 計算清算區間（基於 ATR）
 */
export function calculateLiquidationZones(
  currentPrice: number,
  volatility: number, // ATR 百分比
  leverage: number = 10
): {
  longLiquidation: number;
  shortLiquidation: number;
  dangerZone: { upper: number; lower: number };
} {
  // 根據杠桿計算清算距離
  const liquidationDistance = (currentPrice * volatility / 100) / leverage;
  
  return {
    longLiquidation: currentPrice - liquidationDistance,
    shortLiquidation: currentPrice + liquidationDistance,
    dangerZone: {
      upper: currentPrice + liquidationDistance * 2,
      lower: currentPrice - liquidationDistance * 2,
    },
  };
}
