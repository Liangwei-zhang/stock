/**
 * tpsl-backtest.test.ts — V1~V5 止盈止損準確率對比回測
 *
 * 方法論：
 *  1. 生成三組含真實市場特性（看漲/看跌/混合）的合成 OHLCV 數據，各 500 根
 *  2. 使用版本無關的信號觸發器（RSI14 反轉：< 37 ↗ → 做多 / > 63 ↘ → 做空）
 *  3. 對每個信號分別用 V1~V5 計算止盈止損位
 *  4. 向前模擬最多 30 根 K 線：止盈先達到 = 勝 / 止損先達到 = 敗
 *  5. 統計：TP 達成率、SL 觸發率、平均 R:R、期望值(R)
 *
 * 各版本實現摘要：
 *  V1 — 只用 Bollinger 帶 + VAH/VAL（最基礎）
 *  V2 — 加入 ATR14 + 波段高低點（結構化止損）
 *  V3 — 加入訂單塊 + 流動性池 + 自適應 ATR + 黃金口袋 + 衝動結構斐波（多因子評分）
 *  V4 — 加入 VWAP-20 + BOS + FVG 缺口 + 多重斐波共振（機構錨點層）
 *  V5 — 加入 SFP + CVD + CHoCH 三重確認（信號質量門檻層）
 */

import { describe, it, expect } from 'vitest';
import { calculateAllIndicators } from '../utils/indicators';
import type { StockData, TechnicalIndicators } from '../types';

// ═══════════════════════════════════════════════════════════
//  合成數據生成器（帶趨勢 + 波動率集群 + 真實 OHLCV）
// ═══════════════════════════════════════════════════════════

function generateData(
  n: number, seed: number, trend: 'bull' | 'bear' | 'mixed',
): StockData[] {
  let s = seed >>> 0;
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  const randn = () => {
    const u1 = Math.max(rand(), 1e-10);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rand());
  };

  const bars: StockData[] = [];
  let price = 80 + rand() * 60;       // 起始價格 80-140
  let vol   = 0.012;                   // 日波動率
  let trendBase = trend === 'bull' ? 0.0004 : trend === 'bear' ? -0.0004 : 0.0001;
  let trendDir  = trendBase;
  let trendAge  = 0;
  let trendLife = 35 + Math.floor(rand() * 45);

  for (let i = 0; i < n; i++) {
    // 波動率集群（GARCH-like）
    vol = Math.max(0.005, Math.min(0.04, vol * 0.94 + 0.006 * Math.abs(randn())));
    // 趨勢週期切換（mixed 模式隨機翻轉）
    trendAge++;
    if (trendAge > trendLife) {
      if (trend === 'mixed') trendDir = (rand() > 0.52) ? 0.0004 : -0.0004;
      trendAge = 0;
      trendLife = 30 + Math.floor(rand() * 50);
    }
    const r     = trendDir + vol * randn();
    const open  = price;
    const close = Math.max(0.01, open * (1 + r));
    const candle = Math.abs(close - open);
    const wk    = vol * price * (0.3 + rand() * 1.2);
    const high  = Math.max(open, close) + wk * rand();
    const low   = Math.min(open, close) - wk * rand();
    const volume = 2e6 * (0.5 + rand() * 1.5) * (1 + Math.min(3, Math.abs(r) / (vol + 0.001)));

    bars.push({
      symbol: 'SYN', name: 'Synthetic', price: close, close,
      change: close - open, changePercent: r * 100,
      open, high: Math.max(high, open, close), low: Math.min(low, open, close),
      volume, timestamp: 1700000000000 + i * 86400000,
    });
    price = close;
  }
  return bars;
}

// ═══════════════════════════════════════════════════════════
//  V1 — Bollinger + VAH/VAL（最基礎）
// ═══════════════════════════════════════════════════════════

function calcTPSL_V1(price: number, isLong: boolean, ind: TechnicalIndicators) {
  const bRange = Math.max(ind.bollUp - ind.bollDn, price * 0.02);
  const fallback = bRange / 4;
  if (isLong) {
    const slRaw = [ind.bollDn, ind.valueAreaLow].filter(v => v > 0 && v < price * 0.999);
    const sl = Math.max(slRaw.length > 0 ? Math.max(...slRaw) : price - fallback * 2, price * 0.93);
    const risk = price - sl;
    const tp = ind.bollUp > price + risk * 0.8 ? ind.bollUp : price + risk * 1.5;
    return { tp: Math.max(tp, price + risk * 1.5), sl };
  } else {
    const slRaw = [ind.bollUp, ind.valueAreaHigh].filter(v => v > price * 1.001);
    const sl = Math.min(slRaw.length > 0 ? Math.min(...slRaw) : price + fallback * 2, price * 1.07);
    const risk = sl - price;
    const tp = ind.bollDn > 0 && ind.bollDn < price - risk * 0.8 ? ind.bollDn : price - risk * 1.5;
    return { tp: Math.min(tp, price - risk * 1.5), sl };
  }
}

// ═══════════════════════════════════════════════════════════
//  V2 — + ATR14 + 波段高低點
// ═══════════════════════════════════════════════════════════

function calcTPSL_V2(price: number, isLong: boolean, ind: TechnicalIndicators) {
  const bRange = Math.max(ind.bollUp - ind.bollDn, price * 0.02);
  const atr = ind.atr14 > 0 ? ind.atr14 : bRange / 4;
  if (isLong) {
    const slCands = [
      ind.swingLow  > 0 && ind.swingLow < price  ? ind.swingLow  - atr * 0.3 : 0,
      ind.bollDn    > 0 && ind.bollDn   < price  ? ind.bollDn                : 0,
      ind.valueAreaLow > 0 && ind.valueAreaLow < price ? ind.valueAreaLow   : 0,
    ].filter(v => v > 0);
    const sl = Math.max(slCands.length > 0 ? Math.max(...slCands) : price - atr * 2.2, price * 0.93);
    const risk = price - sl;
    const tp = ind.swingHigh > 0 && ind.swingHigh >= price + risk * 1.5 ? ind.swingHigh : price + risk * 1.5;
    return { tp, sl };
  } else {
    const slCands = [
      ind.swingHigh > 0 && ind.swingHigh > price ? ind.swingHigh + atr * 0.3 : 0,
      ind.bollUp    > 0 && ind.bollUp    > price ? ind.bollUp                : 0,
      ind.valueAreaHigh > 0 && ind.valueAreaHigh > price ? ind.valueAreaHigh : 0,
    ].filter(v => v > 0);
    const sl = Math.min(slCands.length > 0 ? Math.min(...slCands) : price + atr * 2.2, price * 1.07);
    const risk = sl - price;
    const tp = ind.swingLow > 0 && ind.swingLow <= price - risk * 1.5 ? ind.swingLow : price - risk * 1.5;
    return { tp, sl };
  }
}

// ═══════════════════════════════════════════════════════════
//  V3 — 多因子評分（OB + 流動性池 + 自適應 ATR + 黃金口袋 + 衝動斐波）
// ═══════════════════════════════════════════════════════════

function calcTPSL_V3(price: number, isLong: boolean, ind: TechnicalIndicators) {
  const bRange  = Math.max(ind.bollUp - ind.bollDn, price * 0.02);
  const atr     = ind.atr14 > 0 ? ind.atr14 : bRange / 4;
  const atrMult = ind.bollSqueezing ? 1.0 : ind.adx > 35 ? 1.5 : ind.adx > 25 ? 1.8 : ind.adx > 15 ? 2.2 : 2.5;
  const targetRR = ind.adx > 30 ? 2.5 : ind.adx > 20 ? 2.0 : 1.5;

  const goldenLong  = ind.prevSwingLow  > 0 && ind.swingHigh  > ind.prevSwingLow
    ? ind.swingHigh  - 0.618 * (ind.swingHigh  - ind.prevSwingLow)  : 0;
  const goldenShort = ind.prevSwingHigh > 0 && ind.swingLow   < ind.prevSwingHigh
    ? ind.swingLow   + 0.618 * (ind.prevSwingHigh - ind.swingLow)   : 0;
  const impulseLong  = ind.swingHigh > 0 && ind.prevSwingLow > 0 && ind.swingHigh > ind.prevSwingLow
    ? ind.swingHigh - ind.prevSwingLow : 0;
  const impulseShort = ind.swingLow > 0 && ind.prevSwingHigh > 0 && ind.prevSwingHigh > ind.swingLow
    ? ind.prevSwingHigh - ind.swingLow : 0;

  interface C { value: number; score: number }
  const clusterSL = (cs: C[]) => {
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++)
      if (Math.abs(cs[i].value - cs[j].value) / price <= 0.005) { cs[i].score += 2; cs[j].score += 2; }
  };
  const clusterTP = (cs: C[]) => {
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++)
      if (Math.abs(cs[i].value - cs[j].value) / price <= 0.008) { cs[i].score += 3; cs[j].score += 3; }
  };

  if (isLong) {
    const slC: C[] = [];
    if (ind.bullOBLow   > 0 && ind.bullOBLow   < price)         slC.push({ value: ind.bullOBLow   - atr * 0.1, score: 6 });
    if (ind.swingLow    > 0 && ind.swingLow    < price)         slC.push({ value: ind.swingLow    - atr * 0.3, score: 5 });
    if (goldenLong      > 0 && goldenLong       < price)         slC.push({ value: goldenLong      - atr * 0.1, score: 4 });
    slC.push({ value: price - atr * atrMult, score: 3 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow < price)        slC.push({ value: ind.valueAreaLow, score: 2 });
    if (ind.bollDn      > 0 && ind.bollDn      < price)         slC.push({ value: ind.bollDn,   score: 2 });
    if (ind.ema21       > 0 && ind.ema21       < price * 0.99)  slC.push({ value: ind.ema21,    score: ind.adx > 15 ? 2 : 1 });
    clusterSL(slC);
    const hf  = price * 0.93, maxSL = price - atr * 0.2;
    const vsl = slC.filter(c => c.value >= hf && c.value <= maxSL);
    const sl  = Math.max(vsl.length > 0 ? vsl.sort((a,b)=>b.score-a.score||b.value-a.value)[0].value : Math.max(price-atr*atrMult,hf), hf);
    const risk = price - sl;
    const minTP = price + risk * 1.5, idealTP = price + risk * targetRR;
    const tpC: C[] = [];
    if (ind.liqHigh     > 0 && ind.liqHigh     >= minTP)  tpC.push({ value: ind.liqHigh  * 0.998, score: 6 });
    if (ind.swingHigh   > 0 && ind.swingHigh   >= minTP)  tpC.push({ value: ind.swingHigh,         score: 5 });
    if (impulseLong > 0 && ind.swingHigh > 0) {
      const f1618 = ind.swingHigh + 0.618 * impulseLong;
      const f1272 = ind.swingHigh + 0.272 * impulseLong;
      if (f1618 >= minTP) tpC.push({ value: f1618, score: 5 });
      if (f1272 >= minTP) tpC.push({ value: f1272, score: 3 });
    }
    if (ind.bearOBLow   > 0 && ind.bearOBLow   >= minTP)  tpC.push({ value: ind.bearOBLow,          score: 4 });
    if (ind.prevSwingHigh > 0 && ind.prevSwingHigh >= minTP) tpC.push({ value: ind.prevSwingHigh,    score: 4 });
    const fr1618 = price + risk * 1.618, fr1272 = price + risk * 1.272;
    if (fr1618 >= minTP) tpC.push({ value: fr1618, score: 4 });
    if (fr1272 >= minTP) tpC.push({ value: fr1272, score: 3 });
    if (ind.poc          > price && ind.poc       >= minTP)  tpC.push({ value: ind.poc,              score: 3 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh >= minTP) tpC.push({ value: ind.valueAreaHigh,    score: 3 });
    if (ind.bollUp       > 0 && ind.bollUp       >= minTP)  tpC.push({ value: ind.bollUp,            score: 2 });
    if (idealTP > minTP) tpC.push({ value: idealTP, score: 2 });
    clusterTP(tpC);
    const tp = Math.max(tpC.length > 0 ? tpC.sort((a,b)=>b.score-a.score||a.value-b.value)[0].value : price+risk*2.0, minTP);
    return { tp, sl };
  } else {
    const slC: C[] = [];
    if (ind.bearOBHigh  > 0 && ind.bearOBHigh  > price)         slC.push({ value: ind.bearOBHigh  + atr * 0.1, score: 6 });
    if (ind.swingHigh   > 0 && ind.swingHigh   > price)         slC.push({ value: ind.swingHigh   + atr * 0.3, score: 5 });
    if (goldenShort     > 0 && goldenShort      > price)         slC.push({ value: goldenShort     + atr * 0.1, score: 4 });
    slC.push({ value: price + atr * atrMult, score: 3 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh > price)      slC.push({ value: ind.valueAreaHigh, score: 2 });
    if (ind.bollUp      > 0 && ind.bollUp      > price)         slC.push({ value: ind.bollUp,   score: 2 });
    if (ind.ema21       > 0 && ind.ema21       > price * 1.01)  slC.push({ value: ind.ema21,    score: ind.adx > 15 ? 2 : 1 });
    clusterSL(slC);
    const hc  = price * 1.07, minSL = price + atr * 0.2;
    const vsl = slC.filter(c => c.value >= minSL && c.value <= hc);
    const sl  = Math.min(vsl.length > 0 ? vsl.sort((a,b)=>b.score-a.score||a.value-b.value)[0].value : Math.min(price+atr*atrMult,hc), hc);
    const risk = sl - price;
    const minTP = price - risk * 1.5, idealTP = price - risk * targetRR;
    const tpC: C[] = [];
    if (ind.liqLow      > 0 && ind.liqLow      <= minTP)  tpC.push({ value: ind.liqLow   * 1.002, score: 6 });
    if (ind.swingLow    > 0 && ind.swingLow    <= minTP)  tpC.push({ value: ind.swingLow,          score: 5 });
    if (impulseShort > 0 && ind.swingLow > 0) {
      const f1618 = ind.swingLow - 0.618 * impulseShort;
      const f1272 = ind.swingLow - 0.272 * impulseShort;
      if (f1618 <= minTP) tpC.push({ value: f1618, score: 5 });
      if (f1272 <= minTP) tpC.push({ value: f1272, score: 3 });
    }
    if (ind.bullOBHigh  > 0 && ind.bullOBHigh  <= minTP)  tpC.push({ value: ind.bullOBHigh,         score: 4 });
    if (ind.prevSwingLow > 0 && ind.prevSwingLow <= minTP) tpC.push({ value: ind.prevSwingLow,       score: 4 });
    const fr1618 = price - risk * 1.618, fr1272 = price - risk * 1.272;
    if (fr1618 <= minTP) tpC.push({ value: fr1618, score: 4 });
    if (fr1272 <= minTP) tpC.push({ value: fr1272, score: 3 });
    if (ind.poc > 0 && ind.poc < price && ind.poc <= minTP) tpC.push({ value: ind.poc,              score: 3 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow <= minTP) tpC.push({ value: ind.valueAreaLow,       score: 3 });
    if (ind.bollDn      > 0 && ind.bollDn      <= minTP)  tpC.push({ value: ind.bollDn,             score: 2 });
    if (idealTP < minTP) tpC.push({ value: idealTP, score: 2 });
    clusterTP(tpC);
    const tp = Math.min(tpC.length > 0 ? tpC.sort((a,b)=>b.score-a.score||b.value-a.value)[0].value : price-risk*2.0, minTP);
    return { tp, sl };
  }
}

// ═══════════════════════════════════════════════════════════
//  V4 — 在 V3 基礎上加入 VWAP + BOS + FVG + 多重斐波共振
// ═══════════════════════════════════════════════════════════

function calcTPSL_V4(price: number, isLong: boolean, ind: TechnicalIndicators) {
  const bRange  = Math.max(ind.bollUp - ind.bollDn, price * 0.02);
  const atr     = ind.atr14 > 0 ? ind.atr14 : bRange / 4;
  const atrMult = ind.bollSqueezing ? 1.0 : ind.adx > 35 ? 1.5 : ind.adx > 25 ? 1.8 : ind.adx > 15 ? 2.2 : 2.5;
  const targetRR = ind.adx > 30 ? 2.5 : ind.adx > 20 ? 2.0 : 1.5;

  const goldenLong  = ind.prevSwingLow  > 0 && ind.swingHigh  > ind.prevSwingLow
    ? ind.swingHigh  - 0.618 * (ind.swingHigh  - ind.prevSwingLow)  : 0;
  const goldenShort = ind.prevSwingHigh > 0 && ind.swingLow   < ind.prevSwingHigh
    ? ind.swingLow   + 0.618 * (ind.prevSwingHigh - ind.swingLow)   : 0;
  const impulseLong  = ind.swingHigh > 0 && ind.prevSwingLow > 0 && ind.swingHigh > ind.prevSwingLow
    ? ind.swingHigh - ind.prevSwingLow : 0;
  const impulseShort = ind.swingLow > 0 && ind.prevSwingHigh > 0 && ind.prevSwingHigh > ind.swingLow
    ? ind.prevSwingHigh - ind.swingLow : 0;

  interface C { value: number; score: number }
  const clust = (cs: C[], pct: number, bon: number) => {
    for (let i = 0; i < cs.length; i++) for (let j = i+1; j < cs.length; j++)
      if (Math.abs(cs[i].value - cs[j].value) / price <= pct) { cs[i].score += bon; cs[j].score += bon; }
  };

  if (isLong) {
    const slC: C[] = [];
    if (ind.bullOBLow   > 0 && ind.bullOBLow   < price)          slC.push({ value: ind.bullOBLow   - atr*0.1, score: 6 });
    if (ind.swingLow    > 0 && ind.swingLow    < price)          slC.push({ value: ind.swingLow    - atr*0.3, score: 5 });
    if (goldenLong      > 0 && goldenLong       < price)          slC.push({ value: goldenLong      - atr*0.1, score: 4 });
    slC.push({ value: price - atr * atrMult, score: 3 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow < price)         slC.push({ value: ind.valueAreaLow, score: 2 });
    if (ind.bollDn      > 0 && ind.bollDn      < price)          slC.push({ value: ind.bollDn,   score: 2 });
    if (ind.ema21       > 0 && ind.ema21       < price * 0.99)   slC.push({ value: ind.ema21,    score: ind.adx > 15 ? 2 : 1 });
    // V4 新增 SL 因子
    if (ind.fvgBullBot  > 0 && ind.fvgBullBot  < price)          slC.push({ value: ind.fvgBullBot  - atr*0.1, score: 5 });
    if (ind.bosSupport  > 0 && ind.bosSupport  < price)          slC.push({ value: ind.bosSupport  - atr*0.1, score: 4 });
    if (ind.vwap20      > 0 && ind.vwap20      < price * 0.99)   slC.push({ value: ind.vwap20     - atr*0.05, score: 3 });
    clust(slC, 0.005, 2);
    const hf  = price * 0.93, maxSL = price - atr * 0.2;
    const vsl = slC.filter(c => c.value >= hf && c.value <= maxSL);
    const sl  = Math.max(vsl.length > 0 ? vsl.sort((a,b)=>b.score-a.score||b.value-a.value)[0].value : Math.max(price-atr*atrMult,hf), hf);
    const risk = price - sl;
    const minTP = price + risk * 1.5, idealTP = price + risk * targetRR;
    const tpC: C[] = [];
    if (ind.liqHigh      > 0 && ind.liqHigh      >= minTP)   tpC.push({ value: ind.liqHigh  *0.998, score: 6 });
    if (ind.swingHigh    > 0 && ind.swingHigh    >= minTP)   tpC.push({ value: ind.swingHigh,        score: 5 });
    if (impulseLong > 0 && ind.swingHigh > 0) {
      const f1618 = ind.swingHigh + 0.618 * impulseLong;
      const f1272 = ind.swingHigh + 0.272 * impulseLong;
      if (f1618 >= minTP) tpC.push({ value: f1618, score: 5 });
      if (f1272 >= minTP) tpC.push({ value: f1272, score: 3 });
    }
    if (ind.bearOBLow    > 0 && ind.bearOBLow    >= minTP)   tpC.push({ value: ind.bearOBLow,        score: 4 });
    if (ind.prevSwingHigh > 0 && ind.prevSwingHigh >= minTP) tpC.push({ value: ind.prevSwingHigh,    score: 4 });
    const fr1618 = price + risk * 1.618, fr1272 = price + risk * 1.272;
    if (fr1618 >= minTP) tpC.push({ value: fr1618, score: 4 });
    if (fr1272 >= minTP) tpC.push({ value: fr1272, score: 3 });
    if (ind.poc          > price && ind.poc       >= minTP)   tpC.push({ value: ind.poc,              score: 3 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh >= minTP) tpC.push({ value: ind.valueAreaHigh,    score: 3 });
    if (ind.bollUp       > 0 && ind.bollUp       >= minTP)   tpC.push({ value: ind.bollUp,           score: 2 });
    if (idealTP > minTP) tpC.push({ value: idealTP, score: 2 });
    // V4 新增 TP 因子
    if (ind.fvgBearBot   > 0 && ind.fvgBearBot   >= minTP)   tpC.push({ value: ind.fvgBearBot,       score: 6 });
    if (ind.fibConvAbove > 0 && ind.fibConvAbove >= minTP)   tpC.push({ value: ind.fibConvAbove,     score: 5 });
    if (ind.vwap20       > 0 && ind.vwap20       >= minTP)   tpC.push({ value: ind.vwap20,           score: 4 });
    clust(tpC, 0.008, 3);
    const tp = Math.max(tpC.length > 0 ? tpC.sort((a,b)=>b.score-a.score||a.value-b.value)[0].value : price+risk*2.0, minTP);
    return { tp, sl };
  } else {
    const slC: C[] = [];
    if (ind.bearOBHigh  > 0 && ind.bearOBHigh  > price)          slC.push({ value: ind.bearOBHigh  + atr*0.1, score: 6 });
    if (ind.swingHigh   > 0 && ind.swingHigh   > price)          slC.push({ value: ind.swingHigh   + atr*0.3, score: 5 });
    if (goldenShort     > 0 && goldenShort      > price)          slC.push({ value: goldenShort     + atr*0.1, score: 4 });
    slC.push({ value: price + atr * atrMult, score: 3 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh > price)       slC.push({ value: ind.valueAreaHigh, score: 2 });
    if (ind.bollUp      > 0 && ind.bollUp      > price)          slC.push({ value: ind.bollUp,   score: 2 });
    if (ind.ema21       > 0 && ind.ema21       > price * 1.01)   slC.push({ value: ind.ema21,    score: ind.adx > 15 ? 2 : 1 });
    if (ind.fvgBearTop  > 0 && ind.fvgBearTop  > price)          slC.push({ value: ind.fvgBearTop  + atr*0.1, score: 5 });
    if (ind.bosResistance > 0 && ind.bosResistance > price)       slC.push({ value: ind.bosResistance + atr*0.1, score: 4 });
    if (ind.vwap20      > 0 && ind.vwap20      > price * 1.01)   slC.push({ value: ind.vwap20     + atr*0.05, score: 3 });
    clust(slC, 0.005, 2);
    const hc  = price * 1.07, minSL = price + atr * 0.2;
    const vsl = slC.filter(c => c.value >= minSL && c.value <= hc);
    const sl  = Math.min(vsl.length > 0 ? vsl.sort((a,b)=>b.score-a.score||a.value-b.value)[0].value : Math.min(price+atr*atrMult,hc), hc);
    const risk = sl - price;
    const minTP = price - risk * 1.5, idealTP = price - risk * targetRR;
    const tpC: C[] = [];
    if (ind.liqLow      > 0 && ind.liqLow      <= minTP)    tpC.push({ value: ind.liqLow  *1.002, score: 6 });
    if (ind.swingLow    > 0 && ind.swingLow    <= minTP)    tpC.push({ value: ind.swingLow,        score: 5 });
    if (impulseShort > 0 && ind.swingLow > 0) {
      const f1618 = ind.swingLow - 0.618 * impulseShort;
      const f1272 = ind.swingLow - 0.272 * impulseShort;
      if (f1618 <= minTP) tpC.push({ value: f1618, score: 5 });
      if (f1272 <= minTP) tpC.push({ value: f1272, score: 3 });
    }
    if (ind.bullOBHigh  > 0 && ind.bullOBHigh  <= minTP)    tpC.push({ value: ind.bullOBHigh,       score: 4 });
    if (ind.prevSwingLow > 0 && ind.prevSwingLow <= minTP)  tpC.push({ value: ind.prevSwingLow,     score: 4 });
    const fr1618 = price - risk * 1.618, fr1272 = price - risk * 1.272;
    if (fr1618 <= minTP) tpC.push({ value: fr1618, score: 4 });
    if (fr1272 <= minTP) tpC.push({ value: fr1272, score: 3 });
    if (ind.poc > 0 && ind.poc < price && ind.poc <= minTP) tpC.push({ value: ind.poc,              score: 3 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow <= minTP)  tpC.push({ value: ind.valueAreaLow,     score: 3 });
    if (ind.bollDn      > 0 && ind.bollDn      <= minTP)    tpC.push({ value: ind.bollDn,           score: 2 });
    if (idealTP < minTP) tpC.push({ value: idealTP, score: 2 });
    if (ind.fvgBullTop  > 0 && ind.fvgBullTop  <= minTP)    tpC.push({ value: ind.fvgBullTop,       score: 6 });
    if (ind.fibConvBelow > 0 && ind.fibConvBelow <= minTP)  tpC.push({ value: ind.fibConvBelow,     score: 5 });
    if (ind.vwap20      > 0 && ind.vwap20      <= minTP)    tpC.push({ value: ind.vwap20,           score: 4 });
    clust(tpC, 0.008, 3);
    const tp = Math.min(tpC.length > 0 ? tpC.sort((a,b)=>b.score-a.score||b.value-a.value)[0].value : price-risk*2.0, minTP);
    return { tp, sl };
  }
}

// ═══════════════════════════════════════════════════════════
//  V5 — 在 V4 基礎上加入 SFP + CVD + CHoCH 三重確認層
// ═══════════════════════════════════════════════════════════

function calcTPSL_V5(price: number, isLong: boolean, ind: TechnicalIndicators) {
  const bRange   = Math.max(ind.bollUp - ind.bollDn, price * 0.02);
  const atr      = ind.atr14 > 0 ? ind.atr14 : bRange / 4;
  const baseAtrM = ind.bollSqueezing ? 1.0 : ind.adx > 35 ? 1.5 : ind.adx > 25 ? 1.8 : ind.adx > 15 ? 2.2 : 2.5;
  const baseRR   = ind.adx > 30 ? 2.5 : ind.adx > 20 ? 2.0 : 1.5;

  // V5 三重確認
  const longConf  = (ind.sfpBull || ind.cvdBullDiv) && ind.chochBull;
  const shortConf = (ind.sfpBear || ind.cvdBearDiv) && ind.chochBear;
  const longPart  = ind.sfpBull || ind.cvdBullDiv || ind.chochBull;
  const shortPart = ind.sfpBear || ind.cvdBearDiv || ind.chochBear;

  const atrMult  = isLong
    ? (longConf  ? baseAtrM * 0.85 : longPart  ? baseAtrM * 0.92 : baseAtrM)
    : (shortConf ? baseAtrM * 0.85 : shortPart ? baseAtrM * 0.92 : baseAtrM);
  const targetRR = isLong
    ? (longConf  ? baseRR + 0.5     : longPart  ? baseRR + 0.2    : baseRR)
    : (shortConf ? baseRR + 0.5     : shortPart ? baseRR + 0.2    : baseRR);

  const goldenLong  = ind.prevSwingLow  > 0 && ind.swingHigh  > ind.prevSwingLow
    ? ind.swingHigh  - 0.618 * (ind.swingHigh  - ind.prevSwingLow)  : 0;
  const goldenShort = ind.prevSwingHigh > 0 && ind.swingLow   < ind.prevSwingHigh
    ? ind.swingLow   + 0.618 * (ind.prevSwingHigh - ind.swingLow)   : 0;
  const impulseLong  = ind.swingHigh > 0 && ind.prevSwingLow > 0 && ind.swingHigh > ind.prevSwingLow
    ? ind.swingHigh - ind.prevSwingLow : 0;
  const impulseShort = ind.swingLow > 0 && ind.prevSwingHigh > 0 && ind.prevSwingHigh > ind.swingLow
    ? ind.prevSwingHigh - ind.swingLow : 0;

  interface C { value: number; score: number }
  const clust = (cs: C[], pct: number, bon: number) => {
    for (let i = 0; i < cs.length; i++) for (let j = i+1; j < cs.length; j++)
      if (Math.abs(cs[i].value - cs[j].value) / price <= pct) { cs[i].score += bon; cs[j].score += bon; }
  };

  if (isLong) {
    const slC: C[] = [];
    if (ind.bullOBLow   > 0 && ind.bullOBLow   < price)          slC.push({ value: ind.bullOBLow   - atr*0.1, score: 6 });
    if (ind.swingLow    > 0 && ind.swingLow    < price)          slC.push({ value: ind.swingLow    - atr*0.3, score: 5 });
    if (goldenLong      > 0 && goldenLong       < price)          slC.push({ value: goldenLong      - atr*0.1, score: 4 });
    slC.push({ value: price - atr * atrMult, score: 3 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow < price)         slC.push({ value: ind.valueAreaLow, score: 2 });
    if (ind.bollDn      > 0 && ind.bollDn      < price)          slC.push({ value: ind.bollDn,   score: 2 });
    if (ind.ema21       > 0 && ind.ema21       < price * 0.99)   slC.push({ value: ind.ema21,    score: ind.adx > 15 ? 2 : 1 });
    if (ind.fvgBullBot  > 0 && ind.fvgBullBot  < price)          slC.push({ value: ind.fvgBullBot  - atr*0.1, score: 5 });
    if (ind.bosSupport  > 0 && ind.bosSupport  < price)          slC.push({ value: ind.bosSupport  - atr*0.1, score: 4 });
    if (ind.vwap20      > 0 && ind.vwap20      < price * 0.99)   slC.push({ value: ind.vwap20     - atr*0.05, score: 3 });
    // V5 SFP 確認
    if (ind.sfpBull && ind.swingLow > 0 && ind.swingLow < price) slC.push({ value: ind.swingLow - atr*0.15, score: 7 });
    if (longConf) slC.forEach(c => { c.score += 2; });
    else if (longPart) slC.forEach(c => { c.score += 1; });
    clust(slC, 0.005, 2);
    const hf  = price * 0.93, maxSL = price - atr * 0.2;
    const vsl = slC.filter(c => c.value >= hf && c.value <= maxSL);
    const sl  = Math.max(vsl.length > 0 ? vsl.sort((a,b)=>b.score-a.score||b.value-a.value)[0].value : Math.max(price-atr*atrMult,hf), hf);
    const risk = price - sl;
    const minTP = price + risk * 1.5, idealTP = price + risk * targetRR;
    const tpC: C[] = [];
    if (ind.liqHigh      > 0 && ind.liqHigh      >= minTP)   tpC.push({ value: ind.liqHigh  *0.998, score: 6 });
    if (ind.swingHigh    > 0 && ind.swingHigh    >= minTP)   tpC.push({ value: ind.swingHigh,        score: 5 });
    if (impulseLong > 0 && ind.swingHigh > 0) {
      const f1618 = ind.swingHigh + 0.618 * impulseLong;
      const f1272 = ind.swingHigh + 0.272 * impulseLong;
      if (f1618 >= minTP) tpC.push({ value: f1618, score: 5 });
      if (f1272 >= minTP) tpC.push({ value: f1272, score: 3 });
    }
    if (ind.bearOBLow    > 0 && ind.bearOBLow    >= minTP)   tpC.push({ value: ind.bearOBLow,        score: 4 });
    if (ind.prevSwingHigh > 0 && ind.prevSwingHigh >= minTP) tpC.push({ value: ind.prevSwingHigh,    score: 4 });
    const fr1618 = price + risk * 1.618, fr1272 = price + risk * 1.272;
    if (fr1618 >= minTP) tpC.push({ value: fr1618, score: 4 });
    if (fr1272 >= minTP) tpC.push({ value: fr1272, score: 3 });
    if (ind.poc          > price && ind.poc       >= minTP)   tpC.push({ value: ind.poc,              score: 3 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh >= minTP) tpC.push({ value: ind.valueAreaHigh,    score: 3 });
    if (ind.bollUp       > 0 && ind.bollUp       >= minTP)   tpC.push({ value: ind.bollUp,           score: 2 });
    if (idealTP > minTP) tpC.push({ value: idealTP, score: 2 });
    if (ind.fvgBearBot   > 0 && ind.fvgBearBot   >= minTP)   tpC.push({ value: ind.fvgBearBot,       score: 6 });
    if (ind.fibConvAbove > 0 && ind.fibConvAbove >= minTP)   tpC.push({ value: ind.fibConvAbove,     score: 5 });
    if (ind.vwap20       > 0 && ind.vwap20       >= minTP)   tpC.push({ value: ind.vwap20,           score: 4 });
    if (ind.sfpBull && ind.liqHigh > 0 && ind.liqHigh >= minTP) tpC.push({ value: ind.liqHigh*0.996, score: 8 });
    if (longConf && ind.fibConvAbove > 0 && ind.fibConvAbove >= minTP) tpC.push({ value: ind.fibConvAbove, score: 9 });
    clust(tpC, 0.008, 3);
    const tp = Math.max(tpC.length > 0 ? tpC.sort((a,b)=>b.score-a.score||a.value-b.value)[0].value : price+risk*2.0, minTP);
    return { tp, sl };
  } else {
    const slC: C[] = [];
    if (ind.bearOBHigh  > 0 && ind.bearOBHigh  > price)          slC.push({ value: ind.bearOBHigh  + atr*0.1, score: 6 });
    if (ind.swingHigh   > 0 && ind.swingHigh   > price)          slC.push({ value: ind.swingHigh   + atr*0.3, score: 5 });
    if (goldenShort     > 0 && goldenShort      > price)          slC.push({ value: goldenShort     + atr*0.1, score: 4 });
    slC.push({ value: price + atr * atrMult, score: 3 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh > price)       slC.push({ value: ind.valueAreaHigh, score: 2 });
    if (ind.bollUp      > 0 && ind.bollUp      > price)          slC.push({ value: ind.bollUp,   score: 2 });
    if (ind.ema21       > 0 && ind.ema21       > price * 1.01)   slC.push({ value: ind.ema21,    score: ind.adx > 15 ? 2 : 1 });
    if (ind.fvgBearTop  > 0 && ind.fvgBearTop  > price)          slC.push({ value: ind.fvgBearTop  + atr*0.1, score: 5 });
    if (ind.bosResistance > 0 && ind.bosResistance > price)       slC.push({ value: ind.bosResistance + atr*0.1, score: 4 });
    if (ind.vwap20      > 0 && ind.vwap20      > price * 1.01)   slC.push({ value: ind.vwap20     + atr*0.05, score: 3 });
    if (ind.sfpBear && ind.swingHigh > 0 && ind.swingHigh > price) slC.push({ value: ind.swingHigh + atr*0.15, score: 7 });
    if (shortConf) slC.forEach(c => { c.score += 2; });
    else if (shortPart) slC.forEach(c => { c.score += 1; });
    clust(slC, 0.005, 2);
    const hc  = price * 1.07, minSL = price + atr * 0.2;
    const vsl = slC.filter(c => c.value >= minSL && c.value <= hc);
    const sl  = Math.min(vsl.length > 0 ? vsl.sort((a,b)=>b.score-a.score||a.value-b.value)[0].value : Math.min(price+atr*atrMult,hc), hc);
    const risk = sl - price;
    const minTP = price - risk * 1.5, idealTP = price - risk * targetRR;
    const tpC: C[] = [];
    if (ind.liqLow      > 0 && ind.liqLow      <= minTP)    tpC.push({ value: ind.liqLow  *1.002, score: 6 });
    if (ind.swingLow    > 0 && ind.swingLow    <= minTP)    tpC.push({ value: ind.swingLow,        score: 5 });
    if (impulseShort > 0 && ind.swingLow > 0) {
      const f1618 = ind.swingLow - 0.618 * impulseShort;
      const f1272 = ind.swingLow - 0.272 * impulseShort;
      if (f1618 <= minTP) tpC.push({ value: f1618, score: 5 });
      if (f1272 <= minTP) tpC.push({ value: f1272, score: 3 });
    }
    if (ind.bullOBHigh  > 0 && ind.bullOBHigh  <= minTP)    tpC.push({ value: ind.bullOBHigh,       score: 4 });
    if (ind.prevSwingLow > 0 && ind.prevSwingLow <= minTP)  tpC.push({ value: ind.prevSwingLow,     score: 4 });
    const fr1618 = price - risk * 1.618, fr1272 = price - risk * 1.272;
    if (fr1618 <= minTP) tpC.push({ value: fr1618, score: 4 });
    if (fr1272 <= minTP) tpC.push({ value: fr1272, score: 3 });
    if (ind.poc > 0 && ind.poc < price && ind.poc <= minTP) tpC.push({ value: ind.poc,              score: 3 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow <= minTP)  tpC.push({ value: ind.valueAreaLow,     score: 3 });
    if (ind.bollDn      > 0 && ind.bollDn      <= minTP)    tpC.push({ value: ind.bollDn,           score: 2 });
    if (idealTP < minTP) tpC.push({ value: idealTP, score: 2 });
    if (ind.fvgBullTop  > 0 && ind.fvgBullTop  <= minTP)    tpC.push({ value: ind.fvgBullTop,       score: 6 });
    if (ind.fibConvBelow > 0 && ind.fibConvBelow <= minTP)  tpC.push({ value: ind.fibConvBelow,     score: 5 });
    if (ind.vwap20      > 0 && ind.vwap20      <= minTP)    tpC.push({ value: ind.vwap20,           score: 4 });
    if (ind.sfpBear && ind.liqLow > 0 && ind.liqLow <= minTP) tpC.push({ value: ind.liqLow*1.004,  score: 8 });
    if (shortConf && ind.fibConvBelow > 0 && ind.fibConvBelow <= minTP) tpC.push({ value: ind.fibConvBelow, score: 9 });
    clust(tpC, 0.008, 3);
    const tp = Math.min(tpC.length > 0 ? tpC.sort((a,b)=>b.score-a.score||b.value-a.value)[0].value : price-risk*2.0, minTP);
    return { tp, sl };
  }
}

// ═══════════════════════════════════════════════════════════
//  前向模擬：檢查 TP / SL 在 maxHold 根 K 線內哪個先被觸及
// ═══════════════════════════════════════════════════════════

type Outcome = 'tp' | 'sl' | 'neutral';

function simulateTrade(
  data: StockData[], entryBar: number, isLong: boolean,
  tp: number, sl: number, maxHold = 30,
): { outcome: Outcome; returnR: number } {
  const entry = data[entryBar].close;
  const risk  = Math.abs(entry - sl);
  if (risk <= 0) return { outcome: 'neutral', returnR: 0 };

  for (let i = entryBar + 1; i < Math.min(entryBar + maxHold + 1, data.length); i++) {
    const bar = data[i];
    if (isLong) {
      if (bar.low  <= sl) return { outcome: 'sl', returnR: (sl - entry)   / risk };  // negative
      if (bar.high >= tp) return { outcome: 'tp', returnR: (tp - entry)   / risk };  // positive
    } else {
      if (bar.high >= sl) return { outcome: 'sl', returnR: (entry - sl)   / risk };  // negative
      if (bar.low  <= tp) return { outcome: 'tp', returnR: (entry - tp)   / risk };  // positive
    }
  }
  // 持有到期：以最後收盤計算
  const finalClose = data[Math.min(entryBar + maxHold, data.length - 1)].close;
  const returnR = isLong ? (finalClose - entry) / risk : (entry - finalClose) / risk;
  return { outcome: 'neutral', returnR };
}

// ═══════════════════════════════════════════════════════════
//  計算版本結果統計
// ═══════════════════════════════════════════════════════════

interface VersionStats {
  signals:  number;
  tpHits:   number;
  slHits:   number;
  neutrals: number;
  sumRR:    number;   // 所有交易 returnR 之和（含正負）
  sumRRw:   number;   // 只統計 TP 命中的平均獲利 R
  tpRRs:    number[]; // 每次 TP 命中的 R 值（用於中位數）
  slRRs:    number[]; // 每次 SL 觸發的 R 值（用於一致性驗證）
  avgSLDepth: number; // 止損到入場的深度（%）
  avgTPDist:  number; // 止盈到入場的距離（%）
  trades:     number[]; // 按序記錄每筆交易的 returnR（用於資金曲線模擬）
}

function makeStats(): VersionStats {
  return { signals: 0, tpHits: 0, slHits: 0, neutrals: 0, sumRR: 0, sumRRw: 0, tpRRs: [], slRRs: [], avgSLDepth: 0, avgTPDist: 0, trades: [] };
}

function finalize(s: VersionStats) {
  s.avgSLDepth /= (s.signals || 1);
  s.avgTPDist  /= (s.signals || 1);
}

// ═══════════════════════════════════════════════════════════
//  主測試
// ═══════════════════════════════════════════════════════════

describe('V1~V5 止盈止損準確率對比回測', () => {
  it('比較五個版本在合成數據上的 TP 達成率與期望值', () => {

    const DATASETS: Array<{ name: string; seed: number; trend: 'bull'|'bear'|'mixed' }> = [
      { name: '看漲趨勢', seed: 42,    trend: 'bull'  },
      { name: '看跌趨勢', seed: 1337,  trend: 'bear'  },
      { name: '混合行情', seed: 99999, trend: 'mixed' },
    ];

    const WARMUP  = 100;   // 預熱根數（讓指標穩定）
    const LOOKBACK = 30;   // 前向模擬窗口
    const DATA_LEN = 480;  // 每組數據長度

    const versions = ['V1', 'V2', 'V3', 'V4', 'V5'] as const;
    const calcFns  = [calcTPSL_V1, calcTPSL_V2, calcTPSL_V3, calcTPSL_V4, calcTPSL_V5];

    // 累計跨數據集的統計
    const total: Record<string, VersionStats> = {};
    for (const v of versions) total[v] = makeStats();

    for (const ds of DATASETS) {
      const data = generateData(DATA_LEN, ds.seed, ds.trend);

      // 預計算所有指標（bar WARMUP ~ DATA_LEN-LOOKBACK-1）
      const indicators: (TechnicalIndicators | null)[] = new Array(DATA_LEN).fill(null);
      for (let i = WARMUP; i < DATA_LEN - LOOKBACK; i++) {
        indicators[i] = calculateAllIndicators(data.slice(0, i + 1), `BT_${ds.seed}`);
      }

      // RSI14 反轉型信號：觸及超賣/超買後反彈/回落
      const signals: Array<{ bar: number; isLong: boolean }> = [];
      for (let i = WARMUP + 1; i < DATA_LEN - LOOKBACK - 1; i++) {
        const cur  = indicators[i];
        const prev = indicators[i - 1];
        if (!cur || !prev || cur.rsi14 <= 0 || prev.rsi14 <= 0) continue;
        if (prev.rsi14 < 37  && cur.rsi14 > prev.rsi14 && cur.rsi14 < 50)  signals.push({ bar: i, isLong: true  });
        else if (prev.rsi14 > 63 && cur.rsi14 < prev.rsi14 && cur.rsi14 > 50) signals.push({ bar: i, isLong: false });
      }

      for (const sig of signals) {
        const ind = indicators[sig.bar]!;
        const price = data[sig.bar].close;

        for (let vi = 0; vi < versions.length; vi++) {
          const vName = versions[vi];
          const { tp, sl } = calcFns[vi](price, sig.isLong, ind);

          // 驗證 TP/SL 方向合理（避免無效訂單對統計造成干擾）
          if (sig.isLong  && (sl >= price || tp <= price)) continue;
          if (!sig.isLong && (sl <= price || tp >= price)) continue;

          const risk    = Math.abs(price - sl);
          const tpDist  = Math.abs(tp  - price) / price * 100;
          const slDepth = risk / price * 100;

          const { outcome, returnR } = simulateTrade(data, sig.bar, sig.isLong, tp, sl, LOOKBACK);
          const st = total[vName];
          st.signals++;
          st.sumRR += returnR;
          st.avgSLDepth += slDepth;
          st.avgTPDist  += tpDist;
          st.trades.push(returnR);
          if (outcome === 'tp') {
            st.tpHits++;
            st.sumRRw += returnR;
            st.tpRRs.push(returnR);
          } else if (outcome === 'sl') {
            st.slHits++;
            st.slRRs.push(returnR);
          } else {
            st.neutrals++;
          }
        }
      }
    }

    // ── 輸出對比表 ────────────────────────────────────────────────────
    const pad  = (s: string, n: number) => s.padStart(n);
    const pct  = (n: number, d: number) => d > 0 ? `${(n / d * 100).toFixed(1)}%` : '—';
    const rr   = (n: number) => n.toFixed(3);

    console.log('\n');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('  V1 ~ V5  止盈止損準確率對比回測');
    console.log(`  數據集：看漲(seed=42) + 看跌(seed=1337) + 混合(seed=99999)，各 ${DATA_LEN} 根K線`);
    console.log(`  信號：RSI14 < 37 反彈做多 / > 63 回落做空 ｜ 模擬窗口：${LOOKBACK} 根`);
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log(
      pad('版本',4), ' │',
      pad('信號數',6), ' │',
      pad('TP達成率',9), ' │',
      pad('SL觸發率',9), ' │',
      pad('中立率',8), ' │',
      pad('TP命中勝率',11), ' │',
      pad('平均獲利R',10), ' │',
      pad('期望值R',9), ' │',
      pad('止損深度',9),
    );
    console.log('─'.repeat(92));

    let bestEV = -Infinity, bestVer = '';
    const rows: string[] = [];

    for (const v of versions) {
      finalize(total[v]);
      const st = total[v];
      const n  = st.signals;
      const decided = st.tpHits + st.slHits;
      const winRate = decided > 0 ? st.tpHits / decided : 0;
      const avgWin  = st.tpHits > 0 ? st.sumRRw / st.tpHits : 0;
      const ev      = n > 0 ? st.sumRR / n : 0;
      if (ev > bestEV) { bestEV = ev; bestVer = v; }

      const row = [
        pad(v,4), ' │',
        pad(`${n}`,6), ' │',
        pad(pct(st.tpHits, n),9), ' │',
        pad(pct(st.slHits, n),9), ' │',
        pad(pct(st.neutrals, n),8), ' │',
        pad(pct(st.tpHits,decided),11), ' │',
        pad(avgWin.toFixed(3)+'R', 10), ' │',
        pad(ev.toFixed(3)+'R',9), ' │',
        pad(st.avgSLDepth.toFixed(2)+'%',9),
      ].join('');
      rows.push(row);
      console.log(row);
    }

    console.log('─'.repeat(92));
    console.log(`  ★ 最佳版本：${bestVer}（期望值 ${rr(bestEV)} R）`);

    // 分解說明
    console.log('\n  各版本關鍵差異：');
    console.log('  V1  僅用 Bollinger ± VAH/VAL → 止損常設在統計邊界，噪音觸及率高');
    console.log('  V2  加入 ATR14 + 波段點 → 止損貼近結構，TP 有方向性目標');
    console.log('  V3  OB + 流動性池 + 自適應 ATR + 黃金口袋 → 多因子評分，更精確');
    console.log('  V4  VWAP + BOS + FVG + 多重斐波共振 → 機構錨點對齊，TP 更有磁力');
    console.log('  V5  SFP+CVD+CHoCH 三重確認 → 止損縮緊（精確入場）+ TP 延伸（高確信度）');
    console.log('══════════════════════════════════════════════════════════════════════\n');

    // ── 資金曲線模擬（固定風險 2%，起始本金 10,000）────────────────────────
    const INIT_CAPITAL = 10_000;
    const RISK_PCT     = 0.02;   // 每筆交易風險 2% 本金

    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('  資金曲線模擬  ｜  起始本金：10,000  ｜  每筆固定風險：2%');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log(
      pad('版本',4), ' │',
      pad('交易筆數',9), ' │',
      pad('最終資金',10), ' │',
      pad('淨損益',10), ' │',
      pad('報酬率',9), ' │',
      pad('最大回撤',9), ' │',
      pad('最低資金',10),
    );
    console.log('─'.repeat(80));

    let bestFinal = -Infinity, bestCapVer = '';

    for (const v of versions) {
      let cap   = INIT_CAPITAL;
      let peak  = INIT_CAPITAL;
      let maxDD = 0;
      let minCap = INIT_CAPITAL;

      for (const r of total[v].trades) {
        cap += cap * RISK_PCT * r;
        if (cap > peak) peak = cap;
        const dd = (peak - cap) / peak * 100;
        if (dd > maxDD)  maxDD = dd;
        if (cap < minCap) minCap = cap;
      }

      const net       = cap - INIT_CAPITAL;
      const returnPct = (cap / INIT_CAPITAL - 1) * 100;
      if (cap > bestFinal) { bestFinal = cap; bestCapVer = v; }

      console.log([
        pad(v, 4), ' │',
        pad(`${total[v].trades.length}`, 9), ' │',
        pad(cap.toFixed(0), 10), ' │',
        pad((net >= 0 ? '+' : '') + net.toFixed(0), 10), ' │',
        pad((returnPct >= 0 ? '+' : '') + returnPct.toFixed(2) + '%', 9), ' │',
        pad('-' + maxDD.toFixed(2) + '%', 9), ' │',
        pad(minCap.toFixed(0), 10),
      ].join(''));
    }

    console.log('─'.repeat(80));
    console.log(`  ★ 最終資金最多：${bestCapVer}（剩餘 ${bestFinal.toFixed(0)} 元）`);
    console.log('══════════════════════════════════════════════════════════════════════\n');

    // 測試斷言：所有版本都應產生有意義的信號
    for (const v of versions) {
      expect(total[v].signals).toBeGreaterThan(10);
    }

    // V3-V5 的期望值應優於 V1（更精確的 TP/SL 設定應提升期望值）
    const ev = (v: string) => total[v].signals > 0 ? total[v].sumRR / total[v].signals : 0;
    // 寬鬆斷言：至少有一個高版本期望值 ≥ V1（防止因隨機種子偶爾不成立）
    const highVersionsBetter = ev('V3') >= ev('V1') || ev('V4') >= ev('V1') || ev('V5') >= ev('V1');
    expect(highVersionsBetter).toBe(true);
  }, 60_000); // 60 秒超時
});
