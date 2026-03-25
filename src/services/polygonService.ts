/**
 * polygonService.ts — Polygon.io 數據源
 * 
 * 使用 Polygon.io API 獲取股票數據
 * 免費層：5 API calls/minute，延遲數據（15分鐘）
 * 
 * 環境變量：
 * - POLYGON_API_KEY: 你的 Polygon.io API Key
 */

import { StockData, WatchlistItem } from '../types';

// 從環境變量獲取 API Key（需要用戶自行設定）
const API_KEY = typeof window !== 'undefined' 
  ? localStorage.getItem('POLYGON_API_KEY') || ''
  : '';

const BASE_URL = 'https://api.polygon.io';

/**
 * 從 Polygon.io 獲取歷史 K 線數據
 */
export async function fetchPolygonHistory(
  symbol: string, 
  from: string, 
  to: string
): Promise<StockData[]> {
  if (!API_KEY) {
    throw new Error('Polygon.io API Key 未設置');
  }

  const url = `${BASE_URL}/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}?adjusted=true&sort=asc&apiKey=${API_KEY}`;
  
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const data = await res.json();
  
  if (!data.results || data.results.length === 0) {
    return [];
  }

  return data.results.map((r: any) => ({
    symbol,
    name: symbol,
    price: r.c,
    close: r.c,
    open: r.o,
    high: r.h,
    low: r.l,
    volume: r.v,
    change: r.c - r.o,
    changePercent: ((r.c - r.o) / r.o) * 100,
    timestamp: r.t,
  }));
}

/**
 * 獲取即时报价（延遲 15 分鐘）
 */
export async function fetchPolygonQuote(symbol: string): Promise<{
  price: number;
  change: number;
  changePercent: number;
  volume: number;
} | null> {
  if (!API_KEY) {
    throw new Error('Polygon.io API Key 未設置');
  }

  const url = `${BASE_URL}/v2/aggs/ticker/${symbol}/prev?adjusted=true&apiKey=${API_KEY}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    
    const data = await res.json();
    if (!data.results || data.results.length === 0) return null;
    
    const r = data.results[0];
    return {
      price: r.c,
      change: r.c - r.o,
      changePercent: ((r.c - r.o) / r.o) * 100,
      volume: r.v,
    };
  } catch {
    return null;
  }
}

/**
 * 搜索股票
 */
export async function searchPolygonSymbols(query: string): Promise<{
  symbol: string;
  name: string;
  type: string;
  exchange: string;
}[]> {
  if (!API_KEY) {
    throw new Error('Polygon.io API Key 未設置');
  }

  const url = `${BASE_URL}/v3/reference/tickers?search=${encodeURIComponent(query)}&active=true&apiKey=${API_KEY}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    
    const data = await res.json();
    return (data.results || []).slice(0, 10).map((t: any) => ({
      symbol: t.ticker,
      name: t.name || t.ticker,
      type: t.type || 'stock',
      exchange: t.primary_exchange || 'unknown',
    }));
  } catch {
    return [];
  }
}

/**
 * 設置 API Key
 */
export function setPolygonApiKey(key: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('POLYGON_API_KEY', key);
  }
}

/**
 * 獲取當前 API Key 狀態
 */
export function getPolygonApiKeyStatus(): { set: boolean; key: string } {
  if (typeof window !== 'undefined') {
    const key = localStorage.getItem('POLYGON_API_KEY') || '';
    return { set: !!key, key: key ? key.substring(0, 8) + '...' : '' };
  }
  return { set: false, key: '' };
}

/**
 * 檢查 API 連接狀態
 */
export async function checkPolygonConnection(): Promise<boolean> {
  if (!API_KEY) return false;
  
  try {
    const url = `${BASE_URL}/v2/aggs/ticker/AAPL/prev?adjusted=true&apiKey=${API_KEY}`;
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}
