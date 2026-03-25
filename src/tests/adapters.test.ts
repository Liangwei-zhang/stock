/**
 * tests/adapters.test.ts
 * 覆蓋 src/adapters/binance.ts、polygon.ts、yahoo.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

function makeFetchFail(status = 500) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({ error: `HTTP ${status}` }),
  });
}

function makeFetchNetworkError() {
  return vi.fn().mockRejectedValue(new Error('Network error'));
}

function makeLsMock(store: Record<string, string> = {}) {
  return {
    getItem:    (k: string) => store[k] ?? null,
    setItem:    (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear:      () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

// ─── Binance Adapter ─────────────────────────────────────────────────────────

describe('BinanceAdapter — isAvailable', () => {
  it('returns true when ping succeeds', async () => {
    vi.stubGlobal('fetch', makeFetchOk({}));
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    const result = await adapter.isAvailable();
    expect(result).toBe(true);
  });

  it('returns false when ping fails with network error', async () => {
    vi.stubGlobal('fetch', makeFetchNetworkError());
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    const result = await adapter.isAvailable();
    expect(result).toBe(false);
  });

  it('returns false when ping returns non-ok', async () => {
    vi.stubGlobal('fetch', makeFetchFail(503));
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    const result = await adapter.isAvailable();
    expect(result).toBe(false);
  });
});

describe('BinanceAdapter — fetchHistory', () => {
  const mockKlines = Array.from({ length: 10 }, (_, i) => [
    Date.now() - (10 - i) * 86400000, // open time
    String(100 + i),       // open
    String(105 + i),       // high
    String(95 + i),        // low
    String(102 + i),       // close
    String(1000000 + i * 100), // volume
    Date.now(),            // close time
  ]);

  it('returns StockData array on success', async () => {
    vi.stubGlobal('fetch', makeFetchOk(mockKlines));
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    const result = await adapter.fetchHistory('BTC');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('symbol', 'BTC');
    expect(result[0]).toHaveProperty('open');
    expect(result[0]).toHaveProperty('high');
    expect(result[0]).toHaveProperty('low');
    expect(result[0]).toHaveProperty('close');
    expect(result[0]).toHaveProperty('volume');
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', makeFetchFail(404));
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    await expect(adapter.fetchHistory('BTCUSDT')).rejects.toThrow();
  });

  it('throws on network error', async () => {
    vi.stubGlobal('fetch', makeFetchNetworkError());
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    await expect(adapter.fetchHistory('BTC')).rejects.toThrow();
  });

  it('appends USDT suffix when symbol does not have it', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockKlines) });
    }));
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    await adapter.fetchHistory('ETH').catch(() => {});
    expect(capturedUrl).toContain('ETHUSDT');
  });
});

describe('BinanceAdapter — fetchQuote', () => {
  const mockTicker = {
    lastPrice: '50000.00',
    priceChange: '500.00',
    priceChangePercent: '1.00',
    volume: '12345.67',
  };

  it('returns QuoteData on success', async () => {
    vi.stubGlobal('fetch', makeFetchOk(mockTicker));
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    const result = await adapter.fetchQuote('BTC');
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('BTC');
    expect(result?.price).toBeCloseTo(50000, 0);
    expect(result?.volume).toBeGreaterThan(0);
  });

  it('returns null on non-ok response', async () => {
    vi.stubGlobal('fetch', makeFetchFail(400));
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    const result = await adapter.fetchQuote('BTC');
    expect(result).toBeNull();
  });
});

describe('BinanceAdapter — metadata', () => {
  it('has correct id, name, priority', async () => {
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    expect(adapter.id).toBe('binance');
    expect(adapter.name).toBe('Binance');
    expect(adapter.priority).toBeLessThan(10);
  });

  it('supports crypto asset type', async () => {
    const { BinanceAdapter } = await import('../adapters/binance');
    const adapter = new BinanceAdapter();
    expect(adapter.supportedAssetTypes).toContain('crypto');
  });
});

// ─── Polygon Adapter ──────────────────────────────────────────────────────────

describe('PolygonAdapter — isAvailable', () => {
  it('returns false when no API key configured', async () => {
    vi.stubGlobal('localStorage', makeLsMock({})); // no key
    vi.stubGlobal('fetch', makeFetchOk({}));
    const { PolygonAdapter } = await import('../adapters/polygon');
    const adapter = new PolygonAdapter();
    const result = await adapter.isAvailable();
    expect(result).toBe(false);
  });

  it('returns true when API key set and ping succeeds', async () => {
    vi.stubGlobal('localStorage', makeLsMock({ POLYGON_API_KEY: 'test-key-123' }));
    vi.stubGlobal('fetch', makeFetchOk({ status: 'open' }));
    const { PolygonAdapter } = await import('../adapters/polygon');
    const adapter = new PolygonAdapter();
    const result = await adapter.isAvailable();
    expect(result).toBe(true);
  });
});

describe('PolygonAdapter — fetchHistory', () => {
  it('throws when no API key configured', async () => {
    vi.stubGlobal('localStorage', makeLsMock({}));
    vi.stubGlobal('fetch', makeFetchOk({}));
    const { PolygonAdapter } = await import('../adapters/polygon');
    const adapter = new PolygonAdapter();
    await expect(adapter.fetchHistory('AAPL')).rejects.toThrow(/key/i);
  });

  it('returns StockData array when API key set and response is valid', async () => {
    vi.stubGlobal('localStorage', makeLsMock({ POLYGON_API_KEY: 'test-key' }));
    const mockResponse = {
      results: Array.from({ length: 5 }, (_, i) => ({
        t: Date.now() - (5 - i) * 86400000,
        o: 150 + i, h: 155 + i, l: 148 + i, c: 152 + i, v: 1000000,
      })),
    };
    vi.stubGlobal('fetch', makeFetchOk(mockResponse));
    const { PolygonAdapter } = await import('../adapters/polygon');
    const adapter = new PolygonAdapter();
    const result = await adapter.fetchHistory('AAPL');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].symbol).toBe('AAPL');
  });

  it('throws on HTTP error response', async () => {
    vi.stubGlobal('localStorage', makeLsMock({ POLYGON_API_KEY: 'test-key' }));
    vi.stubGlobal('fetch', makeFetchFail(429));
    const { PolygonAdapter } = await import('../adapters/polygon');
    const adapter = new PolygonAdapter();
    await expect(adapter.fetchHistory('AAPL')).rejects.toThrow();
  });
});

describe('PolygonAdapter — fetchQuote', () => {
  it('returns null when no API key', async () => {
    vi.stubGlobal('localStorage', makeLsMock({}));
    const { PolygonAdapter } = await import('../adapters/polygon');
    const adapter = new PolygonAdapter();
    const result = await adapter.fetchQuote('AAPL');
    expect(result).toBeNull();
  });
});

describe('PolygonAdapter — metadata', () => {
  it('has correct id and supports equity/etf', async () => {
    const { PolygonAdapter } = await import('../adapters/polygon');
    const adapter = new PolygonAdapter();
    expect(adapter.id).toBe('polygon');
    expect(adapter.supportedAssetTypes).toContain('equity');
    expect(adapter.supportedAssetTypes).toContain('etf');
  });
});

// ─── Yahoo Adapter ────────────────────────────────────────────────────────────

describe('YahooAdapter — isAvailable', () => {
  it('returns true by default (optimistic availability)', async () => {
    // YahooAdapter returns true even without network (optimistic)
    vi.stubGlobal('fetch', makeFetchNetworkError());
    const { YahooAdapter } = await import('../adapters/yahoo');
    const adapter = new YahooAdapter();
    const result = await adapter.isAvailable();
    expect(result).toBe(true);
  });
});

describe('YahooAdapter — fetchHistory', () => {
  const mockYahooResponse = {
    chart: {
      result: [{
        timestamp: Array.from({ length: 5 }, (_, i) => Math.floor((Date.now() - (5 - i) * 86400000) / 1000)),
        indicators: {
          quote: [{
            open:   [150, 151, 152, 153, 154],
            high:   [155, 156, 157, 158, 159],
            low:    [148, 149, 150, 151, 152],
            close:  [152, 153, 154, 155, 156],
            volume: [1e6, 1.1e6, 0.9e6, 1.2e6, 1.3e6],
          }],
        },
      }],
    },
  };

  it('returns StockData array on success', async () => {
    vi.stubGlobal('fetch', makeFetchOk(mockYahooResponse));
    const { YahooAdapter } = await import('../adapters/yahoo');
    const adapter = new YahooAdapter();
    const result = await adapter.fetchHistory('AAPL');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].symbol).toBe('AAPL');
    expect(result[0].close).toBeGreaterThan(0);
  });

  it('throws on empty Yahoo response', async () => {
    vi.stubGlobal('fetch', makeFetchOk({ chart: { result: null } }));
    const { YahooAdapter } = await import('../adapters/yahoo');
    const adapter = new YahooAdapter();
    await expect(adapter.fetchHistory('AAPL')).rejects.toThrow();
  });

  it('throws on network error', async () => {
    vi.stubGlobal('fetch', makeFetchNetworkError());
    const { YahooAdapter } = await import('../adapters/yahoo');
    const adapter = new YahooAdapter();
    await expect(adapter.fetchHistory('AAPL')).rejects.toThrow();
  });
});

describe('YahooAdapter — fetchQuote', () => {
  const mockQuoteResponse = {
    chart: {
      result: [{
        meta: {
          regularMarketPrice: 155.00,
          previousClose: 150.00,
          regularMarketVolume: 5000000,
        },
        timestamp: [Math.floor(Date.now() / 1000)],
        indicators: {
          quote: [{ open: [150], high: [158], low: [149], close: [155], volume: [5000000] }],
        },
      }],
    },
  };

  it('returns QuoteData on success', async () => {
    vi.stubGlobal('fetch', makeFetchOk(mockQuoteResponse));
    const { YahooAdapter } = await import('../adapters/yahoo');
    const adapter = new YahooAdapter();
    const result = await adapter.fetchQuote('AAPL');
    expect(result).not.toBeNull();
    expect(result?.symbol).toBe('AAPL');
    expect(typeof result?.price).toBe('number');
  });

  it('returns null when result is empty', async () => {
    vi.stubGlobal('fetch', makeFetchOk({ chart: { result: [] } }));
    const { YahooAdapter } = await import('../adapters/yahoo');
    const adapter = new YahooAdapter();
    const result = await adapter.fetchQuote('AAPL');
    expect(result).toBeNull();
  });
});

describe('YahooAdapter — metadata', () => {
  it('has correct id and lowest priority (fallback)', async () => {
    const { YahooAdapter } = await import('../adapters/yahoo');
    const adapter = new YahooAdapter();
    expect(adapter.id).toBe('yahoo');
    expect(adapter.priority).toBeGreaterThan(5);
    expect(adapter.supportedAssetTypes).toContain('equity');
    expect(adapter.supportedAssetTypes).toContain('etf');
  });
});
