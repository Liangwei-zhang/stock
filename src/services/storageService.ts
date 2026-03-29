/**
 * storageService.ts
 * IndexedDB 持久化层
 *   - watchlist   : 自选股列表（keyPath: symbol）
 *   - history     : 6 个月 K 线缓存（keyPath: id = symbol_timestamp，index on symbol）
 * 
 * 数据优先级保障：
 *   真实数据 > IndexedDB 缓存 > 模拟数据
 * 当网络恢复时，新数据写入 DB；下次离线时优先读取 DB 缓存。
 */

import { WatchlistItem, StockData } from '../types';

const DB_NAME    = 'StockAlertDB';
const DB_VERSION = 2;

/** 6 个月毫秒数 */
export const SIX_MONTHS_MS = 6 * 30 * 24 * 3600 * 1000;

// ─── 内部类型 ────────────────────────────────────────────────────────────────

interface HistoryRecord {
  id:        string;   // `${symbol}_${timestamp}`
  symbol:    string;
  timestamp: number;
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume:    number;
}

// ─── DB 单例 ─────────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;
const _available = typeof indexedDB !== 'undefined';

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  if (!_available) return Promise.reject(new Error('IndexedDB unavailable'));

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror = () => reject(req.error);

    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { _db?.close(); _db = null; };
      resolve(_db);
    };

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      // ── watchlist store ──
      if (!db.objectStoreNames.contains('watchlist')) {
        db.createObjectStore('watchlist', { keyPath: 'symbol' });
      }

      // ── history store ──
      if (!db.objectStoreNames.contains('history')) {
        const hs = db.createObjectStore('history', { keyPath: 'id' });
        hs.createIndex('by_symbol',    'symbol',    { unique: false });
        hs.createIndex('by_timestamp', 'timestamp', { unique: false });
        hs.createIndex('by_sym_ts',    ['symbol', 'timestamp'], { unique: false });
      }

      // ── POI store (v2+) ──
      if (!db.objectStoreNames.contains('pois')) {
        const ps = db.createObjectStore('pois', { keyPath: 'id' });
        ps.createIndex('by_symbol', 'symbol', { unique: false });
        ps.createIndex('by_state', 'state', { unique: false });
      }
    };
  });
}

// ─── 通用事务工具 ─────────────────────────────────────────────────────────────

function withTx<T>(
  mode: IDBTransactionMode,
  stores: string | string[],
  fn: (tx: IDBTransaction) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const storeNames = Array.isArray(stores) ? stores : [stores];
    const tx = db.transaction(storeNames, mode);
    tx.onerror = () => reject(tx.error);
    try {
      const result = fn(tx);
      if (result instanceof IDBRequest) {
        result.onsuccess = () => resolve(result.result);
        result.onerror   = () => reject(result.error);
      } else {
        (result as Promise<T>).then(resolve).catch(reject);
      }
    } catch (err) { reject(err); }
  }));
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

export async function getWatchlist(): Promise<WatchlistItem[]> {
  try {
    return await withTx<WatchlistItem[]>('readonly', 'watchlist', tx =>
      tx.objectStore('watchlist').getAll()
    );
  } catch { return []; }
}

export async function upsertWatchlistItem(item: WatchlistItem): Promise<void> {
  try {
    await withTx<IDBValidKey>('readwrite', 'watchlist', tx =>
      tx.objectStore('watchlist').put(item)
    );
  } catch (e) { console.warn('upsertWatchlistItem failed', e); }
}

export async function removeWatchlistItem(symbol: string): Promise<void> {
  try {
    await withTx<undefined>('readwrite', 'watchlist', tx =>
      tx.objectStore('watchlist').delete(symbol)
    );
  } catch (e) { console.warn('removeWatchlistItem failed', e); }
}

// ─── History ──────────────────────────────────────────────────────────────────

function toRecord(d: StockData): HistoryRecord {
  return {
    id:        `${d.symbol}_${d.timestamp}`,
    symbol:    d.symbol,
    timestamp: d.timestamp,
    open:      d.open,  high: d.high,
    low:       d.low,   close: d.close,
    volume:    d.volume,
  };
}

function fromRecord(r: HistoryRecord, name: string): StockData {
  const c = r.close;
  return {
    symbol: r.symbol, name,
    price: c, close: c,
    change: 0, changePercent: 0,
    volume: r.volume,
    open: r.open, high: r.high, low: r.low,
    timestamp: r.timestamp,
  };
}

/** 读取一个 symbol 的全部 history，按时间正序，自动补 change/changePercent */
export async function getHistory(symbol: string, displayName = symbol): Promise<StockData[]> {
  try {
    const db     = await openDB();
    const cutoff = Date.now() - SIX_MONTHS_MS;

    const records: HistoryRecord[] = await new Promise((resolve, reject) => {
      const tx    = db.transaction('history', 'readonly');
      const idx   = tx.objectStore('history').index('by_sym_ts');
      const range = IDBKeyRange.bound([symbol, cutoff], [symbol, Infinity]);
      const req   = idx.getAll(range);
      req.onsuccess = () => resolve(req.result as HistoryRecord[]);
      req.onerror   = () => reject(req.error);
    });

    if (!records.length) return [];

    // sort ascending
    records.sort((a, b) => a.timestamp - b.timestamp);

    const data: StockData[] = records.map((r, i) => {
      const d    = fromRecord(r, displayName);
      const prev = records[i - 1];
      if (prev) {
        d.change       = d.close - prev.close;
        d.changePercent = (d.change / prev.close) * 100;
      }
      return d;
    });

    return data;
  } catch { return []; }
}

/** 批量保存 history（upsert），每 500 条一个事务避免超时 */
export async function saveHistory(data: StockData[]): Promise<void> {
  if (!data.length) return;
  try {
    const db      = await openDB();
    const CHUNK   = 500;

    for (let i = 0; i < data.length; i += CHUNK) {
      const chunk = data.slice(i, i + CHUNK);
      await new Promise<void>((resolve, reject) => {
        const tx    = db.transaction('history', 'readwrite');
        const store = tx.objectStore('history');
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
        for (const d of chunk) store.put(toRecord(d));
      });
    }
  } catch (e) { console.warn('saveHistory failed', e); }
}

/** 删除超出 6 个月的旧记录（可选按 symbol 限定） */
export async function pruneOldHistory(symbol?: string): Promise<void> {
  try {
    const db     = await openDB();
    const cutoff = Date.now() - SIX_MONTHS_MS;

    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction('history', 'readwrite');
      const idx   = tx.objectStore('history').index('by_timestamp');
      const range = IDBKeyRange.upperBound(cutoff, true);
      const req   = idx.openCursor(range);

      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { resolve(); return; }
        const rec = cursor.value as HistoryRecord;
        if (!symbol || rec.symbol === symbol) cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onerror  = () => reject(tx.error);
    });
  } catch (e) { console.warn('pruneOldHistory failed', e); }
}

/** 删除某 symbol 的所有 history */
export async function clearSymbolHistory(symbol: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction('history', 'readwrite');
      const idx   = tx.objectStore('history').index('by_symbol');
      const req   = idx.openCursor(IDBKeyRange.only(symbol));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { resolve(); return; }
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onerror  = () => reject(tx.error);
    });
  } catch (e) { console.warn('clearSymbolHistory failed', e); }
}

// ─── POI Storage ─────────────────────────────────────────────────────────────

export interface StoredPOI {
  id: string;
  symbol: string;
  type: 'support' | 'resistance';
  level: number;
  state: 'fresh' | 'testing' | 'mitigated' | 'stale';
  createdAt: number;
  testedAt: number | null;
  mitigatedAt: number | null;
  touches: number;
  strength: number;
  reason: string;
}

/** 保存 POI 列表 */
export async function savePOIs(symbol: string, pois: StoredPOI[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('pois', 'readwrite');
    const store = tx.objectStore('pois');
    
    // 先刪除該 symbol 的舊 POI
    const idx = store.index('by_symbol');
    const deleteReq = idx.openCursor(IDBKeyRange.only(symbol));
    
    deleteReq.onsuccess = () => {
      const cursor = deleteReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    
    tx.oncomplete = () => {
      // 刪除完成後批量寫入（tx1 已提交，確保原子性）
      const tx2 = db.transaction('pois', 'readwrite');
      const store2 = tx2.objectStore('pois');
      tx2.onerror = () => console.warn('[savePOIs] tx2 write failed:', tx2.error);
      for (const poi of pois) {
        store2.put({ ...poi, symbol });
      }
    };
  } catch (e) { console.warn('savePOIs failed', e); }
}

/** 載入 POI 列表 */
export async function loadPOIs(symbol?: string): Promise<StoredPOI[]> {
  try {
    const db = await openDB();
    return new Promise<StoredPOI[]>((resolve, reject) => {
      const tx = db.transaction('pois', 'readonly');
      const store = tx.objectStore('pois');
      let req;
      if (symbol) {
        const idx = store.index('by_symbol');
        req = idx.getAll(IDBKeyRange.only(symbol));
      } else {
        req = store.getAll();
      }
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) { 
    // warn:'loadPOIs failed', e); 
    return [];
  }
}

/** 清除 POI */
export async function clearPOIs(symbol?: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('pois', 'readwrite');
    const store = tx.objectStore('pois');
    
    if (symbol) {
      const idx = store.index('by_symbol');
      const req = idx.openCursor(IDBKeyRange.only(symbol));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
    } else {
      store.clear();
    }
  } catch (e) { console.warn('clearPOIs failed', e); }
}
