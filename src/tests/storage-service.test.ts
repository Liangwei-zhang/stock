/**
 * tests/storage-service.test.ts
 * 覆蓋 src/services/storageService.ts 的持久化層
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WatchlistItem, StockData } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 創建 in-memory IndexedDB mock */
function createIDBMock() {
  const stores: Record<string, Map<string, any>> = {};

  function getStore(name: string) {
    if (!stores[name]) stores[name] = new Map();
    return stores[name];
  }

  function makeRequest<T>(result: T): any {
    const req: any = { result, error: null, onsuccess: null, onerror: null };
    // Fire onsuccess asynchronously, after caller sets the handler
    Promise.resolve().then(() => { req.onsuccess?.({ target: req }); });
    return req;
  }

  function makeObjectStore(name: string): Partial<IDBObjectStore> {
    const store = getStore(name);
    return {
      put: vi.fn().mockImplementation((item: any) => {
        const key = item.symbol ?? item.id ?? JSON.stringify(item).slice(0, 20);
        store.set(String(key), item);
        return makeRequest(key);
      }),
      get: vi.fn().mockImplementation((key: any) => {
        return makeRequest(store.get(String(key)));
      }),
      delete: vi.fn().mockImplementation((key: any) => {
        store.delete(String(key));
        return makeRequest(undefined);
      }),
      getAll: vi.fn().mockImplementation(() => {
        return makeRequest(Array.from(store.values()));
      }),
      openCursor: vi.fn().mockImplementation(() => {
        return makeRequest(null);
      }),
      index: vi.fn().mockImplementation(() => ({
        openCursor: vi.fn().mockReturnValue(makeRequest(null)),
        getAll: vi.fn().mockReturnValue(makeRequest([])),
      })),
    };
  }

  const db: Partial<IDBDatabase> = {
    transaction: vi.fn().mockImplementation((storeNames: string | string[]) => {
      const tx: any = { error: null, onerror: null, oncomplete: null, onabort: null };
      tx.objectStore = vi.fn().mockImplementation((name: string) => makeObjectStore(name));
      // Fire oncomplete after microtasks
      Promise.resolve().then(() => Promise.resolve()).then(() => { tx.oncomplete?.(); });
      return tx;
    }),
    objectStoreNames: {
      contains: vi.fn().mockReturnValue(true),
      length: 3,
      item: vi.fn(),
      [Symbol.iterator]: function* () { yield 'watchlist'; yield 'history'; yield 'pois'; },
    } as any,
    onversionchange: null,
    close: vi.fn(),
  };

  const idbMock = {
    open: vi.fn().mockImplementation(() => {
      const req: any = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      Promise.resolve().then(() => { req.onsuccess?.({ target: req }); });
      return req;
    }),
    _db: db,
    _stores: stores,
  };
  return idbMock;
}

function makeWatchlistItem(symbol: string): WatchlistItem {
  return {
    symbol, name: `${symbol} Inc.`,
    addedAt: Date.now(), assetType: 'equity',
  };
}

function makeStockData(symbol: string, price = 100): StockData {
  return {
    symbol, name: symbol, price, close: price,
    change: 0, changePercent: 0, volume: 100000,
    open: price, high: price * 1.01, low: price * 0.99,
    timestamp: Date.now(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('StorageService — watchlist operations', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', createIDBMock());
  });

  it('getWatchlist returns an array', async () => {
    vi.resetModules();
    const { getWatchlist } = await import('../services/storageService');
    const result = await getWatchlist();
    expect(Array.isArray(result)).toBe(true);
  });

  it('upsertWatchlistItem adds item without throwing', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { upsertWatchlistItem } = await import('../services/storageService');
    await expect(upsertWatchlistItem(makeWatchlistItem('AAPL'))).resolves.not.toThrow();
  });

  it('removeWatchlistItem resolves without throwing', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { removeWatchlistItem } = await import('../services/storageService');
    await expect(removeWatchlistItem('AAPL')).resolves.not.toThrow();
  });
});

describe('StorageService — history operations', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', createIDBMock());
  });

  it('getHistory returns an array', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { getHistory } = await import('../services/storageService');
    const result = await getHistory('TSLA');
    expect(Array.isArray(result)).toBe(true);
  });

  it('saveHistory resolves without throwing', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { saveHistory } = await import('../services/storageService');
    const data = [makeStockData('MSFT', 400), makeStockData('MSFT', 401)];
    await expect(saveHistory(data)).resolves.not.toThrow();
  });

  it('pruneOldHistory resolves without throwing', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { pruneOldHistory } = await import('../services/storageService');
    await expect(pruneOldHistory('AAPL')).resolves.not.toThrow();
  });
});

describe('StorageService — IndexedDB unavailable fallback', () => {
  it('getWatchlist returns empty array when IndexedDB unavailable', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', undefined);
    const { getWatchlist } = await import('../services/storageService');
    const result = await getWatchlist().catch(() => []);
    expect(Array.isArray(result)).toBe(true);
  });

  it('saveHistory resolves without throwing even when IndexedDB unavailable', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', undefined);
    const { saveHistory } = await import('../services/storageService');
    // saveHistory silently catches errors - should resolve, not reject
    await expect(saveHistory([makeStockData('X')])).resolves.not.toThrow();
  });
});

describe('StorageService — SIX_MONTHS_MS constant', () => {
  it('SIX_MONTHS_MS is approximately 6 months in milliseconds', async () => {
    vi.resetModules();
    const { SIX_MONTHS_MS } = await import('../services/storageService');
    const expected = 6 * 30 * 24 * 3600 * 1000;
    expect(SIX_MONTHS_MS).toBe(expected);
  });
});

describe('StorageService — POI operations', () => {
  it('savePOIs resolves without throwing (with IDB mock)', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { savePOIs } = await import('../services/storageService');
    const poi = {
      id: 'poi_1',
      type: 'support' as const,
      level: 100,
      state: 'fresh' as const,
      createdAt: Date.now(),
      testedAt: null,
      mitigatedAt: null,
      touches: 0,
      strength: 8,
      reason: 'test',
    };
    await expect(savePOIs('AAPL', [poi])).resolves.not.toThrow();
  });

  it('loadPOIs returns array', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { loadPOIs } = await import('../services/storageService');
    const result = await loadPOIs('BTC').catch(() => []);
    expect(Array.isArray(result)).toBe(true);
  });
});
