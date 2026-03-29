/**
 * searchService.ts
 * Yahoo Finance 搜索 + 热门资产预设
 * 支持：股票、ETF、期货（黄金/白银/石油）、指数
 */

import { SearchResult, AssetType } from '../types';
import { readJsonIfAvailable } from '../utils/http';

const SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
// 後端搜尋代理端點（使用相對路徑，自動適配任何 port）
const BACKEND_SEARCH = '/api/search';

// ─── 热门资产预设（无网络时展示）─────────────────────────────────────────────

export const POPULAR_ASSETS: SearchResult[] = [
  // Equities
  { symbol: 'AAPL',  name: 'Apple Inc.',                assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'TSLA',  name: 'Tesla',                     assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'MSFT',  name: 'Microsoft',                 assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'NVDA',  name: 'NVIDIA',                    assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'GOOGL', name: 'Alphabet (Google)', assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'AMZN',  name: 'Amazon',                    assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'META',  name: 'Meta Platforms',    assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'BRK-B', name: 'Berkshire Hathaway Class B', assetType: 'equity', exchange: 'NYQ' },
  // Metals / commodity futures
  { symbol: 'GC=F',  name: 'Gold Futures (COMEX)',      assetType: 'futures', exchange: 'CMX' },
  { symbol: 'SI=F',  name: 'Silver Futures (COMEX)',    assetType: 'futures', exchange: 'CMX' },
  { symbol: 'CL=F',  name: 'WTI Crude Oil Futures',     assetType: 'futures', exchange: 'NYM' },
  { symbol: 'BZ=F',  name: 'Brent Crude Oil Futures',   assetType: 'futures', exchange: 'NYM' },
  { symbol: 'NG=F',  name: 'Natural Gas Futures',       assetType: 'futures', exchange: 'NYM' },
  { symbol: 'HG=F',  name: 'Copper Futures',            assetType: 'futures', exchange: 'CMX' },
  { symbol: 'PL=F',  name: 'Platinum Futures',          assetType: 'futures', exchange: 'NYM' },
  // ETF
  { symbol: 'GLD',   name: 'Gold ETF (SPDR)',          assetType: 'etf',     exchange: 'PCX' },
  { symbol: 'SLV',   name: 'Silver ETF (iShares)',     assetType: 'etf',     exchange: 'PCX' },
  { symbol: 'USO',   name: 'Oil ETF (United States)',  assetType: 'etf',     exchange: 'PCX' },
  { symbol: 'SPY',   name: 'S&P 500 ETF',        assetType: 'etf',     exchange: 'PCX' },
  { symbol: 'QQQ',   name: 'NASDAQ 100 ETF',     assetType: 'etf',     exchange: 'NMS' },
  { symbol: 'IWM',   name: 'Russell 2000 ETF',         assetType: 'etf',     exchange: 'PCX' },
  { symbol: 'TLT',   name: 'Long-Term Treasury ETF',   assetType: 'etf',     exchange: 'NMS' },
  // Indexes (read-only)
  { symbol: '^GSPC', name: 'S&P 500 Index',            assetType: 'index',   exchange: 'SNP' },
  { symbol: '^DJI',  name: 'Dow Jones Industrial Average', assetType: 'index', exchange: 'DJI' },
  { symbol: '^IXIC', name: 'NASDAQ Composite Index',   assetType: 'index',   exchange: 'NIM' },
  { symbol: '^VIX',  name: 'Volatility Index (VIX)',   assetType: 'index',   exchange: 'CBT' },
  // Crypto
  { symbol: 'BTC',  name: 'Bitcoin (BTC)',            assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'ETH',  name: 'Ethereum (ETH)',           assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'SOL',  name: 'Solana',             assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'BNB',  name: 'BNB',                      assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'XRP',  name: 'XRP',                      assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'DOGE', name: 'Dogecoin (DOGE)',          assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'ADA',  name: 'Cardano (ADA)',            assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'AVAX', name: 'Avalanche (AVAX)',         assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'DOT',  name: 'Polkadot (DOT)',           assetType: 'crypto',  exchange: 'BINANCE' },
];

// ─── Yahoo quoteType → AssetType ─────────────────────────────────────────────

function mapType(quoteType: string): AssetType {
  switch ((quoteType ?? '').toUpperCase()) {
    case 'EQUITY':    return 'equity';
    case 'ETF':       return 'etf';
    case 'FUTURE':
    case 'FUTURES':   return 'futures';
    case 'INDEX':     return 'index';
    case 'CRYPTO':
    case 'CRYPTOCURR':
    case 'CRYPTOCURRENCY': return 'crypto';
    default:          return 'other';
  }
}

// ─── 网络请求工具 ─────────────────────────────────────────────────────────────

function fetchTO(url: string, ms = 6000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { signal: c.signal }).finally(() => clearTimeout(t));
}

// ─── 搜索 ─────────────────────────────────────────────────────────────────────

let _lastQuery   = '';
let _lastResults: SearchResult[] = [];
let _lastTime    = 0;
const CACHE_TTL  = 30_000; // 30 秒内同一关键词复用结果

export async function searchSymbols(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return POPULAR_ASSETS;

  // 缓存命中
  if (q === _lastQuery && Date.now() - _lastTime < CACHE_TTL) {
    return _lastResults;
  }

  // 本地先过滤热门列表（即时反馈）
  const local = POPULAR_ASSETS.filter(a =>
    a.symbol.toLowerCase().includes(q.toLowerCase()) ||
    a.name.toLowerCase().includes(q.toLowerCase())
  );

  try {
    const res = await fetchTO(`${BACKEND_SEARCH}?q=${encodeURIComponent(q)}`, 5000);
    if (!res.ok) return local;
    const json = await readJsonIfAvailable<{
      quotes?: Record<string, unknown>[];
      items?: Array<{ symbol?: string; name?: string; asset_type?: string; exchange?: string }>;
    }>(res);
    if (!json) return local;

    const quotes: Record<string, unknown>[] = json.quotes
      ?? (json.items ?? []).map(item => ({
        isYahooFinance: true,
        symbol: item.symbol,
        longname: item.name,
        quoteType: item.asset_type,
        exchange: item.exchange,
      }));
    const remotes: SearchResult[] = quotes
      .filter(q => q.isYahooFinance && q.symbol)
      .map(q => ({
        symbol:    String(q.symbol),
        name:      String(q.longname || q.shortname || q.symbol),
        assetType: mapType(String(q.quoteType ?? '')),
        exchange:  String(q.exchange ?? ''),
      }));

    // 合并（去重，remote 优先覆盖 local）
    const seen = new Set<string>();
    const merged: SearchResult[] = [];
    for (const r of [...remotes, ...local]) {
      if (!seen.has(r.symbol)) { seen.add(r.symbol); merged.push(r); }
    }

    _lastQuery   = q;
    _lastResults = merged;
    _lastTime    = Date.now();
    return merged;
  } catch {
    return local;
  }
}

/** 通过精确 symbol 拉取资产信息 */
export async function getSymbolInfo(symbol: string): Promise<SearchResult | null> {
  // 先查热门预设
  const preset = POPULAR_ASSETS.find(a => a.symbol === symbol);
  if (preset) return preset;

  try {
    const results = await searchSymbols(symbol);
    return results.find(r => r.symbol === symbol) ?? null;
  } catch {
    return null;
  }
}

/** 资产类型中文标签 */
export function assetTypeLabel(t: AssetType): string {
  switch (t) {
    case 'equity':  return 'Equity';
    case 'etf':     return 'ETF';
    case 'futures': return 'Futures';
    case 'index':   return 'Index';
    case 'crypto':  return 'Crypto';
    default:        return 'Other';
  }
}

/** 资产类型颜色（Ant Design Tag color） */
export function assetTypeColor(t: AssetType): string {
  switch (t) {
    case 'equity':  return 'green';
    case 'etf':     return 'cyan';
    case 'futures': return 'gold';
    case 'index':   return 'purple';
    case 'crypto':  return 'orange';
    default:        return 'default';
  }
}
