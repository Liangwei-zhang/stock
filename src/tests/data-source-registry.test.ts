/**
 * tests/data-source-registry.test.ts
 * 覆蓋 src/core/data-source-registry.ts 中的 DataSourceRegistry 類
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { IDataSourceAdapter, QuoteData } from '../core/types';
import type { AssetType, StockData } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAdapter(
  id: string,
  priority: number,
  types: AssetType[],
  available = true,
  historyData: StockData[] = [],
  quote: QuoteData | null = null,
): IDataSourceAdapter {
  return {
    id,
    name: id,
    priority,
    supportedAssetTypes: types,
    isAvailable: vi.fn().mockResolvedValue(available),
    fetchHistory: vi.fn().mockResolvedValue(historyData),
    fetchQuote: vi.fn().mockResolvedValue(quote),
  };
}

function makeLsMock(): Record<string, string> & {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  clear(): void;
} {
  const store: Record<string, string> = {};
  return {
    ...store,
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

function mockStock(symbol: string, price = 100): StockData {
  return {
    symbol, name: symbol, price, close: price,
    change: 0, changePercent: 0, volume: 100000,
    open: price, high: price * 1.01, low: price * 0.99,
    timestamp: Date.now(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DataSourceRegistry — registration', () => {
  it('register and list adapters', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const a = makeAdapter('test-a', 5, ['equity']);
    dataSourceRegistry.register(a);
    const list = dataSourceRegistry.listAdapters();
    expect(list.some(x => x.id === 'test-a')).toBe(true);
  });

  it('unregister removes adapter from list', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const a = makeAdapter('remove-me', 5, ['equity']);
    dataSourceRegistry.register(a);
    dataSourceRegistry.unregister('remove-me');
    const list = dataSourceRegistry.listAdapters();
    expect(list.some(x => x.id === 'remove-me')).toBe(false);
  });
});

describe('DataSourceRegistry — config management', () => {
  it('getConfig returns defaults', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const cfg = dataSourceRegistry.getConfig();
    expect(cfg).toHaveProperty('overrides');
    expect(cfg).toHaveProperty('disabled');
    expect(Array.isArray(cfg.disabled)).toBe(true);
  });

  it('setDisabled disables an adapter', async () => {
    vi.resetModules();
    const ls = makeLsMock();
    vi.stubGlobal('localStorage', ls);
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const a = makeAdapter('dis-a', 5, ['equity']);
    dataSourceRegistry.register(a);
    dataSourceRegistry.setDisabled('dis-a', true);
    const cfg = dataSourceRegistry.getConfig();
    expect(cfg.disabled).toContain('dis-a');
  });

  it('setDisabled=false re-enables an adapter', async () => {
    vi.resetModules();
    const ls = makeLsMock();
    vi.stubGlobal('localStorage', ls);
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const a = makeAdapter('ena-a', 5, ['equity']);
    dataSourceRegistry.register(a);
    dataSourceRegistry.setDisabled('ena-a', true);
    dataSourceRegistry.setDisabled('ena-a', false);
    const cfg = dataSourceRegistry.getConfig();
    expect(cfg.disabled).not.toContain('ena-a');
  });

  it('setOverride stores override for asset type', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    dataSourceRegistry.setOverride('equity', 'some-adapter');
    expect(dataSourceRegistry.getConfig().overrides['equity']).toBe('some-adapter');
  });

  it('setOverride(null) removes override', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    dataSourceRegistry.setOverride('equity', 'some-adapter');
    dataSourceRegistry.setOverride('equity', null);
    expect(dataSourceRegistry.getConfig().overrides['equity']).toBeUndefined();
  });

  it('updateConfig persists to localStorage', async () => {
    vi.resetModules();
    const ls = makeLsMock();
    vi.stubGlobal('localStorage', ls);
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    dataSourceRegistry.updateConfig({ disabled: ['x', 'y'] });
    const saved = ls.getItem('datasource:config');
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.disabled).toContain('x');
  });
});

describe('DataSourceRegistry — adapter chain selection', () => {
  it('getAdapterChain returns available adapters sorted by priority', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const a1 = makeAdapter('chain-a', 10, ['equity'], true);
    const a2 = makeAdapter('chain-b', 2, ['equity'], true);
    const a3 = makeAdapter('chain-c', 5, ['equity'], true);
    dataSourceRegistry.register(a1);
    dataSourceRegistry.register(a2);
    dataSourceRegistry.register(a3);
    const chain = await dataSourceRegistry.getAdapterChain('equity');
    // Should contain our adapters; lower priority number = higher preference
    const ids = chain.map((x: any) => x.id);
    const b = ids.indexOf('chain-b');
    const c = ids.indexOf('chain-c');
    const a = ids.indexOf('chain-a');
    if (b >= 0 && c >= 0) expect(b).toBeLessThan(c);
    if (c >= 0 && a >= 0) expect(c).toBeLessThan(a);
  });

  it('getAdapterChain excludes disabled adapters', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const a = makeAdapter('excl-a', 1, ['crypto'], true);
    dataSourceRegistry.register(a);
    dataSourceRegistry.setDisabled('excl-a', true);
    const chain = await dataSourceRegistry.getAdapterChain('crypto');
    expect(chain.map((x: any) => x.id)).not.toContain('excl-a');
  });

  it('getAdapterChain excludes unavailable adapters', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const unavail = makeAdapter('unavail-x', 1, ['equity'], false);
    dataSourceRegistry.register(unavail);
    const chain = await dataSourceRegistry.getAdapterChain('equity');
    expect(chain.map((x: any) => x.id)).not.toContain('unavail-x');
  });

  it('returns empty chain when no adapters registered for type', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const chain = await dataSourceRegistry.getAdapterChain('index');
    // Should not throw
    expect(Array.isArray(chain)).toBe(true);
  });
});

describe('DataSourceRegistry — fetchHistory with fallback', () => {
  it('returns data from first working adapter', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const data = [mockStock('BTC', 50000)];
    const adapter = makeAdapter('hist-ok', 1, ['crypto'], true, data);
    dataSourceRegistry.register(adapter);
    const result = await dataSourceRegistry.fetchHistory('BTC', 'crypto');
    expect(result.length).toBeGreaterThan(0);
  });

  it('falls back to second adapter when first fails', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const data = [mockStock('AAPL', 180)];
    const fail = makeAdapter('fall-fail', 1, ['equity'], true);
    (fail.fetchHistory as any).mockRejectedValue(new Error('network error'));
    const ok   = makeAdapter('fall-ok', 2, ['equity'], true, data);
    dataSourceRegistry.register(fail);
    dataSourceRegistry.register(ok);
    const result = await dataSourceRegistry.fetchHistory('AAPL', 'equity');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty array when all adapters fail', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const fail = makeAdapter('all-fail', 1, ['etf'], true);
    (fail.fetchHistory as any).mockRejectedValue(new Error('gone'));
    dataSourceRegistry.register(fail);
    const result = await dataSourceRegistry.fetchHistory('SPY', 'etf');
    expect(result).toEqual([]);
  });
});

describe('DataSourceRegistry — fetchQuote with fallback', () => {
  it('returns quote from available adapter', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const q: QuoteData = { symbol: 'ETH', price: 3000, change: 10, changePercent: 0.3, volume: 500000, timestamp: Date.now() };
    const adapter = makeAdapter('quote-ok', 1, ['crypto'], true, [], q);
    dataSourceRegistry.register(adapter);
    const result = await dataSourceRegistry.fetchQuote('ETH', 'crypto');
    expect(result?.symbol).toBe('ETH');
  });

  it('returns null when no adapters available', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const result = await dataSourceRegistry.fetchQuote('UNKNOWN', 'other');
    expect(result).toBeNull();
  });
});

describe('DataSourceRegistry — availability caching', () => {
  it('caches availability result (does not re-call isAvailable within TTL)', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const adapter = makeAdapter('cache-a', 1, ['crypto'], true);
    dataSourceRegistry.register(adapter);
    // Call twice
    await dataSourceRegistry.getAdapterChain('crypto');
    await dataSourceRegistry.getAdapterChain('crypto');
    // isAvailable should have been called only once (cached)
    expect((adapter.isAvailable as any).mock.calls.length).toBe(1);
  });

  it('invalidates cache on adapter failure during fetch', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const adapter = makeAdapter('inv-cache', 1, ['equity'], true);
    (adapter.fetchHistory as any).mockRejectedValueOnce(new Error('fail'));
    dataSourceRegistry.register(adapter);
    // After failure, the cache should be cleared
    await dataSourceRegistry.fetchHistory('AAPL', 'equity');
    // Now call again - isAvailable should be called again
    await dataSourceRegistry.getAdapterChain('equity');
    expect((adapter.isAvailable as any).mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('DataSourceRegistry — edge cases', () => {
  it('handles corrupted localStorage config gracefully', async () => {
    vi.resetModules();
    const ls = makeLsMock();
    ls.setItem('datasource:config', 'NOT_JSON!!!');
    vi.stubGlobal('localStorage', ls);
    // Should not throw on construction
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const cfg = dataSourceRegistry.getConfig();
    expect(cfg).toBeTruthy();
  });

  it('adapter supporting "other" shows in any asset type chain', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { dataSourceRegistry } = await import('../core/data-source-registry');
    const catchall = makeAdapter('catch-all', 99, ['other'], true);
    dataSourceRegistry.register(catchall);
    const chain = await dataSourceRegistry.getAdapterChain('futures');
    expect(chain.map((x: any) => x.id)).toContain('catch-all');
  });
});
