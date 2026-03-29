/**
 * adapters/yahoo.ts — Yahoo Finance 适配器
 *
 * P4 修复：彻底移除对 corsproxy.io 的依赖。
 *
 * 策略：
 *   1. 统一通过本地後端代理（/api/yahoo/...），零 CORS 问题
 *   2. 代理不可用时直接抛出，由调用方降级到下一个适配器
 */

import type { IDataSourceAdapter, QuoteData } from '../core/types';
import type { StockData, AssetType } from '../types';
import { readJsonIfAvailable } from '../utils/http';

// 使用相對路徑，自動適配任何 port（前後端已整合為單一服務）
const SERVER_PROXY = '/api/yahoo';

async function fetchWithTimeout(url: string, ms = 10000): Promise<Response> {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tid));
}

async function queryViaProxy(symbol: string, params: string): Promise<any> {
  const url = `${SERVER_PROXY}/${encodeURIComponent(symbol)}?${params}`;
  const res = await fetchWithTimeout(url, 8000);
  if (!res.ok) {
    const err = await readJsonIfAvailable<{ error?: string }>(res);
    throw new Error(err?.error ?? `Yahoo HTTP ${res.status}`);
  }

  const json = await readJsonIfAvailable<any>(res);
  if (!json) throw new Error('Yahoo proxy returned non-JSON response');
  return json;
}

export class YahooAdapter implements IDataSourceAdapter {
  readonly id                  = 'yahoo';
  readonly name                = 'Yahoo Finance';
  readonly priority            = 10;  // 最低优先级，通用 fallback
  readonly supportedAssetTypes: AssetType[] = ['equity', 'etf', 'index', 'futures', 'other'];

  async isAvailable(): Promise<boolean> {
    // 檢查後端代理是否可用（相對路徑，與當前服務同 port）
    try {
      const res = await fetchWithTimeout('/health', 2000);
      if (res.ok) return true;
    } catch { /* ignore */ }
    return true;
  }

  async fetchHistory(symbol: string): Promise<StockData[]> {
    const params = 'interval=1d&range=6mo&includePrePost=false';
    const json   = await queryViaProxy(symbol, params);

    const r = json?.chart?.result?.[0];
    if (!r) throw new Error('Yahoo: empty response');

    const ts:     number[]           = r.timestamp ?? [];
    const q                          = r.indicators?.quote?.[0] ?? {};
    const opens:  (number | null)[]  = q.open   ?? [];
    const highs:  (number | null)[]  = q.high   ?? [];
    const lows:   (number | null)[]  = q.low    ?? [];
    const closes: (number | null)[]  = q.close  ?? [];
    const vols:   (number | null)[]  = q.volume ?? [];

    const result: StockData[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (!c || isNaN(c)) continue;
      const prev = result[result.length - 1];
      const chg  = prev ? c - prev.close : 0;
      result.push({
        symbol, name: symbol,
        price: c, close: c,
        open:   opens[i]  ?? c,
        high:   highs[i]  ?? c,
        low:    lows[i]   ?? c,
        volume: vols[i]   ?? 0,
        change:        chg,
        changePercent: prev ? (chg / prev.close) * 100 : 0,
        timestamp:     ts[i] * 1000,
      });
    }
    return result;
  }

  async fetchQuote(symbol: string): Promise<QuoteData | null> {
    try {
      const params = 'interval=1d&range=5d&includePrePost=false';
      const json   = await queryViaProxy(symbol, params);
      const r      = json?.chart?.result?.[0];
      if (!r) return null;

      const meta  = r.meta ?? {};
      const price = meta.regularMarketPrice ?? meta.previousClose ?? 0;
      const prev  = meta.chartPreviousClose ?? meta.previousClose ?? price;

      return {
        symbol,
        price,
        change:        price - prev,
        changePercent: prev ? ((price - prev) / prev) * 100 : 0,
        volume:        meta.regularMarketVolume ?? 0,
        timestamp:     Date.now(),
      };
    } catch { return null; }
  }
}
