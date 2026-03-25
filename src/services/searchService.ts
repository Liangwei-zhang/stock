/**
 * searchService.ts
 * Yahoo Finance 搜索 + 热门资产预设
 * 支持：股票、ETF、期货（黄金/白银/石油）、指数
 */

import { SearchResult, AssetType } from '../types';

const SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
// 後端搜尋代理端點（避免使用第三方 corsproxy.io，保護用戶查詢隱私）
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'http://localhost:3001';
const BACKEND_SEARCH = `${SERVER_URL}/api/search`;

// ─── 热门资产预设（无网络时展示）─────────────────────────────────────────────

export const POPULAR_ASSETS: SearchResult[] = [
  // 股票
  { symbol: 'AAPL',  name: '苹果公司',         assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'TSLA',  name: '特斯拉',            assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'MSFT',  name: '微软公司',           assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'NVDA',  name: '英伟达',             assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'GOOGL', name: 'Alphabet (Google)', assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'AMZN',  name: '亚马逊',             assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'META',  name: 'Meta Platforms',    assetType: 'equity',  exchange: 'NMS' },
  { symbol: 'BRK-B', name: '巴菲特伯克希尔B',    assetType: 'equity',  exchange: 'NYQ' },
  // 贵金属 / 大宗商品期货
  { symbol: 'GC=F',  name: '黄金期货 (COMEX)',   assetType: 'futures', exchange: 'CMX' },
  { symbol: 'SI=F',  name: '白银期货 (COMEX)',   assetType: 'futures', exchange: 'CMX' },
  { symbol: 'CL=F',  name: 'WTI 原油期货',      assetType: 'futures', exchange: 'NYM' },
  { symbol: 'BZ=F',  name: 'Brent 原油期货',    assetType: 'futures', exchange: 'NYM' },
  { symbol: 'NG=F',  name: '天然气期货',          assetType: 'futures', exchange: 'NYM' },
  { symbol: 'HG=F',  name: '铜期货',              assetType: 'futures', exchange: 'CMX' },
  { symbol: 'PL=F',  name: '铂金期货',            assetType: 'futures', exchange: 'NYM' },
  // ETF
  { symbol: 'GLD',   name: '黄金 ETF (SPDR)',    assetType: 'etf',     exchange: 'PCX' },
  { symbol: 'SLV',   name: '白银 ETF (iShares)', assetType: 'etf',     exchange: 'PCX' },
  { symbol: 'USO',   name: '原油 ETF (United)',  assetType: 'etf',     exchange: 'PCX' },
  { symbol: 'SPY',   name: 'S&P 500 ETF',        assetType: 'etf',     exchange: 'PCX' },
  { symbol: 'QQQ',   name: 'NASDAQ 100 ETF',     assetType: 'etf',     exchange: 'NMS' },
  { symbol: 'IWM',   name: '罗素 2000 ETF',       assetType: 'etf',     exchange: 'PCX' },
  { symbol: 'TLT',   name: '长期国债 ETF',         assetType: 'etf',     exchange: 'NMS' },
  // 指数（只读行情，无法交易）
  { symbol: '^GSPC', name: 'S&P 500 指数',       assetType: 'index',   exchange: 'SNP' },
  { symbol: '^DJI',  name: '道琼斯工业指数',       assetType: 'index',   exchange: 'DJI' },
  { symbol: '^IXIC', name: 'NASDAQ 综合指数',     assetType: 'index',   exchange: 'NIM' },
  { symbol: '^VIX',  name: '恐慌指数 VIX',        assetType: 'index',   exchange: 'CBT' },
  // 加密货币
  { symbol: 'BTC',  name: '比特币 (Bitcoin)',    assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'ETH',  name: '以太坊 (Ethereum)',  assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'SOL',  name: 'Solana',             assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'BNB',  name: '币安币 (BNB)',       assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'XRP',  name: '瑞波币 (XRP)',        assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'DOGE', name: '狗狗币 (Dogecoin)',   assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'ADA',  name: '艾达币 (Cardano)',   assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'AVAX', name: '雪崩 (Avalanche)',   assetType: 'crypto',  exchange: 'BINANCE' },
  { symbol: 'DOT',  name: '波卡 (Polkadot)',    assetType: 'crypto',  exchange: 'BINANCE' },
];

// ─── Yahoo quoteType → AssetType ─────────────────────────────────────────────

function mapType(quoteType: string): AssetType {
  switch ((quoteType ?? '').toUpperCase()) {
    case 'EQUITY':    return 'equity';
    case 'ETF':       return 'etf';
    case 'FUTURE':
    case 'FUTURES':   return 'futures';
    case 'INDEX':     return 'index';
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
    const json = await res.json();

    const quotes: Record<string, unknown>[] = json?.quotes ?? [];
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
    case 'equity':  return '股票';
    case 'etf':     return 'ETF';
    case 'futures': return '期货';
    case 'index':   return '指数';
    case 'crypto':  return '加密';
    default:        return '其他';
  }
}

/** 资产类型颜色（Ant Design Tag color） */
export function assetTypeColor(t: AssetType): string {
  switch (t) {
    case 'equity':  return 'blue';
    case 'etf':     return 'cyan';
    case 'futures': return 'gold';
    case 'index':   return 'purple';
    case 'crypto':  return 'orange';
    default:        return 'default';
  }
}
