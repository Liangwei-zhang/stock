/**
 * src/tests/data-source-registry.test.ts — 數據源注冊表測試
 *
 * 覆蓋：
 *  - core/data-source-registry.ts  DataSourceRegistry (register, unregister, fetchHistory, fetchQuote,
 *                                  getAdapterChain, listAdapters, config overrides, fallback)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IDataSourceAdapter, QuoteData } from '../core/types';
import type { AssetType, StockData } from '../types';

// ─── Helper: 建立 mock 適配器 ──────────────────────────────────────────────

function makeAdapter(
  id: string,
  priority: number,
  assetTypes: AssetType[],
  opts: { available?: boolean; history?: StockData[]; quote?: QuoteData | null } = {},
): IDataSourceAdapter {
  const { available = true, history = [], quote = null } = opts;

  const mockHistory: StockData[] = history.length > 0 ? history : [{
    symbol: 'TEST', name: 'Test', price: 100, close: 100,
    open: 99, high: 101, low: 98,
    volume: 1000, change: 1, changePercent: 1,
    timestamp: Date.now(),
  }];

  return {
    id,
    name: `Adapter ${id}`,
    priority,
    supportedAssetTypes: assetTypes,
    isAvailable:  vi.fn().mockResolvedValue(available),
    fetchHistory: vi.fn().mockResolvedValue(mockHistory),
    fetchQuote:   vi.fn().mockResolvedValue(quote ?? {
      symbol: 'TEST', price: 100, change: 1, changePercent: 1, volume: 1000, timestamp: Date.now(),
    }),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  DataSourceRegistry
// ══════════════════════════════════════════════════════════════════════════════

describe('data-source-registry.ts — DataSourceRegistry', () => {
  let registry: any;

  beforeEach(async () => {
    vi.stubGlobal('localStorage', {
      _store: {} as Record<string, string>,
      getItem(k: string) { return (this as any)._store[k] ?? null; },
      setItem(k: string, v: string) { (this as any)._store[k] = v; },
      removeItem(k: string) { delete (this as any)._store[k]; },
    });
    vi.resetModules();
    const mod = await import('../core/data-source-registry');
    registry = mod.dataSourceRegistry;
    // Clean up any pre-registered adapters
    for (const a of registry.listAdapters()) {
      registry.unregister(a.id);
    }
  });

  it('register() adds an adapter to the list', () => {
    const adapter = makeAdapter('test-a', 1, ['equity']);
    registry.register(adapter);
    expect(registry.listAdapters().length).toBe(1);
    expect(registry.listAdapters()[0].id).toBe('test-a');
  });

  it('register() overwrites existing adapter with same id', () => {
    registry.register(makeAdapter('dup', 1, ['equity']));
    registry.register(makeAdapter('dup', 2, ['crypto']));
    expect(registry.listAdapters().length).toBe(1);
    expect(registry.listAdapters()[0].priority).toBe(2);
  });

  it('unregister() removes an adapter', () => {
    registry.register(makeAdapter('a', 1, ['equity']));
    registry.unregister('a');
    expect(registry.listAdapters().length).toBe(0);
  });

  it('listAdapters() returns all adapters with status info', () => {
    registry.register(makeAdapter('b1', 1, ['equity']));
    registry.register(makeAdapter('b2', 2, ['crypto']));
    const list = registry.listAdapters();
    expect(list.length).toBe(2);
    list.forEach((a: any) => {
      expect(typeof a.id).toBe('string');
      expect(typeof a.priority).toBe('number');
      expect(typeof a.disabled).toBe('boolean');
      expect(Array.isArray(a.assetTypes)).toBe(true);
    });
  });

  it('getAdapterChain() returns available adapters for assetType sorted by priority', async () => {
    registry.register(makeAdapter('low', 10, ['equity'], { available: true }));
    registry.register(makeAdapter('high', 1, ['equity'], { available: true }));
    const chain = await registry.getAdapterChain('equity');
    expect(chain.length).toBe(2);
    expect(chain[0].id).toBe('high');
  });

  it('getAdapterChain() excludes unavailable adapters', async () => {
    registry.register(makeAdapter('avail',   1, ['equity'], { available: true }));
    registry.register(makeAdapter('unavail', 2, ['equity'], { available: false }));
    const chain = await registry.getAdapterChain('equity');
    expect(chain.every((a: any) => a.id !== 'unavail')).toBe(true);
  });

  it('getAdapterChain() respects disabled list', async () => {
    registry.register(makeAdapter('disabled-a', 1, ['equity'], { available: true }));
    registry.setDisabled('disabled-a', true);
    const chain = await registry.getAdapterChain('equity');
    expect(chain.length).toBe(0);
  });

  it('getAdapterChain() with override returns override adapter only', async () => {
    registry.register(makeAdapter('primary', 1, ['equity'], { available: true }));
    registry.register(makeAdapter('override', 5, ['equity'], { available: true }));
    registry.setOverride('equity', 'override');
    const chain = await registry.getAdapterChain('equity');
    expect(chain.length).toBe(1);
    expect(chain[0].id).toBe('override');
  });

  it('setOverride() with null removes override', async () => {
    registry.register(makeAdapter('p1', 1, ['equity'], { available: true }));
    registry.register(makeAdapter('p2', 5, ['equity'], { available: true }));
    registry.setOverride('equity', 'p2');
    registry.setOverride('equity', null);
    const chain = await registry.getAdapterChain('equity');
    // Should now include both adapters
    expect(chain.length).toBe(2);
  });

  it('fetchHistory() returns data from first available adapter', async () => {
    const adapter = makeAdapter('h1', 1, ['equity'], { history: [{
      symbol: 'AAPL', name: 'Apple', price: 200, close: 200,
      open: 198, high: 202, low: 197,
      volume: 5000, change: 2, changePercent: 1,
      timestamp: Date.now(),
    }] });
    registry.register(adapter);
    const data = await registry.fetchHistory('AAPL', 'equity');
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].symbol).toBe('AAPL');
  });

  it('fetchHistory() falls back to next adapter when first fails', async () => {
    const failing  = makeAdapter('fail', 1, ['equity'], { available: true });
    const fallback = makeAdapter('back', 2, ['equity'], { history: [{
      symbol: 'AAPL', name: 'Apple', price: 200, close: 200,
      open: 198, high: 202, low: 197,
      volume: 5000, change: 2, changePercent: 1,
      timestamp: Date.now(),
    }] });
    (failing.fetchHistory as any).mockRejectedValue(new Error('fetch error'));
    registry.register(failing);
    registry.register(fallback);
    const data = await registry.fetchHistory('AAPL', 'equity');
    expect(data.length).toBeGreaterThan(0);
  });

  it('fetchHistory() returns empty array when all adapters fail', async () => {
    const a1 = makeAdapter('f1', 1, ['equity']);
    const a2 = makeAdapter('f2', 2, ['equity']);
    (a1.fetchHistory as any).mockRejectedValue(new Error('fail'));
    (a2.fetchHistory as any).mockRejectedValue(new Error('fail'));
    registry.register(a1);
    registry.register(a2);
    const data = await registry.fetchHistory('AAPL', 'equity');
    expect(data).toEqual([]);
  });

  it('fetchHistory() returns empty array when no adapters registered', async () => {
    const data = await registry.fetchHistory('AAPL', 'equity');
    expect(data).toEqual([]);
  });

  it('fetchQuote() returns quote from first adapter', async () => {
    const mockQuote: QuoteData = {
      symbol: 'BTC', price: 50000, change: 500, changePercent: 1, volume: 100000, timestamp: Date.now(),
    };
    registry.register(makeAdapter('q1', 1, ['crypto'], { quote: mockQuote }));
    const quote = await registry.fetchQuote('BTC', 'crypto');
    expect(quote).not.toBeNull();
    expect(quote!.symbol).toBe('BTC');
    expect(quote!.price).toBe(50000);
  });

  it('fetchQuote() falls back when first adapter returns null', async () => {
    const a1 = makeAdapter('noquote', 1, ['crypto'], { quote: null });
    const mockQuote: QuoteData = {
      symbol: 'BTC', price: 50000, change: 0, changePercent: 0, volume: 0, timestamp: Date.now(),
    };
    const a2 = makeAdapter('hasquote', 2, ['crypto'], { quote: mockQuote });
    (a1.fetchQuote as any).mockResolvedValue(null);
    registry.register(a1);
    registry.register(a2);
    const quote = await registry.fetchQuote('BTC', 'crypto');
    expect(quote).not.toBeNull();
  });

  it('fetchQuote() returns null when all fail', async () => {
    const a = makeAdapter('qfail', 1, ['crypto']);
    (a.fetchQuote as any).mockRejectedValue(new Error('fail'));
    registry.register(a);
    const quote = await registry.fetchQuote('BTC', 'crypto');
    expect(quote).toBeNull();
  });

  it('getConfig() returns a copy of the current config', () => {
    const cfg = registry.getConfig();
    expect(cfg).toBeDefined();
    expect(typeof cfg.overrides).toBe('object');
    expect(Array.isArray(cfg.disabled)).toBe(true);
  });

  it('updateConfig() merges new config values', () => {
    registry.updateConfig({ disabled: ['some-adapter'] });
    const cfg = registry.getConfig();
    expect(cfg.disabled).toContain('some-adapter');
  });

  it('adapters with supportedAssetTypes=other match any assetType', async () => {
    registry.register(makeAdapter('universal', 5, ['other'], { available: true }));
    const chain = await registry.getAdapterChain('equity');
    expect(chain.find((a: any) => a.id === 'universal')).toBeDefined();
  });
});
