/**
 * server/scanner/index.ts — Scanner 主循環
 *
 * 流程：
 *   1. 刷新物化視圖 active_symbols，取得所有需要掃描的標的
 *   2. 對每個標的：
 *      a. fetchOHLCV()    — Redis → ohlcv 表 → Yahoo Finance API
 *      b. fetchPrice()    — 取最新報價（Redis 60s 緩存）
 *      c. analyzeSymbol() — 計算 RSI/EMA/MACD/Boll，輸出 buyScore + smcTopProb
 *      d. buyScore ≥ 60 → processBuySignal()
 *      e. 所有標的 → processSellSignal()
 *   3. 每 5 分鐘重複
 */

import { query, pool } from '../db/pool.js';
import { getCache, setCache } from '../core/cache.js';
import { processBuySignal } from './buyScanner.js';
import { processSellSignal } from './sellScanner.js';

const SCANNER_INTERVAL_MS = 5 * 60 * 1000; // 5 分鐘

// ─────────────────────────────────────────────────────
//  OHLCV 資料結構
// ─────────────────────────────────────────────────────

interface Bar {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

// ─────────────────────────────────────────────────────
//  Yahoo Finance API helpers
// ─────────────────────────────────────────────────────

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

async function yahooChartRequest(symbol: string, params: string): Promise<any> {
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);
  return res.json();
}

async function fetchYahooHistory(symbol: string): Promise<Bar[]> {
  const json = await yahooChartRequest(symbol, 'interval=1d&range=6mo&includePrePost=false');
  const r = json?.chart?.result?.[0];
  if (!r) return [];
  const timestamps: number[]          = r.timestamp ?? [];
  const q                             = r.indicators?.quote?.[0] ?? {};
  const opens:  (number | null)[] = q.open   ?? [];
  const highs:  (number | null)[] = q.high   ?? [];
  const lows:   (number | null)[] = q.low    ?? [];
  const closes: (number | null)[] = q.close  ?? [];
  const vols:   (number | null)[] = q.volume ?? [];

  const bars: Bar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (!c || !isFinite(c)) continue;
    bars.push({ ts: timestamps[i] * 1000, o: opens[i] ?? c, h: highs[i] ?? c, l: lows[i] ?? c, c, v: vols[i] ?? 0 });
  }
  return bars;
}

/**
 * 獲取最新報價（Redis 60s 緩存 → Yahoo）
 */
async function fetchPrice(symbol: string): Promise<number | null> {
  const ck = `price:${symbol}`;
  const cached = getCache<number>(ck);
  if (cached !== undefined) return cached;
  try {
    const json = await yahooChartRequest(symbol, 'interval=1d&range=1d');
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice as number | undefined;
    if (price && isFinite(price) && price > 0) {
      setCache(ck, price, 60);
      return price;
    }
  } catch (err) {
    console.warn(`[Scanner] fetchPrice(${symbol}) 失敗：`, (err as Error).message);
  }
  return null;
}

/**
 * 獲取 OHLCV 歷史（DB 緩存 → Yahoo fallback，L1 5min）
 */
async function fetchOHLCV(symbol: string): Promise<Bar[]> {
  const ck = `ohlcv:${symbol}`;
  const cached = getCache<Bar[]>(ck);
  if (cached) return cached;

  try {
    const rows = await query<{ ts: string; o: string; h: string; l: string; c: string; v: string }>(
      `SELECT ts, o, h, l, c, v FROM ohlcv
       WHERE symbol = $1 AND tf = '1d'
       ORDER BY ts DESC LIMIT 120`,
      [symbol]
    );
    if (rows.length >= 60) {
      const bars: Bar[] = rows
        .map(r => ({ ts: new Date(r.ts).getTime(), o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v }))
        .sort((a, b) => a.ts - b.ts);
      setCache(ck, bars, 300);
      return bars;
    }
  } catch { /* 降級到 Yahoo */ }

  try {
    const bars = await fetchYahooHistory(symbol);
    if (bars.length > 0) {
      const vals = bars
        .map(b => `('${symbol}','1d','${new Date(b.ts).toISOString()}',${b.o},${b.h},${b.l},${b.c},${b.v})`)
        .join(',');
      await pool.query(
        `INSERT INTO ohlcv(symbol,tf,ts,o,h,l,c,v) VALUES ${vals} ON CONFLICT (symbol,tf,ts) DO NOTHING`
      ).catch(() => {});
      setCache(ck, bars, 300);
      return bars;
    }
  } catch (err) {
    console.warn(`[Scanner] fetchOHLCV(${symbol}) Yahoo 失敗：`, (err as Error).message);
  }
  return [];
}

// ─────────────────────────────────────────────────────
//  自包含技術指標計算（EMA / RSI / MACD / 布林帶）
// ─────────────────────────────────────────────────────

function calcEMA(prices: number[], period: number): number[] {
  if (!prices.length) return [];
  const k = 2 / (period + 1);
  const out = new Array<number>(prices.length);
  out[0] = prices[0];
  for (let i = 1; i < prices.length; i++) out[i] = prices[i] * k + out[i - 1] * (1 - k);
  return out;
}

function calcRSI(closes: number[], period = 14): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(50);
  if (n < period + 1) return out;
  let avgG = 0, avgL = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgG += d; else avgL -= d;
  }
  avgG /= period; avgL /= period;
  for (let i = period; i < n; i++) {
    if (i > period) {
      const d = closes[i] - closes[i - 1];
      avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
      avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    }
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

function calcMACD(closes: number[]): { dif: number[]; dea: number[]; hist: number[] } {
  const e12 = calcEMA(closes, 12);
  const e26 = calcEMA(closes, 26);
  const dif = e12.map((v, i) => v - e26[i]);
  const dea = calcEMA(dif, 9);
  const hist = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, hist };
}

function calcBoll(closes: number[], period = 20, mult = 2): { mb: number[]; up: number[]; dn: number[] } {
  const n = closes.length;
  const mb = new Array<number>(n).fill(0);
  const up = new Array<number>(n).fill(0);
  const dn = new Array<number>(n).fill(0);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i < period - 1) continue;
    const m = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - m) ** 2;
    const std = Math.sqrt(variance / period);
    mb[i] = m; up[i] = m + mult * std; dn[i] = m - mult * std;
  }
  return { mb, up, dn };
}

// ─────────────────────────────────────────────────────
//  SMC 評分（精簡版）
// ─────────────────────────────────────────────────────

async function analyzeSymbol(
  symbol: string,
  _price: number
): Promise<{ buyScore: number; reasons: string[]; smcTopProb: number } | null> {
  const bars = await fetchOHLCV(symbol);
  if (bars.length < 60) return null;

  const closes = bars.map(b => b.c);
  const highs  = bars.map(b => b.h);
  const vols   = bars.map(b => b.v);
  const n      = closes.length;

  const ema9arr  = calcEMA(closes, 9);
  const ema21arr = calcEMA(closes, 21);
  const rsi14arr = calcRSI(closes, 14);
  const { dif, dea, hist } = calcMACD(closes);
  const { mb, up, dn }     = calcBoll(closes);

  const i = n - 1, p = n - 2;

  const rsi14  = rsi14arr[i], rsi14p = rsi14arr[p];
  const e9  = ema9arr[i],  e9p  = ema9arr[p];
  const e21 = ema21arr[i], e21p = ema21arr[p];
  const bollMb = mb[i], bollDn = dn[i], bollUp = up[i];
  const avgVol = vols.slice(-20).reduce((s, v) => s + v, 0) / 20;
  const volRatio = avgVol > 0 ? vols[i] / avgVol : 0;
  const priceUp = closes[i] > closes[p];

  // 空頭趨勢禁買 / 極度超買排除
  if (e9 < e21 && closes[i] < bollMb) return null;
  if (rsi14 > 85) return null;

  let score = 0;
  const reasons: string[] = [];

  // RSI
  if (rsi14 < 30 && rsi14 > rsi14p)               { score += 28; reasons.push('RSI14 超賣區回升'); }
  else if (rsi14 < 42 && rsi14 > rsi14p)           { score += 15; reasons.push('RSI 較低位置回升'); }
  else if (rsi14 >= 40 && rsi14 <= 60 && rsi14 > rsi14p) { score += 10; reasons.push('RSI 動能健康區間上行'); }

  // EMA 金叉
  if (e9 > e21 && e9p <= e21p)     { score += 22; reasons.push('EMA9 上穿 EMA21（金叉）'); }
  else if (e9 > e21 && e9 > e9p)   { score += 10; reasons.push('EMA 多頭排列走強'); }

  // MACD
  if (dif[i] > dea[i] && dif[p] <= dea[p])                   { score += 20; reasons.push('MACD 金叉'); }
  else if (dif[i] > dea[i] && hist[i] > hist[p]) { score += 10; reasons.push('MACD 動量放大'); }

  // 布林帶
  if (closes[p] < dn[p] && closes[i] > bollDn)       { score += 15; reasons.push('布林下軌強力反彈'); }
  else if (closes[p] <= mb[p] && closes[i] > bollMb)  { score += 8;  reasons.push('突破布林中軌'); }

  // 成交量
  if (priceUp && volRatio >= 1.8)       { score += 15; reasons.push(`放量上漲（量比 ${volRatio.toFixed(1)}x）`); }
  else if (priceUp && volRatio >= 1.3)  { score += 8;  reasons.push('量價齊升'); }
  else if (!priceUp && volRatio < 0.75) { score += 5;  reasons.push('縮量回調（賣壓減輕）'); }

  // SMC 頂部概率
  let smcTopProb = 0;
  const recentHighs = highs.slice(-20);
  const priceNewHigh = closes[i] >= Math.max(...recentHighs.slice(0, -1));
  const rsiDecline   = rsi14arr[i] < Math.max(...rsi14arr.slice(-20, -1));
  if (priceNewHigh && rsiDecline) smcTopProb += 0.35;
  if (bollUp > 0) {
    const distToUp = (bollUp - closes[i]) / closes[i];
    if (distToUp < 0.005) smcTopProb += 0.3;
    else if (distToUp < 0.015) smcTopProb += 0.15;
  }
  if (e21 > 0) {
    const dev = (closes[i] - e21) / e21;
    if (dev > 0.06) smcTopProb += 0.2;
    else if (dev > 0.04) smcTopProb += 0.1;
  }
  if (dif[i] < dea[i] && dif[p] >= dea[p]) smcTopProb = Math.min(smcTopProb + 0.25, 1.0);

  return {
    buyScore: Math.min(Math.round(score), 100),
    reasons,
    smcTopProb: Math.min(smcTopProb, 1.0),
  };
}

// ─────────────────────────────────────────────────────
//  獲取活躍標的
// ─────────────────────────────────────────────────────

/**
 * 獲取所有活躍標的（從物化視圖）
 */
async function getActiveSymbols(): Promise<string[]> {
  try {
    // 嘗試刷新物化視圖
    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY active_symbols');
  } catch (err) {
    console.warn('[Scanner] 物化視圖刷新失敗，使用舊數據：', (err as Error).message);
  }

  const rows = await query<{ symbol: string }>(
    'SELECT symbol FROM active_symbols'
  );
  return rows.map(r => r.symbol);
}

/**
 * 主掃描循環
 */
async function runScanCycle(): Promise<void> {
  const start = Date.now();
  console.log(`[Scanner] 開始掃描 ${new Date().toISOString()}`);

  const symbols = await getActiveSymbols();
  console.log(`[Scanner] 活躍標的: ${symbols.length} 個`);

  let buySignals = 0;
  let sellChecks = 0;

  for (const symbol of symbols) {
    try {
      const price = await fetchPrice(symbol);
      if (!price) continue;

      const analysis = await analyzeSymbol(symbol, price);
      if (!analysis) continue;

      // 買入信號（score >= 60）
      if (analysis.buyScore >= 60) {
        await processBuySignal({
          symbol,
          score: analysis.buyScore,
          price,
          reasons: analysis.reasons,
          analysis: {},
        });
        buySignals++;
      }

      // 賣出信號（每個有持倉的標的都需要檢查）
      await processSellSignal({
        symbol,
        currentPrice: price,
        smcTopProbability: analysis.smcTopProb,
      });
      sellChecks++;

    } catch (err) {
      console.error(`[Scanner] ${symbol} 處理失敗：`, (err as Error).message);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `[Scanner] 掃描完成：${symbols.length} 個標的，` +
    `${buySignals} 個買入信號，${sellChecks} 個賣出檢查，耗時 ${elapsed}s`
  );
}

/** 啟動 Scanner */
async function startScanner(): Promise<void> {
  console.log('🔍 Scanner 啟動');

  // 首次立即執行
  await runScanCycle().catch(err =>
    console.error('[Scanner] 首次掃描失敗：', err.message)
  );

  // 定時循環
  setInterval(async () => {
    await runScanCycle().catch(err =>
      console.error('[Scanner] 掃描失敗：', err.message)
    );
  }, SCANNER_INTERVAL_MS);

  // 優雅關閉
  const shutdown = () => {
    console.log('🔍 Scanner 關閉');
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

startScanner();
