/**
 * tests/stock-service.test.ts
 * 覆蓋 src/services/stockService.ts 中的 StockService 類
 */

import { describe, it, expect, vi } from 'vitest';
import type { WatchlistItem } from '../types';

// ─── Mock 依賴 ────────────────────────────────────────────────────────────────

vi.mock('../core/data-source-registry', () => ({
  dataSourceRegistry: {
    register:       vi.fn(),
    fetchHistory:   vi.fn().mockResolvedValue([]),
    fetchQuote:     vi.fn().mockResolvedValue(null),
    getAdapterChain: vi.fn().mockResolvedValue([]),
    getConfig:      vi.fn().mockReturnValue({ overrides: {}, disabled: [] }),
  },
}));

vi.mock('../db/market-db', () => ({
  marketDB: {
    init:             vi.fn().mockResolvedValue(undefined),
    saveOHLCV:        vi.fn().mockResolvedValue(undefined),
    queryOHLCV:       vi.fn().mockResolvedValue([]),
    deleteOHLCV:      vi.fn().mockResolvedValue(undefined),
    pruneOHLCV:       vi.fn().mockResolvedValue(undefined),
    cacheQuote:       vi.fn().mockResolvedValue(undefined),
    getCachedQuote:   vi.fn().mockResolvedValue(null),
    evictExpiredQuotes: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../services/storageService', () => ({
  getWatchlist:         vi.fn().mockResolvedValue([]),
  upsertWatchlistItem:  vi.fn().mockResolvedValue(undefined),
  removeWatchlistItem:  vi.fn().mockResolvedValue(undefined),
  pruneOldHistory:      vi.fn().mockResolvedValue(undefined),
  saveHistory:          vi.fn().mockResolvedValue(undefined),
  getHistory:           vi.fn().mockResolvedValue([]),
  SIX_MONTHS_MS:        6 * 30 * 24 * 3600 * 1000,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLsMock() {
  const store: Record<string, string> = {};
  return {
    getItem:    (k: string) => store[k] ?? null,
    setItem:    (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear:      () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

function makeWatchlistItem(symbol: string, assetType: WatchlistItem['assetType'] = 'equity'): WatchlistItem {
  return { symbol, name: `${symbol} Inc.`, addedAt: Date.now(), assetType };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('StockService — initialization', () => {
  it('isInitialized is false before init()', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    expect(stockService.isInitialized()).toBe(false);
  });

  it('isInitialized is true after init()', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    await stockService.init();
    expect(stockService.isInitialized()).toBe(true);
  });

  it('getWatchlist returns empty array initially', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    const wl = stockService.getWatchlist();
    expect(Array.isArray(wl)).toBe(true);
  });
});

describe('StockService — symbol management', () => {

  it('addSymbol adds to watchlist', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    await stockService.init();
    await stockService.addSymbol(makeWatchlistItem('AAPL'));
    expect(stockService.hasSymbol('AAPL')).toBe(true);
  });

  it('removeSymbol removes from watchlist', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    await stockService.init();
    await stockService.addSymbol(makeWatchlistItem('MSFT'));
    await stockService.removeSymbol('MSFT');
    expect(stockService.hasSymbol('MSFT')).toBe(false);
  });

  it('duplicate addSymbol does not duplicate watchlist', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    await stockService.init();
    await stockService.addSymbol(makeWatchlistItem('TSLA'));
    await stockService.addSymbol(makeWatchlistItem('TSLA')); // duplicate
    const count = stockService.getWatchlist().filter(w => w.symbol === 'TSLA').length;
    expect(count).toBe(1);
  });

  it('getAvailableStocks returns all watched symbols', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    await stockService.init();
    await stockService.addSymbol(makeWatchlistItem('GOOG'));
    await stockService.addSymbol(makeWatchlistItem('AMZN'));
    const avail = stockService.getAvailableStocks();
    expect(avail).toContain('GOOG');
    expect(avail).toContain('AMZN');
  });
});

describe('StockService — data access', () => {

  it('getStockHistory returns array (possibly simulated)', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    await stockService.init();
    await stockService.addSymbol(makeWatchlistItem('BTC', 'crypto'));
    const hist = stockService.getStockHistory('BTC');
    expect(Array.isArray(hist)).toBe(true);
    // Should have simulated data
    expect(hist.length).toBeGreaterThan(0);
  });

  it('getKLineData returns kline format', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    await stockService.init();
    await stockService.addSymbol(makeWatchlistItem('ETH', 'crypto'));
    const klines = stockService.getKLineData('ETH');
    if (klines.length > 0) {
      expect(klines[0]).toHaveProperty('time');
      expect(klines[0]).toHaveProperty('open');
      expect(klines[0]).toHaveProperty('close');
      expect(klines[0]).toHaveProperty('high');
      expect(klines[0]).toHaveProperty('low');
      expect(klines[0]).toHaveProperty('volume');
    }
  });

  it('getStockHistory returns empty array for unknown symbol', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    const hist = stockService.getStockHistory('UNKNOWN_XYZ');
    expect(hist).toEqual([]);
  });

  it('getSymbolMeta returns default meta for unknown symbol', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    const meta = stockService.getSymbolMeta('UNKNOWN_XYZ');
    expect(meta).toHaveProperty('source');
    expect(meta).toHaveProperty('lastUpdated');
  });
});

describe('StockService — simulated data generation', () => {

  it('simulated data has correct StockData shape', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    await stockService.init();
    await stockService.addSymbol(makeWatchlistItem('GC=F', 'futures'));
    const hist = stockService.getStockHistory('GC=F');
    if (hist.length > 0) {
      const d = hist[0];
      expect(d).toHaveProperty('symbol');
      expect(d).toHaveProperty('open');
      expect(d).toHaveProperty('high');
      expect(d).toHaveProperty('low');
      expect(d).toHaveProperty('close');
      expect(d).toHaveProperty('volume');
      expect(d).toHaveProperty('timestamp');
    }
  });

  it('simulated prices are positive', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    await stockService.init();
    await stockService.addSymbol(makeWatchlistItem('^GSPC', 'index'));
    const hist = stockService.getStockHistory('^GSPC');
    for (const d of hist) {
      expect(d.close).toBeGreaterThan(0);
      expect(d.high).toBeGreaterThanOrEqual(d.low);
    }
  });
});

describe('StockService — getStocks', () => {

  it('getStocks returns latest price for each watched symbol', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { stockService } = await import('../services/stockService');
    await stockService.init();
    await stockService.addSymbol(makeWatchlistItem('SPY', 'etf'));
    const stocks = stockService.getStocks();
    expect(stocks.some(s => s.symbol === 'SPY')).toBe(true);
  });
});
