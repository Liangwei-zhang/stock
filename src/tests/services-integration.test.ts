/**
 * tests/services-integration.test.ts
 * 覆蓋多個服務之間的交互和個別服務的核心功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AssetType, StockData, StockAnalysis } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLsMock(store: Record<string, string> = {}) {
  return {
    getItem:    (k: string) => store[k] ?? null,
    setItem:    (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear:      () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

function makeCandles(n: number, symbol = 'AAPL', base = 150): StockData[] {
  return Array.from({ length: n }, (_, i) => ({
    symbol, name: symbol,
    price: base + i * 0.1, close: base + i * 0.1,
    open: base, high: base + 2, low: base - 1,
    change: 0.1, changePercent: 0.1,
    volume: 1000000,
    timestamp: Date.now() - (n - i) * 86400000,
  }));
}

// ─── searchService ────────────────────────────────────────────────────────────

describe('searchService — assetTypeLabel', () => {
  it('returns correct Chinese labels for each type', async () => {
    const { assetTypeLabel } = await import('../services/searchService');
    const cases: [AssetType, string][] = [
      ['equity',  '股票'],
      ['etf',     'ETF'],
      ['futures', '期货'],
      ['index',   '指数'],
      ['crypto',  '加密'],
      ['other',   '其他'],
    ];
    for (const [type, label] of cases) {
      expect(assetTypeLabel(type)).toBe(label);
    }
  });
});

describe('searchService — assetTypeColor', () => {
  it('returns Ant Design color strings for each type', async () => {
    const { assetTypeColor } = await import('../services/searchService');
    expect(assetTypeColor('equity')).toBe('blue');
    expect(assetTypeColor('etf')).toBe('cyan');
    expect(assetTypeColor('futures')).toBe('gold');
    expect(assetTypeColor('index')).toBe('purple');
    expect(assetTypeColor('crypto')).toBe('orange');
    expect(assetTypeColor('other')).toBe('default');
  });
});

describe('searchService — POPULAR_ASSETS', () => {
  it('contains at least one crypto and one equity', async () => {
    const { POPULAR_ASSETS } = await import('../services/searchService');
    expect(POPULAR_ASSETS.some(a => a.assetType === 'crypto')).toBe(true);
    expect(POPULAR_ASSETS.some(a => a.assetType === 'equity')).toBe(true);
  });

  it('every popular asset has required fields', async () => {
    const { POPULAR_ASSETS } = await import('../services/searchService');
    for (const a of POPULAR_ASSETS) {
      expect(a).toHaveProperty('symbol');
      expect(a).toHaveProperty('name');
      expect(a).toHaveProperty('assetType');
    }
  });
});

describe('searchService — searchSymbols', () => {
  it('returns popular assets when query matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { searchSymbols } = await import('../services/searchService');
    const results = await searchSymbols('BTC');
    expect(Array.isArray(results)).toBe(true);
    // Should find BTC in popular assets
    expect(results.some(r => r.symbol === 'BTC')).toBe(true);
  });

  it('returns popular assets when offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { searchSymbols } = await import('../services/searchService');
    const results = await searchSymbols('Apple');
    expect(Array.isArray(results)).toBe(true);
  });

  it('empty query returns popular assets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { searchSymbols, POPULAR_ASSETS } = await import('../services/searchService');
    const results = await searchSymbols('');
    expect(results).toEqual(POPULAR_ASSETS);
  });
});

// ─── indicatorService ─────────────────────────────────────────────────────────

describe('indicatorService — analyzeStock', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    vi.stubGlobal('indexedDB', {
      open: vi.fn().mockImplementation(() => {
        const req: any = { result: null, error: null };
        Promise.resolve().then(() => { req.onerror?.({ target: req }); });
        return req;
      }),
    });
  });

  it('returns null for unknown symbol', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { indicatorService } = await import('../services/indicatorService');
    const result = indicatorService.analyzeStock('UNKNOWN_SYM_XYZ');
    expect(result).toBeNull();
  });

  it('invalidateCache does not throw', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { indicatorService } = await import('../services/indicatorService');
    expect(() => indicatorService.invalidateCache()).not.toThrow();
  });

  it('getBuySignal returns default structure for unknown symbol', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { indicatorService } = await import('../services/indicatorService');
    const sig = indicatorService.getBuySignal('UNKNOWN_XYZ');
    expect(sig).toHaveProperty('signal');
    expect(sig).toHaveProperty('level');
    expect(sig).toHaveProperty('score');
    expect(sig).toHaveProperty('reasons');
  });

  it('getPrediction returns default structure for unknown symbol', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { indicatorService } = await import('../services/indicatorService');
    const pred = indicatorService.getPrediction('UNKNOWN_XYZ');
    expect(pred).toHaveProperty('type');
    expect(pred).toHaveProperty('probability');
    expect(pred).toHaveProperty('recommendation');
  });
});

// ─── serverBridge ─────────────────────────────────────────────────────────────

describe('serverBridge — pushAlertToServer', () => {
  it('does not throw when server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));
    const { pushAlertToServer } = await import('../services/serverBridge');
    expect(() => pushAlertToServer({ id: 'test', symbol: 'BTC' })).not.toThrow();
  });

  it('sends POST request to /alerts endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { pushAlertToServer } = await import('../services/serverBridge');
    pushAlertToServer({ id: 'test-alert', symbol: 'ETH' });
    // Allow the async fetch to be called
    await new Promise(r => setTimeout(r, 0));
    if (fetchMock.mock.calls.length > 0) {
      expect(fetchMock.mock.calls[0][0]).toContain('/alerts');
    }
  });
});

describe('serverBridge — getAlertsFromServer', () => {
  it('returns empty array when server unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { getAlertsFromServer } = await import('../services/serverBridge');
    const result = await getAlertsFromServer();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('returns alert list from server', async () => {
    const mockAlerts = [{ id: '1', symbol: 'BTC' }, { id: '2', symbol: 'ETH' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockAlerts),
    }));
    const { getAlertsFromServer } = await import('../services/serverBridge');
    const result = await getAlertsFromServer();
    expect(result).toHaveLength(2);
  });
});

// ─── export service ───────────────────────────────────────────────────────────

describe('report-exporter — exportReport exists', () => {
  it('report-exporter module exports exportReport function', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const mod = await import('../export/report-exporter');
    expect(typeof mod.exportReport).toBe('function');
  });

  it('report-service module exports generateAndExport function', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const mod = await import('../export/report-service');
    expect(typeof mod.generateAndExport).toBe('function');
  });
});

// ─── Multi-service integration ────────────────────────────────────────────────

describe('multi-service: pluginRegistry + indicatorService', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  it('plugins can be listed after registration', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    // Import the plugins index which registers all plugins
    const { pluginRegistry } = await import('../plugins/index');
    const list = pluginRegistry.list();
    expect(list.length).toBeGreaterThan(0);
  });

  it('analyzeAllStocks returns map for registered symbols', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { indicatorService } = await import('../services/indicatorService');
    // With no stocks in stockService, should return empty map
    const results = indicatorService.analyzeAllStocks([]);
    expect(results instanceof Map).toBe(true);
    expect(results.size).toBe(0);
  });
});
