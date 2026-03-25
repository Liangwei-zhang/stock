/**
 * adapters/polygon.ts — Polygon.io 适配器
 * 需要 API Key（存 localStorage 或 .env）
 * 免费层：5 req/min，15 分钟延迟
 */

import type { IDataSourceAdapter, QuoteData } from '../core/types';
import type { StockData, AssetType } from '../types';

const BASE = 'https://api.polygon.io';

function getApiKey(): string {
  // 优先读环境变量（Vite），降级到 localStorage（用户手动配置）
  return (import.meta.env.VITE_POLYGON_API_KEY as string | undefined)
    || localStorage.getItem('POLYGON_API_KEY')
    || '';
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchWithTimeout(url: string, ms = 10000): Promise<Response> {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tid));
}

export class PolygonAdapter implements IDataSourceAdapter {
  readonly id                  = 'polygon';
  readonly name                = 'Polygon.io';
  readonly priority            = 2;   // 美股/ETF 次选（Binance 不支持美股）
  readonly supportedAssetTypes: AssetType[] = ['equity', 'etf', 'index', 'futures'];

  async isAvailable(): Promise<boolean> {
    const key = getApiKey();
    if (!key) return false;
    try {
      const res = await fetchWithTimeout(`${BASE}/v1/marketstatus/now?apiKey=${key}`, 4000);
      return res.ok;
    } catch { return false; }
  }

  async fetchHistory(symbol: string): Promise<StockData[]> {
    const key  = getApiKey();
    if (!key) throw new Error('Polygon API key not configured');

    const to   = fmt(new Date());
    const from = fmt(new Date(Date.now() - 180 * 24 * 3600_000));
    const url  = `${BASE}/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=200&apiKey=${key}`;

    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || `HTTP ${res.status}`);
    }

    const json = await res.json();
    if (!json.results?.length) return [];

    const result: StockData[] = [];
    for (const r of json.results) {
      const prev = result[result.length - 1];
      const chg  = prev ? r.c - prev.close : 0;
      result.push({
        symbol, name: symbol,
        price: r.c, close: r.c,
        open: r.o, high: r.h, low: r.l,
        volume:        r.v,
        change:        chg,
        changePercent: prev ? (chg / prev.close) * 100 : 0,
        timestamp:     r.t,
      });
    }
    return result;
  }

  async fetchQuote(symbol: string): Promise<QuoteData | null> {
    const key = getApiKey();
    if (!key) return null;

    const url = `${BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}?apiKey=${key}`;
    const res = await fetchWithTimeout(url, 5000);
    if (!res.ok) return null;

    const json = await res.json();
    const d    = json?.ticker?.day;
    const pd   = json?.ticker?.prevDay;
    if (!d) return null;

    const price = d.c || 0;
    const prev  = pd?.c || price;
    return {
      symbol,
      price,
      change:        price - prev,
      changePercent: prev ? ((price - prev) / prev) * 100 : 0,
      volume:        d.v || 0,
      timestamp:     Date.now(),
    };
  }
}
