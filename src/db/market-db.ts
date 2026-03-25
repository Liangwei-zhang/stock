/**
 * db/market-db.ts — 市场数据持久化层
 *
 * 双层架构：
 *   L1（本地）: IndexedDB  — 会话/离线缓存，毫秒级读写
 *   L2（服务器）: SQLite via REST — 持久化主库，跨会话跨设备
 *
 * 写入：先写 L1，再异步同步到 L2（fire-and-forget）
 * 读取：L2 可用且有更新数据时优先，否则降级 L1
 *
 * IndexedDB 表：
 *   ohlcv        — (symbol, timestamp) 复合主键
 *   watchlist    — keyPath: symbol
 *   quote_cache  — keyPath: symbol（实时报价，TTL 60s）
 */

import type { IMarketDB, OHLCVRecord } from '../core/types';

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const DB_NAME    = 'MarketDB_v3';
const DB_VERSION = 1;
const SERVER_URL = 'http://localhost:3001';

/** 保留 6 个月的历史数据 */
export const SIX_MONTHS_MS = 6 * 30 * 24 * 3600_000;

// ─── IndexedDB 单例 ───────────────────────────────────────────────────────────

let _idb: IDBDatabase | null = null;

function openIDB(): Promise<IDBDatabase> {
  if (_idb) return Promise.resolve(_idb);
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror = () => reject(req.error);
    req.onsuccess = () => { _idb = req.result; resolve(_idb); };

    req.onupgradeneeded = () => {
      const db = req.result;

      // OHLCV store
      if (!db.objectStoreNames.contains('ohlcv')) {
        const store = db.createObjectStore('ohlcv', { keyPath: ['symbol', 'timestamp'] });
        store.createIndex('by_symbol', 'symbol', { unique: false });
      }

      // Watchlist store
      if (!db.objectStoreNames.contains('watchlist')) {
        db.createObjectStore('watchlist', { keyPath: 'symbol' });
      }

      // Quote cache store
      if (!db.objectStoreNames.contains('quote_cache')) {
        const qs = db.createObjectStore('quote_cache', { keyPath: 'symbol' });
        qs.createIndex('by_expires', 'expiresAt', { unique: false });
      }
    };
  });
}

function idbTx(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest | void,
): Promise<any> {
  return openIDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const s  = tx.objectStore(store);
    tx.onerror = () => reject(tx.error);
    const req = fn(s);
    if (req) {
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    } else {
      tx.oncomplete = () => resolve(undefined);
    }
  }));
}

// ─── 服务端 API 调用（失败静默）──────────────────────────────────────────────

async function serverPost(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    return res.ok;
  } catch { return false; }
}

async function serverGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SERVER_URL}${path}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ─── 市场数据库实现 ───────────────────────────────────────────────────────────

class MarketDB implements IMarketDB {

  // ── OHLCV ───────────────────────────────────────────────────────────────────

  async saveOHLCV(records: OHLCVRecord[]): Promise<void> {
    if (!records.length) return;

    // L1: IndexedDB 批量写入
    try {
      const db = await openIDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('ohlcv', 'readwrite');
        const st = tx.objectStore('ohlcv');
        for (const r of records) st.put(r);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[MarketDB] IDB write error:', err);
    }

    // L2: 服务器异步同步（fire-and-forget）
    serverPost('/db/ohlcv', records).catch(() => {});
  }

  async queryOHLCV(symbol: string, fromTs = 0): Promise<OHLCVRecord[]> {
    // 优先从服务器读（有更完整的历史）
    const serverData = await serverGet<OHLCVRecord[]>(
      `/db/ohlcv/${encodeURIComponent(symbol)}?from=${fromTs}`,
    );
    if (serverData && serverData.length > 0) {
      // 回填到 L1 缓存（仅写入 L1 没有的部分）
      this.saveOHLCV(serverData).catch(() => {});
      return serverData.filter(r => r.timestamp >= fromTs).sort((a, b) => a.timestamp - b.timestamp);
    }

    // 降级：从 IndexedDB 读
    return this.queryIDB(symbol, fromTs);
  }

  private async queryIDB(symbol: string, fromTs: number): Promise<OHLCVRecord[]> {
    try {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx    = db.transaction('ohlcv', 'readonly');
        const index = tx.objectStore('ohlcv').index('by_symbol');
        const req   = index.getAll(IDBKeyRange.only(symbol));
        req.onsuccess = () => {
          const rows = (req.result as OHLCVRecord[])
            .filter(r => r.timestamp >= fromTs)
            .sort((a, b) => a.timestamp - b.timestamp);
          resolve(rows);
        };
        req.onerror = () => reject(req.error);
      });
    } catch { return []; }
  }

  async deleteOHLCV(symbol: string): Promise<void> {
    try {
      const db = await openIDB();
      await new Promise<void>((resolve, reject) => {
        const tx    = db.transaction('ohlcv', 'readwrite');
        const index = tx.objectStore('ohlcv').index('by_symbol');
        const req   = index.getAllKeys(IDBKeyRange.only(symbol));
        req.onsuccess = () => {
          for (const k of req.result as IDBValidKey[]) {
            tx.objectStore('ohlcv').delete(k);
          }
          tx.oncomplete = () => resolve();
          tx.onerror    = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    } catch { /* ignore */ }
    serverPost(`/db/ohlcv/${encodeURIComponent(symbol)}/delete`, {}).catch(() => {});
  }

  async pruneOHLCV(symbol: string, maxAgeMs = SIX_MONTHS_MS): Promise<void> {
    const cutoff = Date.now() - maxAgeMs;
    try {
      const db = await openIDB();
      await new Promise<void>((resolve, reject) => {
        const tx    = db.transaction('ohlcv', 'readwrite');
        const store = tx.objectStore('ohlcv');
        const index = store.index('by_symbol');
        const req   = index.getAll(IDBKeyRange.only(symbol));
        req.onsuccess = () => {
          for (const r of req.result as OHLCVRecord[]) {
            if (r.timestamp < cutoff) store.delete([r.symbol, r.timestamp]);
          }
          tx.oncomplete = () => resolve();
          tx.onerror    = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    } catch { /* ignore */ }
  }

  // ── 报价缓存（实时报价，60s TTL）────────────────────────────────────────────

  async cacheQuote(symbol: string, quote: unknown, ttlMs = 60_000): Promise<void> {
    try {
      await idbTx('quote_cache', 'readwrite', s =>
        s.put({ symbol, quote, expiresAt: Date.now() + ttlMs }),
      );
    } catch { /* ignore */ }
  }

  async getCachedQuote<T = unknown>(symbol: string): Promise<T | null> {
    try {
      const entry: any = await idbTx('quote_cache', 'readonly', s => s.get(symbol));
      if (!entry || Date.now() > entry.expiresAt) return null;
      return entry.quote as T;
    } catch { return null; }
  }

  async evictExpiredQuotes(): Promise<void> {
    try {
      const db = await openIDB();
      await new Promise<void>((resolve, reject) => {
        const tx    = db.transaction('quote_cache', 'readwrite');
        const index = tx.objectStore('quote_cache').index('by_expires');
        const req   = index.getAllKeys(IDBKeyRange.upperBound(Date.now()));
        req.onsuccess = () => {
          for (const k of req.result as IDBValidKey[]) {
            tx.objectStore('quote_cache').delete(k);
          }
          tx.oncomplete = () => resolve();
          tx.onerror    = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    } catch { /* ignore */ }
  }
}

export const marketDB = new MarketDB();
