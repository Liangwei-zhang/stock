/**
 * cryptoService.ts — 加密貨幣數據源
 * 
 * 使用 Binance 公開 API（無需 API Key）
 * 支援：現貨、合約、資金費率、清算數據
 */

import { StockData } from '../types';

// Binance API 基礎 URL
const BINANCE_BASE = '/binance-api';

// 幣種映射
const CRYPTO_PAIRS: Record<string, string> = {
  'BTC': 'BTCUSDT',
  'ETH': 'ETHUSDT',
  'SOL': 'SOLUSDT',
  'BNB': 'BNBUSDT',
  'XRP': 'XRPUSDT',
  'DOGE': 'DOGEUSDT',
  'ADA': 'ADAUSDT',
  'AVAX': 'AVAXUSDT',
  'DOT': 'DOTUSDT',
  'MATIC': 'MATICUSDT',
};

/**
 * 獲取 K 線數據
 */
export async function fetchCryptoKlines(
  symbol: string,
  interval: string = '1h',
  limit: number = 200
): Promise<StockData[]> {
  const pair = CRYPTO_PAIRS[symbol] || `${symbol}USDT`;
  
  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    
    return data.map((k: any[]) => ({
      symbol,
      name: symbol,
      price: Number(k[4]),       // close
      close: Number(k[4]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      volume: Number(k[5]),
      change: Number(k[4]) - Number(k[1]),
      changePercent: ((Number(k[4]) - Number(k[1]) / Number(k[1])) * 100),
      timestamp: k[0],
    }));
  } catch (e) {
    // error:(`Failed to fetch ${symbol} klines:`, e);
    return [];
  }
}

/**
 * 獲取當前價格和 24h 統計
 */
export async function fetchCryptoTicker(symbol: string): Promise<{
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high24h: number;
  low24h: number;
} | null> {
  const pair = CRYPTO_PAIRS[symbol] || `${symbol}USDT`;
  
  const url = `${BINANCE_BASE}/api/v3/ticker/24hr?symbol=${pair}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    
    const data = await res.json();
    
    return {
      price: Number(data.lastPrice),
      change: Number(data.priceChange),
      changePercent: Number(data.priceChangePercent),
      volume: Number(data.volume),
      high24h: Number(data.highPrice),
      low24h: Number(data.lowPrice),
    };
  } catch {
    return null;
  }
}

/**
 * 獲取資金費率
 */
export async function fetchFundingRate(symbol: string): Promise<{
  rate: number;
  nextFundingTime: number;
} | null> {
  const pair = CRYPTO_PAIRS[symbol] || `${symbol}USDT`;
  
  // 現貨沒有資金費率，需要用合約
  const url = `${BINANCE_BASE}/api/v3/premiumIndex?symbol=${pair}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    
    const data = await res.json();
    
    return {
      rate: Number(data.lastFundingRate) * 100, // 轉換為百分比
      nextFundingTime: data.nextFundingTime,
    };
  } catch {
    return null;
  }
}

/**
 * 獲取 Order Book（深度數據）
 */
export async function fetchOrderBook(symbol: string, limit: number = 20): Promise<{
  bids: [number, number][];  // [price, quantity]
  asks: [number, number][];
} | null> {
  const pair = CRYPTO_PAIRS[symbol] || `${symbol}USDT`;
  
  const url = `${BINANCE_BASE}/api/v3/depth?symbol=${pair}&limit=${limit}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    
    const data = await res.json();
    
    return {
      bids: data.bids.map((b: string[]) => [Number(b[0]), Number(b[1])]),
      asks: data.asks.map((a: string[]) => [Number(a[0]), Number(a[1])]),
    };
  } catch {
    return null;
  }
}

/**
 * 獲取近期清算（Liquidation）估算
 * 注意：Binance 不提供公開的清算數據，這是基於 Order Book 估算
 */
export async function estimateLiquidations(symbol: string): Promise<{
  buyLiquidation: number;  // 估計多單清算位
  sellLiquidation: number; // 估計空單清算位
  buyWall: number;         // 買牆強度
  sellWall: number;       // 賣牆強度
} | null> {
  const orderBook = await fetchOrderBook(symbol, 50);
  if (!orderBook) return null;
  
  const { bids, asks } = orderBook;
  
  // 計算買牆和賣牆
  let buyWall = 0;
  let sellWall = 0;
  
  // 買牆：累加前 10 檔的總量
  for (let i = 0; i < Math.min(10, bids.length); i++) {
    buyWall += bids[i][1];
  }
  
  // 賣牆：累加前 10 檔的總量
  for (let i = 0; i < Math.min(10, asks.length); i++) {
    sellWall += asks[i][1];
  }
  
  // 估算清算位（基於杠桿常用 10x-20x）
  const midPrice = (bids[0][0] + asks[0][0]) / 2;
  const liquidationRange = midPrice * 0.005; // 0.5% 價格波動觸發清算
  
  return {
    buyLiquidation: midPrice - liquidationRange,
    sellLiquidation: midPrice + liquidationRange,
    buyWall,
    sellWall,
  };
}

/**
 * 計算 Order Book 失衡度
 */
export function calculateOrderBookImbalance(orderBook: {
  bids: [number, number][];
  asks: [number, number][];
}): number {
  // 計算買賣盤總量
  const totalBidVol = orderBook.bids.reduce((sum, [, qty]) => sum + qty, 0);
  const totalAskVol = orderBook.asks.reduce((sum, [, qty]) => sum + qty, 0);
  
  const total = totalBidVol + totalAskVol;
  if (total === 0) return 0;
  
  // -1 到 1 之間，正值偏向買盤，負值偏向賣盤
  return (totalBidVol - totalAskVol) / total;
}

/**
 * 檢測是否有大單（Whale）
 */
export function detectWhaleOrders(orderBook: {
  bids: [number, number][];
  asks: [number, number][];
}, thresholdBTC: number = 1): {
  whaleBuy: boolean;
  whaleSell: boolean;
  whaleSize: number;
} {
  const avgBidVol = orderBook.bids.reduce((s, [, q]) => s + q, 0) / orderBook.bids.length;
  const avgAskVol = orderBook.asks.reduce((s, [, q]) => s + q, 0) / orderBook.asks.length;
  
  const maxBid = Math.max(...orderBook.bids.map(([, q]) => q));
  const maxAsk = Math.max(...orderBook.asks.map(([, q]) => q));
  
  const whaleSize = Math.max(maxBid, maxAsk);
  const threshold = avgBidVol * 10; // 大於平均 10 倍視為大單
  
  return {
    whaleBuy: maxBid > threshold,
    whaleSell: maxAsk > threshold,
    whaleSize,
  };
}

/**
 * 獲取可用於 Gen 3.1 的加密貨幣列表
 */
export function getCryptoList(): { symbol: string; name: string }[] {
  return [
    { symbol: 'BTC', name: '比特幣' },
    { symbol: 'ETH', name: '以太坊' },
    { symbol: 'SOL', name: 'Solana' },
    { symbol: 'BNB', name: '幣安幣' },
    { symbol: 'XRP', name: '瑞波幣' },
    { symbol: 'DOGE', name: '狗狗幣' },
    { symbol: 'ADA', name: '艾達幣' },
    { symbol: 'AVAX', name: '雪崩' },
    { symbol: 'DOT', name: '波卡' },
    { symbol: 'MATIC', name: 'Polygon' },
  ];
}

/**
 * 檢查是否為加密貨幣
 */
export function isCryptoSymbol(symbol: string): boolean {
  const cryptoSymbols = getCryptoList().map(c => c.symbol);
  return cryptoSymbols.includes(symbol.toUpperCase());
}

/**
 * 獲取加密貨幣的歷史數據
 */
export async function fetchCryptoHistory(symbol: string): Promise<StockData[]> {
  return fetchCryptoKlines(symbol, '1h', 200);
}

/**
 * 獲取加密貨幣的即時報價
 */
export async function fetchCryptoQuote(symbol: string): Promise<{
  price: number;
  change: number;
  changePercent: number;
  volume: number;
} | null> {
  return fetchCryptoTicker(symbol);
}
