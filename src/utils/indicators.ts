/**
 * indicators.ts
 *
 * 性能优化说明：
 * ① SMA   O(n²)→O(n)：滑动窗口求和，去掉 slice().reduce()
 * ② BOLL  O(n²)→O(n)：滑动窗口 sum + sumSq，无中间切片
 * ③ KDJ   O(n²)→O(n)：内层显式循环，去掉 Math.max(...slice)
 * ④ ADX            ：流式计算，只保留标量，不创建 10 条长数组
 * ⑤ findPivots      ：内层直接索引访问，不创建 window 切片
 * ⑥ detectBBSqueeze ：直接索引遍历，不调用 .filter()
 * ⑦ LRU 缓存        ：key=长度+最后收盘价+时间戳，12 槽容量
 *                    calculateAllIndicators / getPreviousIndicators
 *                    重复调用直接命中缓存，每个更新周期每股只真正计算 3 次
 */

import { StockData, TechnicalIndicators } from '../types';

// ═══════════════════════════════════════════════════════════════
//  LRU 缓存（Bug-4 / Bug-12 修复核心）
// ═══════════════════════════════════════════════════════════════
// 容量 12：3 股 × 4 偏移(0/1/2/margin) 足够覆盖所有调用
const CACHE_CAP = 12;
const cache     = new Map<string, TechnicalIndicators>();

function cacheKey(data: StockData[], symbol: string): string {
  if (data.length === 0) return `${symbol}:0:0:0`;
  const last = data[data.length - 1];
  // 加入 symbol 避免不同標的哈希碰撞返回錯誤結果
  return `${symbol}:${data.length}:${last.close.toFixed(4)}:${last.timestamp}`;
}

function cacheGet(key: string): TechnicalIndicators | undefined {
  if (!cache.has(key)) return undefined;
  // 将命中项移至末尾（LRU 热端）
  const v = cache.get(key)!;
  cache.delete(key);
  cache.set(key, v);
  return v;
}

function cacheSet(key: string, v: TechnicalIndicators): void {
  if (cache.size >= CACHE_CAP) {
    // 删除最久未用的（Map 迭代顺序 = 插入顺序）
    cache.delete(cache.keys().next().value as string);
  }
  cache.set(key, v);
}

// ═══════════════════════════════════════════════════════════════
//  基础计算（全部 O(n)）
// ═══════════════════════════════════════════════════════════════

export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const k   = 2 / (period + 1);
  const out = new Array<number>(prices.length);
  out[0] = prices[0];
  for (let i = 1; i < prices.length; i++) {
    out[i] = prices[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/** Bug-1 修复：O(n²) → O(n) 滑动窗口 */
export function calculateSMA(prices: number[], period: number): number[] {
  const n   = prices.length;
  const out = new Array<number>(n).fill(0);
  let   sum = 0;
  for (let i = 0; i < n; i++) {
    sum += prices[i];
    if (i >= period) sum -= prices[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** MACD (12, 26, 9) */
export function calculateMACD(prices: number[]) {
  if (prices.length < 26) return { dif: [0], dea: [0], histogram: [0] };
  const ema12     = calculateEMA(prices, 12);
  const ema26     = calculateEMA(prices, 26);
  const dif       = ema12.map((v, i) => v - ema26[i]);
  const dea       = calculateEMA(dif, 9);
  const histogram = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, histogram };
}

/** Bug-3 修复：O(n²) → O(n) 内联循环，无 spread/slice */
export function calculateKDJ(
  highs: number[], lows: number[], closes: number[], period = 9,
): { k: number[]; d: number[]; j: number[] } {
  const n = closes.length;
  const k = new Array<number>(n).fill(50);
  const d = new Array<number>(n).fill(50);

  // 维护滑动窗口的高低点（无 Math.max/min + spread）
  let winHigh = highs[0], winLow = lows[0];

  for (let i = 1; i < n; i++) {
    // 窗口起点变化时重新扫描（只在窗口满 period 后才需要重扫）
    const start = Math.max(0, i - period + 1);
    if (i >= period && (lows[i - period] === winLow || highs[i - period] === winHigh)) { // Bug2 fix: missing parens caused wrong precedence
      // 前边界的值被移出 → 必须重扫窗口
      winHigh = highs[start];
      winLow  = lows[start];
      for (let j = start + 1; j <= i; j++) {
        if (highs[j] > winHigh) winHigh = highs[j];
        if (lows[j]  < winLow)  winLow  = lows[j];
      }
    } else {
      // 只需与新加入的值比较
      if (highs[i] > winHigh) winHigh = highs[i];
      if (lows[i]  < winLow)  winLow  = lows[i];
    }

    const hn  = winHigh, ln = winLow;
    const rsv = hn === ln ? 50 : ((closes[i] - ln) / (hn - ln)) * 100;
    k[i] = k[i - 1] * (2 / 3) + rsv * (1 / 3);
    d[i] = d[i - 1] * (2 / 3) + k[i] * (1 / 3);
  }

  const j = k.map((v, i) => 3 * v - 2 * d[i]);
  return { k, d, j };
}

/** RSI — Wilder 平滑法（更准确） */
export function calculateRSI(prices: number[], period = 14): number[] {
  const n   = prices.length;
  const out = new Array<number>(n).fill(50);
  if (n < 2) return out;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < n; i++) {
    const chg = prices[i] - prices[i - 1];
    const g   = chg > 0 ? chg : 0;
    const l   = chg < 0 ? -chg : 0;

    if (i <= period) {
      avgGain += g / period;
      avgLoss += l / period;
      if (i === period) {
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        out[i]   = 100 - 100 / (1 + rs);
      }
    } else {
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      out[i]   = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

/** Bug-2 修复：O(n²) → O(n) 滑动窗口 sum + sumSq */
export function calculateBollingerBands(
  prices: number[], period = 20, nSigma = 2,
): { upper: number; middle: number; lower: number }[] {
  const n   = prices.length;
  const out = new Array(n).fill(null).map(() => ({ upper: 0, middle: 0, lower: 0 }));
  let sum = 0, sumSq = 0;

  for (let i = 0; i < n; i++) {
    sum   += prices[i];
    sumSq += prices[i] * prices[i];
    if (i >= period) {
      sum   -= prices[i - period];
      sumSq -= prices[i - period] * prices[i - period];
    }
    if (i >= period - 1) {
      const mean     = sum / period;
      const variance = Math.max(0, sumSq / period - mean * mean);
      const std      = Math.sqrt(variance);
      out[i] = { upper: mean + nSigma * std, middle: mean, lower: mean - nSigma * std };
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
//  RSI 背离（先行指标）
// ═══════════════════════════════════════════════════════════════

/** Bug-7 修复：内层直接索引访问，不创建 window 切片 */
function findPivots(values: number[], type: 'high' | 'low', sm = 2): number[] {
  const pivots: number[] = [];
  const n = values.length;
  for (let i = sm; i < n - sm; i++) {
    let ok = true;
    const v = values[i];
    for (let j = i - sm; j <= i + sm && ok; j++) {
      if (j === i) continue;
      if (type === 'high' && values[j] > v) ok = false;
      if (type === 'low'  && values[j] < v) ok = false;
    }
    if (ok) pivots.push(i);
  }
  return pivots;
}

function detectRSIBullishDivergence(closes: number[], rsi14: number[], lookback = 30): boolean {
  if (closes.length < lookback + 5) return false;
  const ps   = closes.slice(-lookback);
  const rs   = rsi14.slice(-lookback);
  const idxs = findPivots(ps, 'low', 2);
  if (idxs.length < 2) return false;
  const i1 = idxs[idxs.length - 2], i2 = idxs[idxs.length - 1];
  if (ps[i2] >= ps[i1]) return false;          // 价格未创新低
  if (rs[i2] <= rs[i1]) return false;           // RSI 同步创新低 → 无背离
  if (lookback - 1 - i2 > 8) return false;      // 低点不够近期
  if (rs[i2] > 48) return false;                // 需在超卖区
  return true;
}

function detectRSIBearishDivergence(closes: number[], rsi14: number[], lookback = 30): boolean {
  if (closes.length < lookback + 5) return false;
  const ps   = closes.slice(-lookback);
  const rs   = rsi14.slice(-lookback);
  const idxs = findPivots(ps, 'high', 2);
  if (idxs.length < 2) return false;
  const i1 = idxs[idxs.length - 2], i2 = idxs[idxs.length - 1];
  if (ps[i2] <= ps[i1]) return false;
  if (rs[i2] >= rs[i1]) return false;
  if (lookback - 1 - i2 > 8) return false;
  if (rs[i2] < 52) return false;               // 需在超买区
  return true;
}

// ═══════════════════════════════════════════════════════════════
//  布林带 Squeeze（Bug-8 修复：不再调用 .filter()）
// ═══════════════════════════════════════════════════════════════

function detectBollingerSqueeze(
  boll: { upper: number; middle: number; lower: number }[], lookback = 20,
): { squeezing: boolean; width: number } {
  const n = boll.length;
  // 直接索引遍历，不创建副本数组
  const startIdx = Math.max(0, n - lookback - 1);
  let   minWidth = Infinity;
  let   curWidth = 0;
  let   count    = 0;

  for (let i = startIdx; i < n; i++) {
    const b = boll[i];
    if (b.middle <= 0) continue;
    const w = (b.upper - b.lower) / b.middle;
    if (i < n - 1) {
      if (w < minWidth) minWidth = w;
    } else {
      curWidth = w;
    }
    count++;
  }

  if (count < 3) return { squeezing: false, width: 0 };
  return {
    squeezing: minWidth < Infinity && curWidth < minWidth * 1.15,
    width: curWidth,
  };
}

// ═══════════════════════════════════════════════════════════════
//  Volume Profile
// ═══════════════════════════════════════════════════════════════

function calculateVolumeProfile(
  data: StockData[], lookback = 50, bucketCount = 24,
): { poc: number; vah: number; val: number } {
  const slice = data.slice(-lookback);
  const fallback = () => {
    const c = data[data.length - 1]?.close ?? 0;
    return { poc: c, vah: c * 1.02, val: c * 0.98 };
  };
  if (slice.length < 5) return fallback();

  let priceMin = slice[0].low, priceMax = slice[0].high;
  for (const d of slice) {
    if (d.low  < priceMin) priceMin = d.low;
    if (d.high > priceMax) priceMax = d.high;
  }
  const range = priceMax - priceMin;
  if (range <= 0) return fallback();

  const bucketSize = range / bucketCount;
  const buckets    = new Float64Array(bucketCount);   // typed array，比 number[] 节省约 8×

  for (const d of slice) {
    const lo    = Math.max(d.low,  priceMin);
    const hi    = Math.min(d.high, priceMax);
    const loIdx = Math.floor((lo - priceMin) / bucketSize);
    const hiIdx = Math.min(Math.floor((hi - priceMin) / bucketSize), bucketCount - 1);
    const span  = hiIdx - loIdx + 1;
    for (let b = loIdx; b <= hiIdx; b++) buckets[b] += d.volume / span;
  }

  let pocIdx = 0;
  for (let i = 1; i < bucketCount; i++) {
    if (buckets[i] > buckets[pocIdx]) pocIdx = i;
  }
  const poc = priceMin + (pocIdx + 0.5) * bucketSize;

  const totalVol   = buckets.reduce((a, b) => a + b, 0);
  let   accumulated = buckets[pocIdx];
  let   loIdx2 = pocIdx, hiIdx2 = pocIdx;

  while (accumulated < totalVol * 0.7 && (loIdx2 > 0 || hiIdx2 < bucketCount - 1)) {
    const addLo = loIdx2 > 0            ? buckets[loIdx2 - 1] : -Infinity;
    const addHi = hiIdx2 < bucketCount - 1 ? buckets[hiIdx2 + 1] : -Infinity;
    if (addLo >= addHi && loIdx2 > 0) { loIdx2--;  accumulated += buckets[loIdx2];  }
    else if (hiIdx2 < bucketCount - 1) { hiIdx2++;  accumulated += buckets[hiIdx2]; }
    else break;
  }

  return {
    poc,
    vah: priceMin + (hiIdx2 + 1) * bucketSize,
    val: priceMin + loIdx2        * bucketSize,
  };
}

// ═══════════════════════════════════════════════════════════════
//  ADX — Bug-6 修复：流式计算，零数组分配
// ═══════════════════════════════════════════════════════════════

function calculateADXLast(
  highs: number[], lows: number[], closes: number[], period = 14,
): { adx: number; diPlus: number; diMinus: number } {
  const n = closes.length;
  if (n < period * 2 + 2) return { adx: 0, diPlus: 0, diMinus: 0 };

  // ── 第一阶段：Wilder 种子（简单累加前 period 个 True Range / DM）──
  let trS = 0, dmPS = 0, dmMS = 0;
  for (let i = 1; i <= period; i++) {
    trS  += _tr(highs, lows, closes, i);
    const [dp, dm] = _dm(highs, lows, i);
    dmPS += dp; dmMS += dm;
  }

  // ── 第二阶段：生成 DX 值以种子化 ADX ──
  let dxSum = 0;
  let diP = 0, diM = 0;
  for (let i = period + 1; i <= period * 2; i++) {
    trS  = trS  - trS  / period + _tr(highs, lows, closes, i);
    const [dp, dm] = _dm(highs, lows, i);
    dmPS = dmPS - dmPS / period + dp;
    dmMS = dmMS - dmMS / period + dm;
    diP  = trS > 0 ? (dmPS / trS) * 100 : 0;
    diM  = trS > 0 ? (dmMS / trS) * 100 : 0;
    const dSum = diP + diM;
    dxSum += dSum > 0 ? (Math.abs(diP - diM) / dSum) * 100 : 0;
  }
  let adxVal = dxSum / period;

  // ── 第三阶段：Wilder 平滑 ADX ──
  for (let i = period * 2 + 1; i < n; i++) {
    trS  = trS  - trS  / period + _tr(highs, lows, closes, i);
    const [dp, dm] = _dm(highs, lows, i);
    dmPS = dmPS - dmPS / period + dp;
    dmMS = dmMS - dmMS / period + dm;
    diP  = trS > 0 ? (dmPS / trS) * 100 : 0;
    diM  = trS > 0 ? (dmMS / trS) * 100 : 0;
    const dSum = diP + diM;
    const dx   = dSum > 0 ? (Math.abs(diP - diM) / dSum) * 100 : 0;
    adxVal     = (adxVal * (period - 1) + dx) / period;
  }

  return { adx: adxVal, diPlus: diP, diMinus: diM };
}

// 内联辅助：True Range（避免重复条件判断）
function _tr(highs: number[], lows: number[], closes: number[], i: number): number {
  const hl  = highs[i] - lows[i];
  const hpc = Math.abs(highs[i]  - closes[i - 1]);
  const lpc = Math.abs(lows[i]   - closes[i - 1]);
  return hl > hpc ? (hl > lpc ? hl : lpc) : (hpc > lpc ? hpc : lpc);
}

// 内联辅助：Directional Movement
function _dm(highs: number[], lows: number[], i: number): [number, number] {
  const up = highs[i]      - highs[i - 1];
  const dn = lows[i - 1]   - lows[i];
  const dp = up > dn && up > 0 ? up : 0;
  const dm = dn > up && dn > 0 ? dn : 0;
  return [dp, dm];
}

// ═══════════════════════════════════════════════════════════════
//  ATR-14（威爾德平滑真實波動度）—— 止盈止損核心數據
// ═══════════════════════════════════════════════════════════════

/**
 * 14 期威爾德 ATR（Wilder's Smoothed Average True Range）
 * 是計算止損緩衝的最可靠波動度指標
 */
function calcATR14(highs: number[], lows: number[], closes: number[], period = 14): number {
  const n = closes.length;
  if (n < period + 1) return 0;

  // 初始化：前 period 根 TR 的簡單平均
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    );
    atr += tr;
  }
  atr /= period;

  // 威爾德平滑：後續以 (atr×(period-1) + tr) / period 遞推
  for (let i = period + 1; i < n; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    );
    atr = (atr * (period - 1) + tr) / period;
  }
  return atr;
}

// ═══════════════════════════════════════════════════════════════
//  波段高低點識別 —— 止盈止損結構性錨位
// ═══════════════════════════════════════════════════════════════

/**
 * 在最近 lookback 根 K 線中找到最近的兩個確認波段高點和低點。
 * 判定規則：以目標 bar 為中心，左右各 3 根均低於（或高於）它 → 確認。
 * 需留尾部 3 根未確認區，故掃描上限為 data.length - 3。
 */
function calcSwingLevels(
  highs: number[], lows: number[], lookback = 60,
): { swingHigh: number; swingLow: number; prevSwingHigh: number; prevSwingLow: number } {
  const n     = highs.length;
  const start = Math.max(3, n - lookback);
  const end   = n - 3; // 最後 3 根尚未確認，跳過

  const foundHighs: number[] = [];
  const foundLows:  number[] = [];

  for (let i = start; i < end; i++) {
    // 3 根 pivot high
    let isHigh = true;
    for (let j = 1; j <= 3; j++) {
      if (highs[i] <= highs[i - j] || highs[i] <= highs[i + j]) { isHigh = false; break; }
    }
    if (isHigh) foundHighs.push(highs[i]);

    // 3 根 pivot low
    let isLow = true;
    for (let j = 1; j <= 3; j++) {
      if (lows[i] >= lows[i - j] || lows[i] >= lows[i + j]) { isLow = false; break; }
    }
    if (isLow) foundLows.push(lows[i]);
  }

  // foundHighs / foundLows 是時間正序；逆序取最近兩個
  foundHighs.reverse();
  foundLows.reverse();

  return {
    swingHigh:     foundHighs[0] ?? 0,
    prevSwingHigh: foundHighs[1] ?? 0,
    swingLow:      foundLows[0]  ?? 0,
    prevSwingLow:  foundLows[1]  ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════
//  主入口（带 LRU 缓存）
// ═══════════════════════════════════════════════════════════════

export function calculateAllIndicators(data: StockData[], symbol = ''): TechnicalIndicators {
  // ── 缓存命中 → 直接返回（Bug-4 修复核心）──
  const key = cacheKey(data, symbol);
  const hit = cacheGet(key);
  if (hit) return hit;

  const closes = data.map(d => d.close);
  const highs  = data.map(d => d.high);
  const lows   = data.map(d => d.low);
  const n      = data.length - 1;

  if (n < 0) {
    const empty = emptyIndicators();
    cacheSet(key, empty);
    return empty;
  }

  const ma5Arr   = calculateSMA(closes, 5);
  const ma10Arr  = calculateSMA(closes, 10);
  const ma20Arr  = calculateSMA(closes, 20);
  const ma60Arr  = calculateSMA(closes, 60);
  const ema9Arr  = calculateEMA(closes, 9);
  const ema21Arr = calculateEMA(closes, 21);
  const macd     = calculateMACD(closes);
  const kdj      = calculateKDJ(highs, lows, closes);
  const rsi6Arr  = calculateRSI(closes, 6);
  const rsi9Arr  = calculateRSI(closes, 9);
  const rsi12Arr = calculateRSI(closes, 12);
  const rsi14Arr = calculateRSI(closes, 14);
  const rsi24Arr = calculateRSI(closes, 24);
  const bollArr  = calculateBollingerBands(closes, 20, 2);
  const squeeze  = detectBollingerSqueeze(bollArr, 20);
  const rsiBullDiv = detectRSIBullishDivergence(closes, rsi14Arr, 30);
  const rsiBearDiv = detectRSIBearishDivergence(closes, rsi14Arr, 30);
  const vp       = calculateVolumeProfile(data, 60, 24);
  const adx      = calculateADXLast(highs, lows, closes, 14);
  const atr14    = calcATR14(highs, lows, closes);
  const swings   = calcSwingLevels(highs, lows);

  const result: TechnicalIndicators = {
    ma5:  ma5Arr[n]  || 0, ma10: ma10Arr[n] || 0,
    ma20: ma20Arr[n] || 0, ma60: ma60Arr[n] || 0,
    ema9:  ema9Arr[n]  || 0, ema21: ema21Arr[n] || 0,
    macdDif: macd.dif[n] || 0, macdDea: macd.dea[n] || 0,
    macdHistogram: macd.histogram[n] || 0,
    kdjK: kdj.k[n] || 50, kdjD: kdj.d[n] || 50, kdjJ: kdj.j[n] || 50,
    rsi6:  rsi6Arr[n]  || 50, rsi9:  rsi9Arr[n]  || 50,
    rsi12: rsi12Arr[n] || 50, rsi14: rsi14Arr[n] || 50,
    rsi24: rsi24Arr[n] || 50,
    rsiBullDiv, rsiBearDiv,
    bollUp: bollArr[n]?.upper  || 0,
    bollMb: bollArr[n]?.middle || 0,
    bollDn: bollArr[n]?.lower  || 0,
    bollWidth: squeeze.width, bollSqueezing: squeeze.squeezing,
    poc: vp.poc, valueAreaHigh: vp.vah, valueAreaLow: vp.val,
    adx: adx.adx, diPlus: adx.diPlus, diMinus: adx.diMinus,
    atr14,
    ...swings,
  };

  cacheSet(key, result);
  return result;
}

function emptyIndicators(): TechnicalIndicators {
  return {
    ma5: 0, ma10: 0, ma20: 0, ma60: 0, ema9: 0, ema21: 0,
    macdDif: 0, macdDea: 0, macdHistogram: 0,
    kdjK: 50, kdjD: 50, kdjJ: 50,
    rsi6: 50, rsi9: 50, rsi12: 50, rsi14: 50, rsi24: 50,
    rsiBullDiv: false, rsiBearDiv: false,
    bollUp: 0, bollMb: 0, bollDn: 0, bollWidth: 0, bollSqueezing: false,
    poc: 0, valueAreaHigh: 0, valueAreaLow: 0,
    adx: 0, diPlus: 0, diMinus: 0,
    atr14: 0, swingHigh: 0, swingLow: 0, prevSwingHigh: 0, prevSwingLow: 0,
  };
}

// ─── 辅助（供 signals / prediction 调用）────────────────────────────────────

/** getPreviousIndicators：调用 calculateAllIndicators 时自动命中缓存 */
export function getPreviousIndicators(data: StockData[], offset = 1, symbol = ''): TechnicalIndicators {
  if (data.length <= offset) return calculateAllIndicators(data, symbol);
  // slice 创建新数组引用，但 cacheKey 基于内容（length+close+ts），不依赖引用
  return calculateAllIndicators(data.slice(0, data.length - offset), symbol);
}

export function getAverageVolume(data: StockData[], period = 20): number {
  const slice = data.slice(-period);
  if (slice.length === 0) return 0;
  let sum = 0;
  for (const d of slice) sum += d.volume;
  return sum / slice.length;
}
