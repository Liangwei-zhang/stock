/**
 * src/tests/adapters.test.ts — 數據適配器測試
 *
 * 覆蓋：
 *  - adapters/binance.ts   BinanceAdapter
 *  - adapters/polygon.ts   PolygonAdapter
 *  - adapters/yahoo.ts     YahooAdapter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Helper: Binance klines format ───────────────────────────────────────────

function makeBinanceKline(
  openTime: number,
  open = '100', high = '101', low = '99', close = '100.5', volume = '500',
) {
  return [
    openTime, open, high, low, close, volume,
    openTime + 86400000, '1000000', 100, '250', '500000', '0',
  ];
}

function makeBinanceKlines(n: number, startPrice = 100) {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const price = startPrice + i;
    return makeBinanceKline(
      now - (n - i) * 86400000,
      price.toString(), (price + 1).toString(),
      (price - 1).toString(), price.toString(),
    );
  });
}

// ─── Helper: Polygon response format ─────────────────────────────────────────

function makePolygonResponse(n: number) {
  const now = Date.now();
  return {
    results: Array.from({ length: n }, (_, i) => ({
      t: now - (n - i) * 86400000,
      o: 100 + i,
      h: 102 + i,
      l: 99 + i,
      c: 101 + i,
      v: 1000000,
    })),
  };
}

// ─── Helper: Yahoo response format ───────────────────────────────────────────

function makeYahooResponse(n: number, symbol = 'AAPL') {
  const now = Math.floor(Date.now() / 1000);
  const timestamps = Array.from({ length: n }, (_, i) => now - (n - i) * 86400);
  return {
    chart: {
      result: [{
        meta: { symbol, currency: 'USD', regularMarketPrice: 150 },
        timestamp: timestamps,
        indicators: {
          quote: [{
            open:   timestamps.map((_, i) => 100 + i),
            high:   timestamps.map((_, i) => 102 + i),
            low:    timestamps.map((_, i) => 99 + i),
            close:  timestamps.map((_, i) => 101 + i),
            volume: timestamps.map(() => 1000000),
          }],
        },
      }],
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  1. BinanceAdapter
// ══════════════════════════════════════════════════════════════════════════════

describe('adapters/binance.ts — BinanceAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')));
  });

  it('has correct metadata', async () => {
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    expect(adapter.id).toBe('binance');
    expect(adapter.priority).toBe(1);
    expect(adapter.supportedAssetTypes).toContain('crypto');
  });

  it('isAvailable() returns false when ping fails', async () => {
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    const avail = await adapter.isAvailable();
    expect(avail).toBe(false);
  });

  it('isAvailable() returns true when ping succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('fetchHistory() returns StockData array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeBinanceKlines(10),
    }));
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    const data = await adapter.fetchHistory('BTC');
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(10);
  });

  it('fetchHistory() result has required fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeBinanceKlines(5),
    }));
    const { BinanceAdapter } = await import('../adapters/binance');
    const data = await new BinanceAdapter().fetchHistory('BTC');
    data.forEach(d => {
      expect(typeof d.symbol).toBe('string');
      expect(typeof d.close).toBe('number');
      expect(typeof d.open).toBe('number');
      expect(typeof d.high).toBe('number');
      expect(typeof d.low).toBe('number');
      expect(typeof d.volume).toBe('number');
      expect(typeof d.timestamp).toBe('number');
    });
  });

  it('fetchHistory() appends USDT to symbol if missing', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: async () => makeBinanceKlines(1) });
    }));
    const { BinanceAdapter } = await import('../adapters/binance');
    await new BinanceAdapter().fetchHistory('ETH');
    expect(capturedUrl).toContain('ETHUSDT');
  });

  it('fetchHistory() throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const { BinanceAdapter } = await import('../adapters/binance');
    await expect(new BinanceAdapter().fetchHistory('BTC')).rejects.toThrow();
  });

  it('fetchHistory() does not modify symbol if already ends in USDT', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: async () => makeBinanceKlines(1) });
    }));
    const { BinanceAdapter } = await import('../adapters/binance');
    await new BinanceAdapter().fetchHistory('BTCUSDT');
    expect(capturedUrl).toContain('BTCUSDT');
    // Should not be BTCUSDTUSDT
    expect(capturedUrl).not.toContain('BTCUSDTUSDT');
  });

  it('fetchQuote() returns QuoteData', async () => {
    const mockTicker = { symbol: 'BTCUSDT', lastPrice: '50000', priceChange: '500', priceChangePercent: '1', volume: '1000' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockTicker,
    }));
    const { BinanceAdapter } = await import('../adapters/binance');
    const quote = await new BinanceAdapter().fetchQuote('BTC');
    expect(quote).not.toBeNull();
    if (quote) {
      expect(typeof quote.price).toBe('number');
      expect(typeof quote.change).toBe('number');
    }
  });

  it('fetchQuote() throws or returns null on error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')));
    const { BinanceAdapter } = await import('../adapters/binance');
    // fetchQuote doesn't catch errors, so it either throws or returns null
    try {
      const quote = await new BinanceAdapter().fetchQuote('BTC');
      expect(quote).toBeNull();
    } catch (e: any) {
      expect(e.message).toContain('fail');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  2. PolygonAdapter
// ══════════════════════════════════════════════════════════════════════════════

describe('adapters/polygon.ts — PolygonAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      _store: {} as Record<string, string>,
      getItem(k: string) { return (this as any)._store[k] ?? null; },
      setItem(k: string, v: string) { (this as any)._store[k] = v; },
      removeItem(k: string) { delete (this as any)._store[k]; },
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')));
  });

  it('has correct metadata', async () => {
    const { PolygonAdapter } = await import('../adapters/polygon');
    const adapter = new PolygonAdapter();
    expect(adapter.id).toBe('polygon');
    expect(adapter.priority).toBe(2);
    expect(adapter.supportedAssetTypes).toContain('equity');
  });

  it('isAvailable() returns false when API key not configured', async () => {
    const { PolygonAdapter } = await import('../adapters/polygon');
    // No API key in localStorage
    const avail = await new PolygonAdapter().isAvailable();
    expect(avail).toBe(false);
  });

  it('isAvailable() returns true when API key set and ping succeeds', async () => {
    const ls: Record<string, string> = { POLYGON_API_KEY: 'test-key' };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => ls[k] ?? null,
      setItem: (k: string, v: string) => { ls[k] = v; },
      removeItem: (k: string) => { delete ls[k]; },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const { PolygonAdapter } = await import('../adapters/polygon');
    const avail = await new PolygonAdapter().isAvailable();
    expect(avail).toBe(true);
  });

  it('fetchHistory() throws when no API key', async () => {
    const { PolygonAdapter } = await import('../adapters/polygon');
    await expect(new PolygonAdapter().fetchHistory('AAPL')).rejects.toThrow('API key');
  });

  it('fetchHistory() returns StockData array with valid key and response', async () => {
    const ls: Record<string, string> = { POLYGON_API_KEY: 'test-key' };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => ls[k] ?? null,
      setItem: (k: string, v: string) => { ls[k] = v; },
      removeItem: (k: string) => { delete ls[k]; },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePolygonResponse(10),
    }));
    const { PolygonAdapter } = await import('../adapters/polygon');
    const data = await new PolygonAdapter().fetchHistory('AAPL');
    expect(data.length).toBe(10);
    data.forEach(d => {
      expect(typeof d.close).toBe('number');
      expect(d.symbol).toBe('AAPL');
    });
  });

  it('fetchHistory() returns empty array when API returns no results', async () => {
    const ls: Record<string, string> = { POLYGON_API_KEY: 'test-key' };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => ls[k] ?? null,
      setItem: (k: string, v: string) => { ls[k] = v; },
      removeItem: (k: string) => { delete ls[k]; },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    }));
    const { PolygonAdapter } = await import('../adapters/polygon');
    const data = await new PolygonAdapter().fetchHistory('AAPL');
    expect(data).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  3. YahooAdapter
// ══════════════════════════════════════════════════════════════════════════════

describe('adapters/yahoo.ts — YahooAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')));
  });

  it('has correct metadata', async () => {
    const { YahooAdapter } = await import('../adapters/yahoo');
    const adapter = new YahooAdapter();
    expect(adapter.id).toBe('yahoo');
    expect(adapter.priority).toBe(10);
    expect(adapter.supportedAssetTypes).toContain('equity');
    expect(adapter.supportedAssetTypes).toContain('etf');
  });

  it('isAvailable() returns true (yahoo always returns true as fallback)', async () => {
    // Yahoo's isAvailable always returns true (even if server unreachable)
    const { YahooAdapter } = await import('../adapters/yahoo');
    const avail = await new YahooAdapter().isAvailable();
    expect(avail).toBe(true);
  });

  it('fetchHistory() returns StockData array when proxy succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeYahooResponse(15, 'AAPL'),
    }));
    const { YahooAdapter } = await import('../adapters/yahoo');
    const data = await new YahooAdapter().fetchHistory('AAPL');
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(15);
  });

  it('fetchHistory() result has required fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeYahooResponse(5, 'MSFT'),
    }));
    const { YahooAdapter } = await import('../adapters/yahoo');
    const data = await new YahooAdapter().fetchHistory('MSFT');
    data.forEach(d => {
      expect(typeof d.close).toBe('number');
      expect(typeof d.open).toBe('number');
      expect(typeof d.high).toBe('number');
      expect(typeof d.low).toBe('number');
      expect(typeof d.volume).toBe('number');
      expect(typeof d.timestamp).toBe('number');
      expect(d.close).toBeGreaterThan(0);
    });
  });

  it('fetchHistory() throws when response is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ chart: { result: null } }),
    }));
    const { YahooAdapter } = await import('../adapters/yahoo');
    await expect(new YahooAdapter().fetchHistory('AAPL')).rejects.toThrow();
  });

  it('fetchHistory() throws when both proxy and direct fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const { YahooAdapter } = await import('../adapters/yahoo');
    await expect(new YahooAdapter().fetchHistory('AAPL')).rejects.toThrow();
  });

  it('fetchHistory() uses local proxy first', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      urls.push(url);
      // 前後端整合後使用相對路徑 /api/yahoo
      if (url.includes('/api/yahoo')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeYahooResponse(5, 'AAPL'),
        });
      }
      return Promise.reject(new Error('should not reach here'));
    }));
    const { YahooAdapter } = await import('../adapters/yahoo');
    const data = await new YahooAdapter().fetchHistory('AAPL');
    expect(data.length).toBe(5);
    expect(urls[0]).toContain('/api/yahoo');
  });
});
