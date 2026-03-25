/**
 * stockService.ts (v2) — 动态自选股 + 多数据源注册表
 *
 * 变化：
 *  - 历史 / 报价获取全部委托给 dataSourceRegistry（按优先级自动降级）
 *  - 历史数据同时写入 marketDB（IndexedDB + 服务端 SQLite）
 *  - 报价结果写入 marketDB 60s 缓存
 *  - 兜底：模拟数据（离线/盘后）
 */

import { dataSourceRegistry }  from '../core/data-source-registry';
import { marketDB }            from '../db/market-db';
import {
  getWatchlist, upsertWatchlistItem, removeWatchlistItem, pruneOldHistory,
  SIX_MONTHS_MS,
} from './storageService';
import { StockData, KLineData, WatchlistItem, SymbolMeta, DataSource, AssetType } from '../types';

// ─── 模拟数据生成 ─────────────────────────────────────────────────────────────

const BASE_PRICES: Record<string, number> = {
  'GC=F': 2400, 'SI=F': 30, 'CL=F': 75, 'BZ=F': 80,
  'NG=F': 2.5,  'HG=F': 4.5, 'PL=F': 1000,
  '^GSPC': 5400, '^DJI': 39000, '^IXIC': 17000, '^VIX': 18,
  'GLD': 220, 'SLV': 27, 'USO': 75,
  'SPY': 540, 'QQQ': 440, 'IWM': 205, 'TLT': 94,
};

const BASE_VOLS: Record<string, number> = {
  'GC=F': 0.01, 'SI=F': 0.025, 'CL=F': 0.025, 'BZ=F': 0.025,
  'NG=F': 0.04, 'HG=F': 0.02,  'PL=F': 0.015,
  '^GSPC': 0.012, '^DJI': 0.012, '^IXIC': 0.015, '^VIX': 0.08,
};

function genSimulated(symbol: string, name: string, basePrice = 100, vol = 0.02, days = 120): StockData[] {
  const data: StockData[] = [];
  let price = basePrice * (0.9 + Math.random() * 0.2);
  const now = Date.now(), dayMs = 86_400_000;
  let tDir = 1, tDown = 5 + Math.floor(Math.random() * 10);

  for (let i = days; i >= 0; i--) {
    const ts  = now - i * dayMs;
    const dow = new Date(ts).getDay();
    if (dow === 0 || dow === 6) continue;
    if (--tDown <= 0) { tDir = Math.random() > 0.45 ? 1 : -1; tDown = 5 + Math.floor(Math.random() * 10); }
    const o   = price * (1 + (Math.random() - 0.5) * 0.01);
    const c   = Math.max(0.01, o + tDir * vol * price * 0.4 + (Math.random() - 0.5) * vol * price);
    const h   = Math.max(o, c) * (1 + Math.random() * 0.015);
    const l   = Math.min(o, c) * (1 - Math.random() * 0.015);
    const pr  = data[data.length - 1];
    const chg = pr ? c - pr.close : 0;
    data.push({
      symbol, name, price: c, close: c,
      change: chg, changePercent: pr ? (chg / pr.close) * 100 : 0,
      volume: basePrice * 1e6 * (0.5 + Math.random() * 1.5) * 0.0001,
      open: o, high: h, low: l, timestamp: ts,
    });
    price = c;
  }
  return data;
}

function simTick(last: StockData, vol = 0.02): StockData {
  const chg   = (Math.random() - 0.5) * 2 * vol * last.price;
  const price = Math.max(0.01, last.price + chg);
  return {
    ...last, price, close: price,
    change: price - last.price,
    changePercent: ((price - last.price) / last.price) * 100,
    open:      last.price,
    high:      Math.max(last.price, price) * (1 + Math.random() * 0.005),
    low:       Math.min(last.price, price) * (1 - Math.random() * 0.005),
    timestamp: Date.now(),
  };
}

// StockData[] → OHLCVRecord[]
function toOHLCV(rows: StockData[], source: string) {
  return rows.map(r => ({
    symbol: r.symbol, timestamp: r.timestamp,
    open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
    source,
  }));
}

// OHLCVRecord[] → StockData[]
function fromOHLCV(rows: { symbol: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number }[], name: string): StockData[] {
  return rows.map((r, i, arr) => {
    const prev = arr[i - 1];
    const chg  = prev ? r.close - prev.close : 0;
    return {
      symbol: r.symbol, name,
      price: r.close, close: r.close,
      open: r.open, high: r.high, low: r.low, volume: r.volume,
      change: chg, changePercent: prev ? (chg / prev.close) * 100 : 0,
      timestamp: r.timestamp,
    };
  });
}

// ─── StockService ─────────────────────────────────────────────────────────────

class StockService {
  private watchlist   = new Map<string, WatchlistItem>();
  private data        = new Map<string, StockData[]>();
  private meta        = new Map<string, SymbolMeta>();
  private initialized = false;

  // ── 初始化 ──────────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    let stored = await getWatchlist();
    if (!stored.length) {
      const defaults: WatchlistItem[] = [
        { symbol: 'AAPL', name: '苹果公司', addedAt: Date.now(), assetType: 'equity', exchange: 'NMS' },
        { symbol: 'TSLA', name: '特斯拉',   addedAt: Date.now(), assetType: 'equity', exchange: 'NMS' },
        { symbol: 'BTC',  name: 'Bitcoin',  addedAt: Date.now(), assetType: 'crypto', exchange: 'Binance' },
      ];
      for (const d of defaults) await upsertWatchlistItem(d);
      stored = defaults;
    }

    for (const item of stored) {
      this.watchlist.set(item.symbol, item);
      this.meta.set(item.symbol, { source: 'simulated', lastUpdated: 0 });
    }

    // 1. 从 marketDB 加载 → 2. 触发真实历史后台拉取
    for (const item of stored) await this._loadFromDB(item);
    this._refreshAllHistories();

    setTimeout(() => pruneOldHistory(), 5000);
  }

  // ── 从 DB 加载（IDB + SQLite）───────────────────────────────────────────────

  private async _loadFromDB(item: WatchlistItem): Promise<void> {
    const rows = await marketDB.queryOHLCV(item.symbol);
    if (rows.length >= 10) {
      this.data.set(item.symbol, fromOHLCV(rows.slice(-120), item.name));
      this.meta.set(item.symbol, { source: 'database', lastUpdated: rows[rows.length - 1].timestamp });
      return;
    }
    // DB 为空：用模拟数据先占位
    const base = BASE_PRICES[item.symbol] ?? 100;
    const vol  = BASE_VOLS[item.symbol]   ?? 0.02;
    this.data.set(item.symbol, genSimulated(item.symbol, item.name, base, vol));
    this.meta.set(item.symbol, { source: 'simulated', lastUpdated: 0 });
  }

  // ── 后台拉取真实历史，2 路并发 ───────────────────────────────────────────────

  private async _refreshAllHistories(): Promise<void> {
    const items = Array.from(this.watchlist.values());
    const CONCURRENCY = 2;
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      await Promise.allSettled(
        items.slice(i, i + CONCURRENCY).map(item => this._fetchRealHistory(item)),
      );
      if (i + CONCURRENCY < items.length) await new Promise(r => setTimeout(r, 400));
    }
  }

  private async _fetchRealHistory(item: WatchlistItem): Promise<void> {
    try {
      const hist = await dataSourceRegistry.fetchHistory(item.symbol, item.assetType);
      if (!hist.length) return;
      this.data.set(item.symbol, hist.slice(-120));
      this.meta.set(item.symbol, { source: 'real', lastUpdated: Date.now() });
      // 异步写双层 DB
      marketDB.saveOHLCV(toOHLCV(hist, item.assetType)).catch(() => {});
    } catch { /* 静默失败，保持现有数据 */ }
  }

  // ── 公开：更新报价（每 20s）─────────────────────────────────────────────────

  async updateStocks(): Promise<void> {
    const symbols = Array.from(this.watchlist.keys());
    for (let i = 0; i < symbols.length; i++) {
      await this._updateSymbol(symbols[i]).catch(() => {});
      if (i < symbols.length - 1) await new Promise(r => setTimeout(r, 200));
    }
  }

  private async _updateSymbol(symbol: string): Promise<void> {
    const item = this.watchlist.get(symbol);
    if (!item) return;

    // 先查 60s 报价缓存
    type QuoteCache = { price: number; change: number; changePercent: number; volume: number };
    const cached = await marketDB.getCachedQuote<QuoteCache>(symbol);
    if (cached) {
      this._applyQuote(symbol, item.name, cached);
      return;
    }

    const quote = await dataSourceRegistry.fetchQuote(symbol, item.assetType);
    if (quote) {
      // 缓存 60s
      marketDB.cacheQuote(symbol, {
        price: quote.price, change: quote.change,
        changePercent: quote.changePercent, volume: quote.volume,
      }).catch(() => {});
      this._applyQuote(symbol, item.name, quote);
    } else {
      // 盘后/离线：模拟 tick（仅当没有真实数据时）
      const cur = this.data.get(symbol) ?? [];
      if (cur.length > 0 && this.meta.get(symbol)?.source !== 'real') {
        const vol  = BASE_VOLS[symbol] ?? 0.02;
        const next = simTick(cur[cur.length - 1], vol);
        this.data.set(symbol, [...cur.slice(0, -1), next].slice(-120));
      }
    }
  }

  private _applyQuote(symbol: string, name: string, quote: { price: number; change: number; changePercent: number; volume: number }): void {
    const cur  = this.data.get(symbol) ?? [];
    const prev = cur[cur.length - 1];
    const entry: StockData = {
      symbol, name,
      price: quote.price, close: quote.price,
      change: quote.change, changePercent: quote.changePercent,
      volume: quote.volume || prev?.volume || 0,
      open:   prev?.open   ?? quote.price,
      high:   prev ? Math.max(prev.high, quote.price) : quote.price,
      low:    prev ? Math.min(prev.low,  quote.price) : quote.price,
      timestamp: Date.now(),
    };
    this.data.set(symbol, [...(cur.length ? cur.slice(0, -1) : []), entry].slice(-120));
    this.meta.set(symbol, { source: 'real', lastUpdated: Date.now() });
    marketDB.saveOHLCV([{ symbol, timestamp: entry.timestamp, open: entry.open, high: entry.high, low: entry.low, close: entry.close, volume: entry.volume, source: 'real' }]).catch(() => {});
  }

  // ── 添加 / 移除 ─────────────────────────────────────────────────────────────

  async addSymbol(item: WatchlistItem): Promise<void> {
    if (this.watchlist.has(item.symbol)) return;
    this.watchlist.set(item.symbol, item);
    this.meta.set(item.symbol, { source: 'simulated', lastUpdated: 0 });
    const base = BASE_PRICES[item.symbol] ?? 100;
    const vol  = BASE_VOLS[item.symbol]   ?? 0.02;
    this.data.set(item.symbol, genSimulated(item.symbol, item.name, base, vol));
    await upsertWatchlistItem(item);
    await this._loadFromDB(item);
    this._fetchRealHistory(item);
  }

  async removeSymbol(symbol: string): Promise<void> {
    this.watchlist.delete(symbol);
    this.data.delete(symbol);
    this.meta.delete(symbol);
    await removeWatchlistItem(symbol);
    // 保留 DB 历史（可按需启用清除）
    // await marketDB.deleteOHLCV(symbol);
  }

  // ── 只读访问 ─────────────────────────────────────────────────────────────────

  getWatchlist(): WatchlistItem[] {
    return Array.from(this.watchlist.values()).sort((a, b) => a.addedAt - b.addedAt);
  }

  getStocks(): StockData[] {
    return this.getWatchlist()
      .map(item => { const d = this.data.get(item.symbol); return d?.length ? d[d.length - 1] : null; })
      .filter((d): d is StockData => d !== null);
  }

  getStockHistory(symbol: string): StockData[] { return this.data.get(symbol) ?? []; }

  getKLineData(symbol: string): KLineData[] {
    return this.getStockHistory(symbol).map(d => ({
      time: Math.floor(d.timestamp / 1000),
      open: d.open, high: d.high, low: d.low, close: d.price, volume: d.volume,
    }));
  }

  getSymbolMeta(symbol: string): SymbolMeta {
    return this.meta.get(symbol) ?? { source: 'simulated', lastUpdated: 0 };
  }

  getAvailableStocks(): string[] { return Array.from(this.watchlist.keys()); }
  hasSymbol(symbol: string): boolean { return this.watchlist.has(symbol); }
  isInitialized(): boolean { return this.initialized; }
}

export const stockService = new StockService();

// ─── HMR 保護：防止 Vite 熱更新時產生多個服務實例 ────────────────────────────
if (import.meta.hot) {
  import.meta.hot.accept();
}
