/**
 * src/tests/search-service.test.ts — 搜索服務測試
 *
 * 覆蓋：
 *  - services/searchService.ts  searchSymbols(), getSymbolInfo(), assetTypeLabel(), assetTypeColor()
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ══════════════════════════════════════════════════════════════════════════════
//  1. assetTypeLabel() and assetTypeColor() — 純函數，無外部依賴
// ══════════════════════════════════════════════════════════════════════════════

describe('searchService.ts — assetTypeLabel', () => {
  it('equity returns 股票', async () => {
    const { assetTypeLabel } = await import('../services/searchService');
    expect(assetTypeLabel('equity')).toBe('股票');
  });

  it('etf returns ETF', async () => {
    const { assetTypeLabel } = await import('../services/searchService');
    expect(assetTypeLabel('etf')).toBe('ETF');
  });

  it('futures returns 期货', async () => {
    const { assetTypeLabel } = await import('../services/searchService');
    expect(assetTypeLabel('futures')).toBe('期货');
  });

  it('index returns 指数', async () => {
    const { assetTypeLabel } = await import('../services/searchService');
    expect(assetTypeLabel('index')).toBe('指数');
  });

  it('crypto returns 加密', async () => {
    const { assetTypeLabel } = await import('../services/searchService');
    expect(assetTypeLabel('crypto')).toBe('加密');
  });

  it('other returns 其他', async () => {
    const { assetTypeLabel } = await import('../services/searchService');
    expect(assetTypeLabel('other')).toBe('其他');
  });
});

describe('searchService.ts — assetTypeColor', () => {
  it('equity returns blue', async () => {
    const { assetTypeColor } = await import('../services/searchService');
    expect(assetTypeColor('equity')).toBe('blue');
  });

  it('etf returns cyan', async () => {
    const { assetTypeColor } = await import('../services/searchService');
    expect(assetTypeColor('etf')).toBe('cyan');
  });

  it('futures returns gold', async () => {
    const { assetTypeColor } = await import('../services/searchService');
    expect(assetTypeColor('futures')).toBe('gold');
  });

  it('index returns purple', async () => {
    const { assetTypeColor } = await import('../services/searchService');
    expect(assetTypeColor('index')).toBe('purple');
  });

  it('crypto returns orange', async () => {
    const { assetTypeColor } = await import('../services/searchService');
    expect(assetTypeColor('crypto')).toBe('orange');
  });

  it('other returns default', async () => {
    const { assetTypeColor } = await import('../services/searchService');
    expect(assetTypeColor('other')).toBe('default');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  2. POPULAR_ASSETS
// ══════════════════════════════════════════════════════════════════════════════

describe('searchService.ts — POPULAR_ASSETS', () => {
  it('contains expected popular assets', async () => {
    const { POPULAR_ASSETS } = await import('../services/searchService');
    expect(Array.isArray(POPULAR_ASSETS)).toBe(true);
    expect(POPULAR_ASSETS.length).toBeGreaterThan(10);
  });

  it('each asset has required fields', async () => {
    const { POPULAR_ASSETS } = await import('../services/searchService');
    POPULAR_ASSETS.forEach(a => {
      expect(typeof a.symbol).toBe('string');
      expect(a.symbol.length).toBeGreaterThan(0);
      expect(typeof a.name).toBe('string');
      expect(typeof a.assetType).toBe('string');
      expect(typeof a.exchange).toBe('string');
    });
  });

  it('contains BTC in crypto assets', async () => {
    const { POPULAR_ASSETS } = await import('../services/searchService');
    const btc = POPULAR_ASSETS.find(a => a.symbol === 'BTC');
    expect(btc).toBeDefined();
    expect(btc!.assetType).toBe('crypto');
  });

  it('contains AAPL in equity assets', async () => {
    const { POPULAR_ASSETS } = await import('../services/searchService');
    const aapl = POPULAR_ASSETS.find(a => a.symbol === 'AAPL');
    expect(aapl).toBeDefined();
    expect(aapl!.assetType).toBe('equity');
  });

  it('contains GLD as ETF', async () => {
    const { POPULAR_ASSETS } = await import('../services/searchService');
    const gld = POPULAR_ASSETS.find(a => a.symbol === 'GLD');
    expect(gld).toBeDefined();
    expect(gld!.assetType).toBe('etf');
  });

  it('symbol list has no duplicates', async () => {
    const { POPULAR_ASSETS } = await import('../services/searchService');
    const symbols = POPULAR_ASSETS.map(a => a.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  3. searchSymbols() — with mocked fetch
// ══════════════════════════════════════════════════════════════════════════════

describe('searchService.ts — searchSymbols', () => {
  beforeEach(() => {
    vi.resetModules();
    // Default: fetch fails (simulate offline)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
  });

  it('empty query returns POPULAR_ASSETS', async () => {
    const { searchSymbols, POPULAR_ASSETS } = await import('../services/searchService');
    const results = await searchSymbols('');
    expect(results).toEqual(POPULAR_ASSETS);
  });

  it('whitespace-only query returns POPULAR_ASSETS', async () => {
    const { searchSymbols, POPULAR_ASSETS } = await import('../services/searchService');
    const results = await searchSymbols('   ');
    expect(results).toEqual(POPULAR_ASSETS);
  });

  it('falls back to local popular assets when fetch fails', async () => {
    const { searchSymbols } = await import('../services/searchService');
    const results = await searchSymbols('BTC');
    // Should at least contain BTC from POPULAR_ASSETS
    const btc = results.find(r => r.symbol === 'BTC');
    expect(btc).toBeDefined();
  });

  it('local filter returns partial match on symbol', async () => {
    const { searchSymbols } = await import('../services/searchService');
    const results = await searchSymbols('AAPL');
    expect(results.find(r => r.symbol === 'AAPL')).toBeDefined();
  });

  it('local filter returns partial match on name', async () => {
    const { searchSymbols } = await import('../services/searchService');
    // "bitcoin" partial match on name for BTC
    const results = await searchSymbols('bitcoin');
    expect(results.find(r => r.symbol === 'BTC')).toBeDefined();
  });

  it('returns empty array for no match on unknown query', async () => {
    const { searchSymbols } = await import('../services/searchService');
    const results = await searchSymbols('ZZZZUNKNOWN999');
    expect(results.length).toBe(0);
  });

  it('uses cached results for same query within 30s', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        quotes: [
          { isYahooFinance: true, symbol: 'TSLA', longname: 'Tesla', quoteType: 'EQUITY', exchange: 'NMS' }
        ]
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { searchSymbols } = await import('../services/searchService');
    await searchSymbols('TSLA');
    await searchSymbols('TSLA');
    // fetch should be called once (second request uses cache)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('merges remote and local results, remote first', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        quotes: [
          { isYahooFinance: true, symbol: 'CUSTOM', longname: 'Custom Asset', quoteType: 'EQUITY', exchange: 'NMS' }
        ]
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { searchSymbols } = await import('../services/searchService');
    const results = await searchSymbols('cust');
    const custom = results.find(r => r.symbol === 'CUSTOM');
    expect(custom).toBeDefined();
    expect(custom!.assetType).toBe('equity');
  });

  it('filters out non-Yahoo entries from remote results', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        quotes: [
          { isYahooFinance: false, symbol: 'FAKE', longname: 'Fake', quoteType: 'EQUITY', exchange: 'NMS' },
          { isYahooFinance: true,  symbol: 'REAL', longname: 'Real', quoteType: 'ETF',    exchange: 'PCX' },
        ]
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { searchSymbols } = await import('../services/searchService');
    const results = await searchSymbols('real');
    expect(results.find(r => r.symbol === 'FAKE')).toBeUndefined();
    expect(results.find(r => r.symbol === 'REAL')).toBeDefined();
  });

  it('returns local results when API returns non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { searchSymbols } = await import('../services/searchService');
    const results = await searchSymbols('BTC');
    const btc = results.find(r => r.symbol === 'BTC');
    expect(btc).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  4. getSymbolInfo()
// ══════════════════════════════════════════════════════════════════════════════

describe('searchService.ts — getSymbolInfo', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
  });

  it('returns preset for known popular symbol', async () => {
    const { getSymbolInfo } = await import('../services/searchService');
    const result = await getSymbolInfo('BTC');
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('BTC');
    expect(result!.assetType).toBe('crypto');
  });

  it('returns null for completely unknown symbol with no network', async () => {
    const { getSymbolInfo } = await import('../services/searchService');
    const result = await getSymbolInfo('XYZUNKNOWN999');
    expect(result).toBeNull();
  });

  it('returns preset for AAPL without network', async () => {
    const { getSymbolInfo } = await import('../services/searchService');
    const result = await getSymbolInfo('AAPL');
    expect(result).not.toBeNull();
    expect(result!.assetType).toBe('equity');
  });
});
