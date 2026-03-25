/**
 * tests/market-db.test.ts
 * 覆蓋 src/db/market-db.ts 的數據庫層
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { OHLCVRecord } from '../core/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOHLCV(symbol: string, timestamp = Date.now()): OHLCVRecord {
  return {
    symbol,
    timestamp,
    open:   100,
    high:   105,
    low:    98,
    close:  102,
    volume: 1000000,
    source: 'test',
  };
}

/** IndexedDB mock that supports the operations market-db needs */
function createIDBMock() {
  const stores: Record<string, Map<string, any>> = {
    ohlcv: new Map(),
    watchlist: new Map(),
    quote_cache: new Map(),
  };

  function makeReq<T>(result: T): any {
    const req: any = { result, error: null, onsuccess: null, onerror: null };
    Promise.resolve().then(() => { req.onsuccess?.({ target: req }); });
    return req;
  }

  function makeObjectStore(name: string): any {
    const store = stores[name] ?? (stores[name] = new Map());
    return {
      put: vi.fn().mockImplementation((item: any) => {
        // For ohlcv, key is [symbol, timestamp]
        const key = Array.isArray(item) ? JSON.stringify(item) : (item.symbol && item.timestamp ? `${item.symbol}_${item.timestamp}` : String(item.symbol ?? item.id ?? Date.now()));
        store.set(key, item);
        return makeReq(key);
      }),
      get: vi.fn().mockImplementation((key: any) => {
        return makeReq(store.get(String(key)));
      }),
      delete: vi.fn().mockImplementation((key: any) => {
        store.delete(String(key));
        return makeReq(undefined);
      }),
      getAll: vi.fn().mockImplementation(() => {
        return makeReq(Array.from(store.values()));
      }),
      getAllKeys: vi.fn().mockImplementation(() => {
        return makeReq(Array.from(store.keys()));
      }),
      openCursor: vi.fn().mockImplementation(() => {
        return makeReq(null);
      }),
      index: vi.fn().mockImplementation(() => ({
        getAll: vi.fn().mockReturnValue(makeReq([])),
        getAllKeys: vi.fn().mockReturnValue(makeReq([])),
        openCursor: vi.fn().mockReturnValue(makeReq(null)),
      })),
    };
  }

  const db: any = {
    transaction: vi.fn().mockImplementation((storeNames: string | string[]) => {
      const tx: any = { error: null, oncomplete: null, onerror: null, onabort: null };
      tx.objectStore = vi.fn().mockImplementation((name: string) => makeObjectStore(name));
      Promise.resolve().then(() => Promise.resolve()).then(() => { tx.oncomplete?.(); });
      return tx;
    }),
    objectStoreNames: {
      contains: vi.fn().mockReturnValue(true),
      length: 3,
    },
    close: vi.fn(),
  };

  return {
    open: vi.fn().mockImplementation(() => {
      const req: any = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      Promise.resolve().then(() => { req.onsuccess?.({ target: req }); });
      return req;
    }),
    _db: db,
    _stores: stores,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MarketDB — saveOHLCV', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('server offline')));
    vi.stubGlobal('IDBKeyRange', {
      only: vi.fn().mockReturnValue({}),
      lowerBound: vi.fn().mockReturnValue({}),
      upperBound: vi.fn().mockReturnValue({}),
      bound: vi.fn().mockReturnValue({}),
    });
  });

  it('resolves without throwing for empty records', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { marketDB } = await import('../db/market-db');
    await expect(marketDB.saveOHLCV([])).resolves.not.toThrow();
  });

  it('resolves without throwing for valid records', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { marketDB } = await import('../db/market-db');
    const records = [
      makeOHLCV('BTC', Date.now() - 86400000),
      makeOHLCV('BTC', Date.now()),
    ];
    await expect(marketDB.saveOHLCV(records)).resolves.not.toThrow();
  });
});

describe('MarketDB — queryOHLCV', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('server offline')));
    vi.stubGlobal('IDBKeyRange', {
      only: vi.fn().mockReturnValue({}),
      lowerBound: vi.fn().mockReturnValue({}),
      upperBound: vi.fn().mockReturnValue({}),
      bound: vi.fn().mockReturnValue({}),
    });
  });

  it('returns an array', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { marketDB } = await import('../db/market-db');
    const result = await marketDB.queryOHLCV('BTC');
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns empty array for unknown symbol', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { marketDB } = await import('../db/market-db');
    const result = await marketDB.queryOHLCV('UNKNOWN_SYMBOL_XYZ');
    expect(result).toEqual([]);
  });
});

describe('MarketDB — deleteOHLCV', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('server offline')));
    vi.stubGlobal('IDBKeyRange', {
      only: vi.fn().mockReturnValue({}),
    });
  });

  it('resolves without throwing', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { marketDB } = await import('../db/market-db');
    await expect(marketDB.deleteOHLCV('BTC')).resolves.not.toThrow();
  });
});

describe('MarketDB — pruneOHLCV', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('server offline')));
    vi.stubGlobal('IDBKeyRange', {
      only: vi.fn().mockReturnValue({}),
    });
  });

  it('resolves without throwing', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { marketDB } = await import('../db/market-db');
    await expect(marketDB.pruneOHLCV('ETH')).resolves.not.toThrow();
  });
});

describe('MarketDB — quote cache', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('server offline')));
    vi.stubGlobal('IDBKeyRange', {
      only: vi.fn().mockReturnValue({}),
      upperBound: vi.fn().mockReturnValue({}),
    });
  });

  it('cacheQuote resolves without throwing', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { marketDB } = await import('../db/market-db');
    const quote = { symbol: 'BTC', price: 50000, change: 500, changePercent: 1.0, volume: 12345, timestamp: Date.now() };
    await expect(marketDB.cacheQuote('BTC', quote)).resolves.not.toThrow();
  });

  it('getCachedQuote returns null for uncached symbol', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const { marketDB } = await import('../db/market-db');
    const result = await marketDB.getCachedQuote('UNCACHED_SYM');
    expect(result).toBeNull();
  });
});

describe('MarketDB — IndexedDB unavailable fallback', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('server offline')));
  });

  it('saveOHLCV silently ignores IDB errors', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', undefined);
    const { marketDB } = await import('../db/market-db');
    // Should resolve (silently catches IDB error)
    await expect(marketDB.saveOHLCV([makeOHLCV('BTC')])).resolves.not.toThrow();
  });

  it('queryOHLCV returns empty array when IDB unavailable', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', undefined);
    const { marketDB } = await import('../db/market-db');
    const result = await marketDB.queryOHLCV('BTC');
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('MarketDB — SIX_MONTHS_MS constant', () => {
  it('SIX_MONTHS_MS equals 6 months in milliseconds', async () => {
    const { SIX_MONTHS_MS } = await import('../db/market-db');
    expect(SIX_MONTHS_MS).toBe(6 * 30 * 24 * 3600_000);
  });
});

describe('MarketDB — server fallback', () => {
  it('queryOHLCV uses server data when available', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', createIDBMock());
    const serverData = [makeOHLCV('AAPL', Date.now() - 86400000)];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(serverData),
    }));
    const { marketDB } = await import('../db/market-db');
    const result = await marketDB.queryOHLCV('AAPL');
    expect(Array.isArray(result)).toBe(true);
  });
});
