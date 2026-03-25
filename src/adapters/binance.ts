/**
 * adapters/binance.ts — Binance 公开 API 适配器
 * 无需 API Key，支持现货 & 合约 K 线
 */

import type { IDataSourceAdapter, QuoteData } from '../core/types';
import type { StockData, AssetType } from '../types';

const BASE = '/binance-api';

/** symbol → Binance pair（e.g. BTC → BTCUSDT） */
function toPair(symbol: string): string {
  if (symbol.endsWith('USDT')) return symbol;
  return `${symbol}USDT`;
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tid));
}

export class BinanceAdapter implements IDataSourceAdapter {
  readonly id                  = 'binance';
  readonly name                = 'Binance';
  readonly priority            = 1;   // 加密货币首选
  readonly supportedAssetTypes: AssetType[] = ['crypto'];

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${BASE}/api/v3/ping`, 4000);
      return res.ok;
    } catch { return false; }
  }

  async fetchHistory(symbol: string): Promise<StockData[]> {
    const pair = toPair(symbol);
    // 日线，拉 180 根 ≈ 6 个月
    const url  = `${BASE}/api/v3/klines?symbol=${pair}&interval=1d&limit=180`;
    const res  = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);

    const rows: any[][] = await res.json();
    const result: StockData[] = [];

    for (let i = 0; i < rows.length; i++) {
      const k    = rows[i];
      const open = Number(k[1]), high = Number(k[2]), low  = Number(k[3]), close = Number(k[4]);
      const prev = result[result.length - 1];
      const chg  = prev ? close - prev.close : 0;
      result.push({
        symbol, name: symbol,
        price: close, close,
        open, high, low,
        volume:        Number(k[5]),
        change:        chg,
        changePercent: prev ? (chg / prev.close) * 100 : 0,
        timestamp:     Number(k[0]),
      });
    }
    return result;
  }

  async fetchQuote(symbol: string): Promise<QuoteData | null> {
    const pair = toPair(symbol);
    const url  = `${BASE}/api/v3/ticker/24hr?symbol=${pair}`;
    const res  = await fetchWithTimeout(url, 5000);
    if (!res.ok) return null;

    const d = await res.json();
    return {
      symbol,
      price:         Number(d.lastPrice),
      change:        Number(d.priceChange),
      changePercent: Number(d.priceChangePercent),
      volume:        Number(d.volume),
      timestamp:     Date.now(),
    };
  }
}
