/**
 * tpsl.ts — V1~V7 止盈止損計算工具
 *
 * V1 — Bollinger 帶 + VAH/VAL（最基礎）
 * V2 — + ATR14 + 波段高低點（結構化止損）
 * V3 — + 訂單塊 + 流動性池 + 自適應 ATR + 黃金口袋 + 斐波（多因子評分）
 * V4 — + VWAP-20 + BOS + FVG + 多重斐波共振（機構錨點層）
 * V5 — + SFP + CVD + CHoCH 三重確認（信號質量門檻層）
 * V6 — 融合 V2 止損紀律 + V5 三重確認 + 無確認跳單（跳過無確認入場）
 * V7 — 與 V6 相同 TP/SL；運行時由 autoTradeService 執行 1.5R 移動止損
 */

import type { TechnicalIndicators } from '../types';

export type ExitMode = 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'v7';

export interface TPSL { tp: number; sl: number }

/** 聚類加分：相互距離 ≤ pct 的兩個候選互相加 bonus 分 */
interface C { value: number; score: number }
function clust(cs: C[], price: number, pct: number, bonus: number) {
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++)
      if (Math.abs(cs[i].value - cs[j].value) / price <= pct) {
        cs[i].score += bonus; cs[j].score += bonus;
      }
}

// ─── V1 ─ Bollinger + VAH/VAL ──────────────────────────────────────────────

export function calcTPSL_V1(price: number, isLong: boolean, ind: TechnicalIndicators): TPSL {
  const bRange   = Math.max(ind.bollUp - ind.bollDn, price * 0.02);
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

// ─── V2 ─ + ATR14 + 波段高低點 ──────────────────────────────────────────────

export function calcTPSL_V2(price: number, isLong: boolean, ind: TechnicalIndicators): TPSL {
  const bRange = Math.max(ind.bollUp - ind.bollDn, price * 0.02);
  const atr    = ind.atr14 > 0 ? ind.atr14 : bRange / 4;
  if (isLong) {
    const slC = [
      ind.swingLow   > 0 && ind.swingLow   < price ? ind.swingLow   - atr * 0.3 : 0,
      ind.bollDn     > 0 && ind.bollDn     < price ? ind.bollDn                 : 0,
      ind.valueAreaLow > 0 && ind.valueAreaLow < price ? ind.valueAreaLow       : 0,
    ].filter(v => v > 0);
    const sl = Math.max(slC.length > 0 ? Math.max(...slC) : price - atr * 2.2, price * 0.93);
    const risk = price - sl;
    const tp = ind.swingHigh > 0 && ind.swingHigh >= price + risk * 1.5 ? ind.swingHigh : price + risk * 1.5;
    return { tp, sl };
  } else {
    const slC = [
      ind.swingHigh  > 0 && ind.swingHigh  > price ? ind.swingHigh  + atr * 0.3 : 0,
      ind.bollUp     > 0 && ind.bollUp     > price ? ind.bollUp                 : 0,
      ind.valueAreaHigh > 0 && ind.valueAreaHigh > price ? ind.valueAreaHigh   : 0,
    ].filter(v => v > 0);
    const sl = Math.min(slC.length > 0 ? Math.min(...slC) : price + atr * 2.2, price * 1.07);
    const risk = sl - price;
    const tp = ind.swingLow > 0 && ind.swingLow <= price - risk * 1.5 ? ind.swingLow : price - risk * 1.5;
    return { tp, sl };
  }
}

// ─── V3 ─ 多因子評分（OB + 流動性池 + 自適應 ATR + 黃金口袋 + 衝動斐波）──────

export function calcTPSL_V3(price: number, isLong: boolean, ind: TechnicalIndicators): TPSL {
  const bRange   = Math.max(ind.bollUp - ind.bollDn, price * 0.02);
  const atr      = ind.atr14 > 0 ? ind.atr14 : bRange / 4;
  const atrMult  = ind.bollSqueezing ? 1.0 : ind.adx > 35 ? 1.5 : ind.adx > 25 ? 1.8 : ind.adx > 15 ? 2.2 : 2.5;
  const targetRR = ind.adx > 30 ? 2.5 : ind.adx > 20 ? 2.0 : 1.5;

  const goldenL  = ind.prevSwingLow > 0 && ind.swingHigh > ind.prevSwingLow
    ? ind.swingHigh - 0.618 * (ind.swingHigh - ind.prevSwingLow) : 0;
  const goldenS  = ind.prevSwingHigh > 0 && ind.swingLow < ind.prevSwingHigh
    ? ind.swingLow + 0.618 * (ind.prevSwingHigh - ind.swingLow) : 0;
  const impulseL = ind.swingHigh > 0 && ind.prevSwingLow > 0 && ind.swingHigh > ind.prevSwingLow
    ? ind.swingHigh - ind.prevSwingLow : 0;
  const impulseS = ind.swingLow > 0 && ind.prevSwingHigh > 0 && ind.prevSwingHigh > ind.swingLow
    ? ind.prevSwingHigh - ind.swingLow : 0;

  if (isLong) {
    const slC: C[] = [];
    if (ind.bullOBLow  > 0 && ind.bullOBLow   < price)        slC.push({ value: ind.bullOBLow   - atr * 0.1, score: 6 });
    if (ind.swingLow   > 0 && ind.swingLow    < price)        slC.push({ value: ind.swingLow    - atr * 0.3, score: 5 });
    if (goldenL        > 0 && goldenL          < price)        slC.push({ value: goldenL         - atr * 0.1, score: 4 });
    slC.push({ value: price - atr * atrMult, score: 3 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow < price)     slC.push({ value: ind.valueAreaLow, score: 2 });
    if (ind.bollDn     > 0 && ind.bollDn      < price)        slC.push({ value: ind.bollDn,   score: 2 });
    if (ind.ema21      > 0 && ind.ema21       < price * 0.99) slC.push({ value: ind.ema21,    score: ind.adx > 15 ? 2 : 1 });
    clust(slC, price, 0.005, 2);
    const hf  = price * 0.93, maxSL = price - atr * 0.2;
    const vsl = slC.filter(c => c.value >= hf && c.value <= maxSL);
    const sl  = Math.max(vsl.length > 0 ? vsl.sort((a, b) => b.score - a.score || b.value - a.value)[0].value : Math.max(price - atr * atrMult, hf), hf);
    const risk = price - sl;
    const minTP = price + risk * 1.5, idealTP = price + risk * targetRR;
    const tpC: C[] = [];
    if (ind.liqHigh      > 0 && ind.liqHigh      >= minTP) tpC.push({ value: ind.liqHigh * 0.998,     score: 6 });
    if (ind.swingHigh    > 0 && ind.swingHigh    >= minTP) tpC.push({ value: ind.swingHigh,            score: 5 });
    if (impulseL > 0 && ind.swingHigh > 0) {
      const f1618 = ind.swingHigh + 0.618 * impulseL;
      const f1272 = ind.swingHigh + 0.272 * impulseL;
      if (f1618 >= minTP) tpC.push({ value: f1618, score: 5 });
      if (f1272 >= minTP) tpC.push({ value: f1272, score: 3 });
    }
    if (ind.bearOBLow    > 0 && ind.bearOBLow    >= minTP) tpC.push({ value: ind.bearOBLow,           score: 4 });
    if (ind.prevSwingHigh > 0 && ind.prevSwingHigh >= minTP) tpC.push({ value: ind.prevSwingHigh,      score: 4 });
    const fr1618 = price + risk * 1.618, fr1272 = price + risk * 1.272;
    if (fr1618 >= minTP) tpC.push({ value: fr1618, score: 4 });
    if (fr1272 >= minTP) tpC.push({ value: fr1272, score: 3 });
    if (ind.poc         > price && ind.poc       >= minTP) tpC.push({ value: ind.poc,                  score: 3 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh >= minTP) tpC.push({ value: ind.valueAreaHigh,     score: 3 });
    if (ind.bollUp       > 0 && ind.bollUp       >= minTP) tpC.push({ value: ind.bollUp,              score: 2 });
    if (idealTP > minTP) tpC.push({ value: idealTP, score: 2 });
    clust(tpC, price, 0.008, 3);
    const tp = Math.max(tpC.length > 0 ? tpC.sort((a, b) => b.score - a.score || a.value - b.value)[0].value : price + risk * 2.0, minTP);
    return { tp, sl };
  } else {
    const slC: C[] = [];
    if (ind.bearOBHigh > 0 && ind.bearOBHigh  > price)        slC.push({ value: ind.bearOBHigh  + atr * 0.1, score: 6 });
    if (ind.swingHigh  > 0 && ind.swingHigh   > price)        slC.push({ value: ind.swingHigh   + atr * 0.3, score: 5 });
    if (goldenS        > 0 && goldenS          > price)        slC.push({ value: goldenS         + atr * 0.1, score: 4 });
    slC.push({ value: price + atr * atrMult, score: 3 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh > price)   slC.push({ value: ind.valueAreaHigh, score: 2 });
    if (ind.bollUp     > 0 && ind.bollUp      > price)        slC.push({ value: ind.bollUp,   score: 2 });
    if (ind.ema21      > 0 && ind.ema21       > price * 1.01) slC.push({ value: ind.ema21,    score: ind.adx > 15 ? 2 : 1 });
    clust(slC, price, 0.005, 2);
    const hc  = price * 1.07, minSL = price + atr * 0.2;
    const vsl = slC.filter(c => c.value >= minSL && c.value <= hc);
    const sl  = Math.min(vsl.length > 0 ? vsl.sort((a, b) => b.score - a.score || a.value - b.value)[0].value : Math.min(price + atr * atrMult, hc), hc);
    const risk = sl - price;
    const minTP = price - risk * 1.5, idealTP = price - risk * targetRR;
    const tpC: C[] = [];
    if (ind.liqLow      > 0 && ind.liqLow      <= minTP) tpC.push({ value: ind.liqLow * 1.002,        score: 6 });
    if (ind.swingLow    > 0 && ind.swingLow    <= minTP) tpC.push({ value: ind.swingLow,              score: 5 });
    if (impulseS > 0 && ind.swingLow > 0) {
      const f1618 = ind.swingLow - 0.618 * impulseS;
      const f1272 = ind.swingLow - 0.272 * impulseS;
      if (f1618 <= minTP) tpC.push({ value: f1618, score: 5 });
      if (f1272 <= minTP) tpC.push({ value: f1272, score: 3 });
    }
    if (ind.bullOBHigh  > 0 && ind.bullOBHigh  <= minTP) tpC.push({ value: ind.bullOBHigh,            score: 4 });
    if (ind.prevSwingLow > 0 && ind.prevSwingLow <= minTP) tpC.push({ value: ind.prevSwingLow,         score: 4 });
    const fr1618 = price - risk * 1.618, fr1272 = price - risk * 1.272;
    if (fr1618 <= minTP) tpC.push({ value: fr1618, score: 4 });
    if (fr1272 <= minTP) tpC.push({ value: fr1272, score: 3 });
    if (ind.poc > 0 && ind.poc < price && ind.poc <= minTP) tpC.push({ value: ind.poc,                score: 3 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow <= minTP) tpC.push({ value: ind.valueAreaLow,        score: 3 });
    if (ind.bollDn      > 0 && ind.bollDn      <= minTP) tpC.push({ value: ind.bollDn,                score: 2 });
    if (idealTP < minTP) tpC.push({ value: idealTP, score: 2 });
    clust(tpC, price, 0.008, 3);
    const tp = Math.min(tpC.length > 0 ? tpC.sort((a, b) => b.score - a.score || b.value - a.value)[0].value : price - risk * 2.0, minTP);
    return { tp, sl };
  }
}

// ─── V4 ─ + VWAP-20 + BOS + FVG + 多重斐波共振 ─────────────────────────────

export function calcTPSL_V4(price: number, isLong: boolean, ind: TechnicalIndicators): TPSL {
  const bRange   = Math.max(ind.bollUp - ind.bollDn, price * 0.02);
  const atr      = ind.atr14 > 0 ? ind.atr14 : bRange / 4;
  const atrMult  = ind.bollSqueezing ? 1.0 : ind.adx > 35 ? 1.5 : ind.adx > 25 ? 1.8 : ind.adx > 15 ? 2.2 : 2.5;
  const targetRR = ind.adx > 30 ? 2.5 : ind.adx > 20 ? 2.0 : 1.5;

  const goldenL  = ind.prevSwingLow > 0 && ind.swingHigh > ind.prevSwingLow
    ? ind.swingHigh - 0.618 * (ind.swingHigh - ind.prevSwingLow) : 0;
  const goldenS  = ind.prevSwingHigh > 0 && ind.swingLow < ind.prevSwingHigh
    ? ind.swingLow + 0.618 * (ind.prevSwingHigh - ind.swingLow) : 0;
  const impulseL = ind.swingHigh > 0 && ind.prevSwingLow > 0 && ind.swingHigh > ind.prevSwingLow
    ? ind.swingHigh - ind.prevSwingLow : 0;
  const impulseS = ind.swingLow > 0 && ind.prevSwingHigh > 0 && ind.prevSwingHigh > ind.swingLow
    ? ind.prevSwingHigh - ind.swingLow : 0;

  if (isLong) {
    const slC: C[] = [];
    if (ind.bullOBLow  > 0 && ind.bullOBLow   < price)        slC.push({ value: ind.bullOBLow   - atr * 0.1, score: 6 });
    if (ind.swingLow   > 0 && ind.swingLow    < price)        slC.push({ value: ind.swingLow    - atr * 0.3, score: 5 });
    if (goldenL        > 0 && goldenL          < price)        slC.push({ value: goldenL         - atr * 0.1, score: 4 });
    slC.push({ value: price - atr * atrMult, score: 3 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow < price)     slC.push({ value: ind.valueAreaLow, score: 2 });
    if (ind.bollDn     > 0 && ind.bollDn      < price)        slC.push({ value: ind.bollDn,   score: 2 });
    if (ind.ema21      > 0 && ind.ema21       < price * 0.99) slC.push({ value: ind.ema21,    score: ind.adx > 15 ? 2 : 1 });
    if (ind.fvgBullBot > 0 && ind.fvgBullBot  < price)        slC.push({ value: ind.fvgBullBot  - atr * 0.1, score: 5 });
    if (ind.bosSupport > 0 && ind.bosSupport  < price)        slC.push({ value: ind.bosSupport  - atr * 0.1, score: 4 });
    if (ind.vwap20     > 0 && ind.vwap20      < price * 0.99) slC.push({ value: ind.vwap20      - atr * 0.05, score: 3 });
    clust(slC, price, 0.005, 2);
    const hf  = price * 0.93, maxSL = price - atr * 0.2;
    const vsl = slC.filter(c => c.value >= hf && c.value <= maxSL);
    const sl  = Math.max(vsl.length > 0 ? vsl.sort((a, b) => b.score - a.score || b.value - a.value)[0].value : Math.max(price - atr * atrMult, hf), hf);
    const risk = price - sl;
    const minTP = price + risk * 1.5, idealTP = price + risk * targetRR;
    const tpC: C[] = [];
    if (ind.liqHigh      > 0 && ind.liqHigh      >= minTP) tpC.push({ value: ind.liqHigh * 0.998,    score: 6 });
    if (ind.swingHigh    > 0 && ind.swingHigh    >= minTP) tpC.push({ value: ind.swingHigh,           score: 5 });
    if (impulseL > 0 && ind.swingHigh > 0) {
      const f1618 = ind.swingHigh + 0.618 * impulseL;
      const f1272 = ind.swingHigh + 0.272 * impulseL;
      if (f1618 >= minTP) tpC.push({ value: f1618, score: 5 });
      if (f1272 >= minTP) tpC.push({ value: f1272, score: 3 });
    }
    if (ind.bearOBLow    > 0 && ind.bearOBLow    >= minTP) tpC.push({ value: ind.bearOBLow,          score: 4 });
    if (ind.prevSwingHigh > 0 && ind.prevSwingHigh >= minTP) tpC.push({ value: ind.prevSwingHigh,     score: 4 });
    const fr1618 = price + risk * 1.618, fr1272 = price + risk * 1.272;
    if (fr1618 >= minTP) tpC.push({ value: fr1618, score: 4 });
    if (fr1272 >= minTP) tpC.push({ value: fr1272, score: 3 });
    if (ind.poc          > price && ind.poc       >= minTP) tpC.push({ value: ind.poc,                score: 3 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh >= minTP) tpC.push({ value: ind.valueAreaHigh,    score: 3 });
    if (ind.bollUp       > 0 && ind.bollUp       >= minTP) tpC.push({ value: ind.bollUp,             score: 2 });
    if (idealTP > minTP) tpC.push({ value: idealTP, score: 2 });
    if (ind.fvgBearBot   > 0 && ind.fvgBearBot   >= minTP) tpC.push({ value: ind.fvgBearBot,         score: 6 });
    if (ind.fibConvAbove > 0 && ind.fibConvAbove >= minTP) tpC.push({ value: ind.fibConvAbove,       score: 5 });
    if (ind.vwap20       > 0 && ind.vwap20       >= minTP) tpC.push({ value: ind.vwap20,             score: 4 });
    clust(tpC, price, 0.008, 3);
    const tp = Math.max(tpC.length > 0 ? tpC.sort((a, b) => b.score - a.score || a.value - b.value)[0].value : price + risk * 2.0, minTP);
    return { tp, sl };
  } else {
    const slC: C[] = [];
    if (ind.bearOBHigh > 0 && ind.bearOBHigh   > price)       slC.push({ value: ind.bearOBHigh  + atr * 0.1, score: 6 });
    if (ind.swingHigh  > 0 && ind.swingHigh    > price)       slC.push({ value: ind.swingHigh   + atr * 0.3, score: 5 });
    if (goldenS        > 0 && goldenS           > price)       slC.push({ value: goldenS         + atr * 0.1, score: 4 });
    slC.push({ value: price + atr * atrMult, score: 3 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh > price)   slC.push({ value: ind.valueAreaHigh, score: 2 });
    if (ind.bollUp     > 0 && ind.bollUp       > price)       slC.push({ value: ind.bollUp,   score: 2 });
    if (ind.ema21      > 0 && ind.ema21        > price * 1.01) slC.push({ value: ind.ema21,    score: ind.adx > 15 ? 2 : 1 });
    if (ind.fvgBearTop > 0 && ind.fvgBearTop   > price)       slC.push({ value: ind.fvgBearTop   + atr * 0.1, score: 5 });
    if (ind.bosResistance > 0 && ind.bosResistance > price)   slC.push({ value: ind.bosResistance + atr * 0.1, score: 4 });
    if (ind.vwap20     > 0 && ind.vwap20       > price * 1.01) slC.push({ value: ind.vwap20      + atr * 0.05, score: 3 });
    clust(slC, price, 0.005, 2);
    const hc  = price * 1.07, minSL = price + atr * 0.2;
    const vsl = slC.filter(c => c.value >= minSL && c.value <= hc);
    const sl  = Math.min(vsl.length > 0 ? vsl.sort((a, b) => b.score - a.score || a.value - b.value)[0].value : Math.min(price + atr * atrMult, hc), hc);
    const risk = sl - price;
    const minTP = price - risk * 1.5, idealTP = price - risk * targetRR;
    const tpC: C[] = [];
    if (ind.liqLow      > 0 && ind.liqLow      <= minTP) tpC.push({ value: ind.liqLow * 1.002,       score: 6 });
    if (ind.swingLow    > 0 && ind.swingLow    <= minTP) tpC.push({ value: ind.swingLow,             score: 5 });
    if (impulseS > 0 && ind.swingLow > 0) {
      const f1618 = ind.swingLow - 0.618 * impulseS;
      const f1272 = ind.swingLow - 0.272 * impulseS;
      if (f1618 <= minTP) tpC.push({ value: f1618, score: 5 });
      if (f1272 <= minTP) tpC.push({ value: f1272, score: 3 });
    }
    if (ind.bullOBHigh  > 0 && ind.bullOBHigh  <= minTP) tpC.push({ value: ind.bullOBHigh,           score: 4 });
    if (ind.prevSwingLow > 0 && ind.prevSwingLow <= minTP) tpC.push({ value: ind.prevSwingLow,        score: 4 });
    const fr1618 = price - risk * 1.618, fr1272 = price - risk * 1.272;
    if (fr1618 <= minTP) tpC.push({ value: fr1618, score: 4 });
    if (fr1272 <= minTP) tpC.push({ value: fr1272, score: 3 });
    if (ind.poc > 0 && ind.poc < price && ind.poc <= minTP) tpC.push({ value: ind.poc,               score: 3 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow <= minTP) tpC.push({ value: ind.valueAreaLow,       score: 3 });
    if (ind.bollDn      > 0 && ind.bollDn      <= minTP) tpC.push({ value: ind.bollDn,               score: 2 });
    if (idealTP < minTP) tpC.push({ value: idealTP, score: 2 });
    if (ind.fvgBullTop  > 0 && ind.fvgBullTop  <= minTP) tpC.push({ value: ind.fvgBullTop,           score: 6 });
    if (ind.fibConvBelow > 0 && ind.fibConvBelow <= minTP) tpC.push({ value: ind.fibConvBelow,       score: 5 });
    if (ind.vwap20      > 0 && ind.vwap20      <= minTP) tpC.push({ value: ind.vwap20,               score: 4 });
    clust(tpC, price, 0.008, 3);
    const tp = Math.min(tpC.length > 0 ? tpC.sort((a, b) => b.score - a.score || b.value - a.value)[0].value : price - risk * 2.0, minTP);
    return { tp, sl };
  }
}

// ─── V5 ─ + SFP + CVD + CHoCH 三重確認 ──────────────────────────────────────

export function calcTPSL_V5(price: number, isLong: boolean, ind: TechnicalIndicators): TPSL {
  const bRange   = Math.max(ind.bollUp - ind.bollDn, price * 0.02);
  const atr      = ind.atr14 > 0 ? ind.atr14 : bRange / 4;
  const baseAtrM = ind.bollSqueezing ? 1.0 : ind.adx > 35 ? 1.5 : ind.adx > 25 ? 1.8 : ind.adx > 15 ? 2.2 : 2.5;
  const baseRR   = ind.adx > 30 ? 2.5 : ind.adx > 20 ? 2.0 : 1.5;

  const longConf  = (ind.sfpBull || ind.cvdBullDiv) && ind.chochBull;
  const shortConf = (ind.sfpBear || ind.cvdBearDiv) && ind.chochBear;
  const longPart  = ind.sfpBull || ind.cvdBullDiv || ind.chochBull;
  const shortPart = ind.sfpBear || ind.cvdBearDiv || ind.chochBear;

  const atrMult  = isLong
    ? (longConf  ? baseAtrM * 0.85 : longPart  ? baseAtrM * 0.92 : baseAtrM)
    : (shortConf ? baseAtrM * 0.85 : shortPart ? baseAtrM * 0.92 : baseAtrM);
  const targetRR = isLong
    ? (longConf  ? baseRR + 0.5 : longPart  ? baseRR + 0.2 : baseRR)
    : (shortConf ? baseRR + 0.5 : shortPart ? baseRR + 0.2 : baseRR);

  const goldenL  = ind.prevSwingLow > 0 && ind.swingHigh > ind.prevSwingLow
    ? ind.swingHigh - 0.618 * (ind.swingHigh - ind.prevSwingLow) : 0;
  const goldenS  = ind.prevSwingHigh > 0 && ind.swingLow < ind.prevSwingHigh
    ? ind.swingLow + 0.618 * (ind.prevSwingHigh - ind.swingLow) : 0;
  const impulseL = ind.swingHigh > 0 && ind.prevSwingLow > 0 && ind.swingHigh > ind.prevSwingLow
    ? ind.swingHigh - ind.prevSwingLow : 0;
  const impulseS = ind.swingLow > 0 && ind.prevSwingHigh > 0 && ind.prevSwingHigh > ind.swingLow
    ? ind.prevSwingHigh - ind.swingLow : 0;

  if (isLong) {
    const slC: C[] = [];
    if (ind.bullOBLow  > 0 && ind.bullOBLow   < price)        slC.push({ value: ind.bullOBLow   - atr * 0.1, score: 6 });
    if (ind.swingLow   > 0 && ind.swingLow    < price)        slC.push({ value: ind.swingLow    - atr * 0.3, score: 5 });
    if (goldenL        > 0 && goldenL          < price)        slC.push({ value: goldenL         - atr * 0.1, score: 4 });
    slC.push({ value: price - atr * atrMult, score: 3 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow < price)     slC.push({ value: ind.valueAreaLow, score: 2 });
    if (ind.bollDn     > 0 && ind.bollDn      < price)        slC.push({ value: ind.bollDn,   score: 2 });
    if (ind.ema21      > 0 && ind.ema21       < price * 0.99) slC.push({ value: ind.ema21,    score: ind.adx > 15 ? 2 : 1 });
    if (ind.fvgBullBot > 0 && ind.fvgBullBot  < price)        slC.push({ value: ind.fvgBullBot  - atr * 0.1, score: 5 });
    if (ind.bosSupport > 0 && ind.bosSupport  < price)        slC.push({ value: ind.bosSupport  - atr * 0.1, score: 4 });
    if (ind.vwap20     > 0 && ind.vwap20      < price * 0.99) slC.push({ value: ind.vwap20      - atr * 0.05, score: 3 });
    if (ind.sfpBull && ind.swingLow > 0 && ind.swingLow < price) slC.push({ value: ind.swingLow - atr * 0.15, score: 7 });
    if (longConf) slC.forEach(c => { c.score += 2; });
    else if (longPart) slC.forEach(c => { c.score += 1; });
    clust(slC, price, 0.005, 2);
    const hf  = price * 0.93, maxSL = price - atr * 0.2;
    const vsl = slC.filter(c => c.value >= hf && c.value <= maxSL);
    const sl  = Math.max(vsl.length > 0 ? vsl.sort((a, b) => b.score - a.score || b.value - a.value)[0].value : Math.max(price - atr * atrMult, hf), hf);
    const risk = price - sl;
    const minTP = price + risk * 1.5, idealTP = price + risk * targetRR;
    const tpC: C[] = [];
    if (ind.liqHigh      > 0 && ind.liqHigh      >= minTP) tpC.push({ value: ind.liqHigh * 0.998,    score: 6 });
    if (ind.swingHigh    > 0 && ind.swingHigh    >= minTP) tpC.push({ value: ind.swingHigh,           score: 5 });
    if (impulseL > 0 && ind.swingHigh > 0) {
      const f1618 = ind.swingHigh + 0.618 * impulseL;
      const f1272 = ind.swingHigh + 0.272 * impulseL;
      if (f1618 >= minTP) tpC.push({ value: f1618, score: 5 });
      if (f1272 >= minTP) tpC.push({ value: f1272, score: 3 });
    }
    if (ind.bearOBLow    > 0 && ind.bearOBLow    >= minTP) tpC.push({ value: ind.bearOBLow,          score: 4 });
    if (ind.prevSwingHigh > 0 && ind.prevSwingHigh >= minTP) tpC.push({ value: ind.prevSwingHigh,     score: 4 });
    const fr1618 = price + risk * 1.618, fr1272 = price + risk * 1.272;
    if (fr1618 >= minTP) tpC.push({ value: fr1618, score: 4 });
    if (fr1272 >= minTP) tpC.push({ value: fr1272, score: 3 });
    if (ind.poc          > price && ind.poc       >= minTP) tpC.push({ value: ind.poc,                score: 3 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh >= minTP) tpC.push({ value: ind.valueAreaHigh,    score: 3 });
    if (ind.bollUp       > 0 && ind.bollUp       >= minTP) tpC.push({ value: ind.bollUp,             score: 2 });
    if (idealTP > minTP) tpC.push({ value: idealTP, score: 2 });
    if (ind.fvgBearBot   > 0 && ind.fvgBearBot   >= minTP) tpC.push({ value: ind.fvgBearBot,         score: 6 });
    if (ind.fibConvAbove > 0 && ind.fibConvAbove >= minTP) tpC.push({ value: ind.fibConvAbove,       score: 5 });
    if (ind.vwap20       > 0 && ind.vwap20       >= minTP) tpC.push({ value: ind.vwap20,             score: 4 });
    if (ind.sfpBull && ind.liqHigh > 0 && ind.liqHigh >= minTP) tpC.push({ value: ind.liqHigh * 0.996, score: 8 });
    if (longConf && ind.fibConvAbove > 0 && ind.fibConvAbove >= minTP) tpC.push({ value: ind.fibConvAbove, score: 9 });
    clust(tpC, price, 0.008, 3);
    const tp = Math.max(tpC.length > 0 ? tpC.sort((a, b) => b.score - a.score || a.value - b.value)[0].value : price + risk * 2.0, minTP);
    return { tp, sl };
  } else {
    const slC: C[] = [];
    if (ind.bearOBHigh > 0 && ind.bearOBHigh   > price)       slC.push({ value: ind.bearOBHigh  + atr * 0.1, score: 6 });
    if (ind.swingHigh  > 0 && ind.swingHigh    > price)       slC.push({ value: ind.swingHigh   + atr * 0.3, score: 5 });
    if (goldenS        > 0 && goldenS           > price)       slC.push({ value: goldenS         + atr * 0.1, score: 4 });
    slC.push({ value: price + atr * atrMult, score: 3 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh > price)   slC.push({ value: ind.valueAreaHigh, score: 2 });
    if (ind.bollUp     > 0 && ind.bollUp       > price)       slC.push({ value: ind.bollUp,   score: 2 });
    if (ind.ema21      > 0 && ind.ema21        > price * 1.01) slC.push({ value: ind.ema21,    score: ind.adx > 15 ? 2 : 1 });
    if (ind.fvgBearTop > 0 && ind.fvgBearTop   > price)       slC.push({ value: ind.fvgBearTop  + atr * 0.1, score: 5 });
    if (ind.bosResistance > 0 && ind.bosResistance > price)   slC.push({ value: ind.bosResistance + atr * 0.1, score: 4 });
    if (ind.vwap20     > 0 && ind.vwap20       > price * 1.01) slC.push({ value: ind.vwap20      + atr * 0.05, score: 3 });
    if (ind.sfpBear && ind.swingHigh > 0 && ind.swingHigh > price) slC.push({ value: ind.swingHigh + atr * 0.15, score: 7 });
    if (shortConf) slC.forEach(c => { c.score += 2; });
    else if (shortPart) slC.forEach(c => { c.score += 1; });
    clust(slC, price, 0.005, 2);
    const hc  = price * 1.07, minSL = price + atr * 0.2;
    const vsl = slC.filter(c => c.value >= minSL && c.value <= hc);
    const sl  = Math.min(vsl.length > 0 ? vsl.sort((a, b) => b.score - a.score || a.value - b.value)[0].value : Math.min(price + atr * atrMult, hc), hc);
    const risk = sl - price;
    const minTP = price - risk * 1.5, idealTP = price - risk * targetRR;
    const tpC: C[] = [];
    if (ind.liqLow      > 0 && ind.liqLow      <= minTP) tpC.push({ value: ind.liqLow * 1.002,       score: 6 });
    if (ind.swingLow    > 0 && ind.swingLow    <= minTP) tpC.push({ value: ind.swingLow,             score: 5 });
    if (impulseS > 0 && ind.swingLow > 0) {
      const f1618 = ind.swingLow - 0.618 * impulseS;
      const f1272 = ind.swingLow - 0.272 * impulseS;
      if (f1618 <= minTP) tpC.push({ value: f1618, score: 5 });
      if (f1272 <= minTP) tpC.push({ value: f1272, score: 3 });
    }
    if (ind.bullOBHigh  > 0 && ind.bullOBHigh  <= minTP) tpC.push({ value: ind.bullOBHigh,           score: 4 });
    if (ind.prevSwingLow > 0 && ind.prevSwingLow <= minTP) tpC.push({ value: ind.prevSwingLow,        score: 4 });
    const fr1618 = price - risk * 1.618, fr1272 = price - risk * 1.272;
    if (fr1618 <= minTP) tpC.push({ value: fr1618, score: 4 });
    if (fr1272 <= minTP) tpC.push({ value: fr1272, score: 3 });
    if (ind.poc > 0 && ind.poc < price && ind.poc <= minTP) tpC.push({ value: ind.poc,               score: 3 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow <= minTP) tpC.push({ value: ind.valueAreaLow,       score: 3 });
    if (ind.bollDn      > 0 && ind.bollDn      <= minTP) tpC.push({ value: ind.bollDn,               score: 2 });
    if (idealTP < minTP) tpC.push({ value: idealTP, score: 2 });
    if (ind.fvgBullTop  > 0 && ind.fvgBullTop  <= minTP) tpC.push({ value: ind.fvgBullTop,           score: 6 });
    if (ind.fibConvBelow > 0 && ind.fibConvBelow <= minTP) tpC.push({ value: ind.fibConvBelow,       score: 5 });
    if (ind.vwap20      > 0 && ind.vwap20      <= minTP) tpC.push({ value: ind.vwap20,               score: 4 });
    if (ind.sfpBear && ind.liqLow > 0 && ind.liqLow <= minTP) tpC.push({ value: ind.liqLow * 1.004, score: 8 });
    if (shortConf && ind.fibConvBelow > 0 && ind.fibConvBelow <= minTP) tpC.push({ value: ind.fibConvBelow, score: 9 });
    clust(tpC, price, 0.008, 3);
    const tp = Math.min(tpC.length > 0 ? tpC.sort((a, b) => b.score - a.score || b.value - a.value)[0].value : price - risk * 2.0, minTP);
    return { tp, sl };
  }
}

// ─── V6 ─ V2 止損紀律 + V5 三重確認 + 無確認跳單（返回 null 表示跳過）────────

export function calcTPSL_V6(price: number, isLong: boolean, ind: TechnicalIndicators): TPSL | null {
  const longConf  = (ind.sfpBull || ind.cvdBullDiv) && ind.chochBull;
  const shortConf = (ind.sfpBear || ind.cvdBearDiv) && ind.chochBear;
  const longPart  = ind.sfpBull || ind.cvdBullDiv || ind.chochBull;
  const shortPart = ind.sfpBear || ind.cvdBearDiv || ind.chochBear;

  const confirmed = isLong ? longConf  : shortConf;
  const partial   = isLong ? longPart  : shortPart;
  if (!confirmed && !partial) return null; // 無確認 → 跳單

  const bRange   = Math.max(ind.bollUp - ind.bollDn, price * 0.02);
  const atr      = ind.atr14 > 0 ? ind.atr14 : bRange / 4;
  const baseAtrM = ind.bollSqueezing ? 1.0 : ind.adx > 35 ? 1.5 : ind.adx > 25 ? 1.8 : ind.adx > 15 ? 2.2 : 2.5;
  const atrMult  = confirmed ? baseAtrM * 0.85 : baseAtrM * 0.95;
  const baseRR   = ind.adx > 30 ? 2.5 : ind.adx > 20 ? 2.0 : 1.5;
  const targetRR = confirmed ? baseRR + 0.5 : baseRR;

  const goldenL  = ind.prevSwingLow > 0 && ind.swingHigh > ind.prevSwingLow
    ? ind.swingHigh - 0.618 * (ind.swingHigh - ind.prevSwingLow) : 0;
  const goldenS  = ind.prevSwingHigh > 0 && ind.swingLow < ind.prevSwingHigh
    ? ind.swingLow + 0.618 * (ind.prevSwingHigh - ind.swingLow) : 0;

  if (isLong) {
    const slC: C[] = [];
    if (ind.swingLow   > 0 && ind.swingLow    < price)        slC.push({ value: ind.swingLow    - atr * 0.3, score: 6 });
    if (ind.bullOBLow  > 0 && ind.bullOBLow   < price)        slC.push({ value: ind.bullOBLow   - atr * 0.1, score: 5 });
    if (goldenL        > 0 && goldenL          < price)        slC.push({ value: goldenL         - atr * 0.1, score: 4 });
    slC.push({ value: price - atr * atrMult, score: 3 });
    if (ind.fvgBullBot > 0 && ind.fvgBullBot  < price)        slC.push({ value: ind.fvgBullBot  - atr * 0.1, score: 5 });
    if (ind.bosSupport > 0 && ind.bosSupport  < price)        slC.push({ value: ind.bosSupport  - atr * 0.1, score: 4 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow < price)     slC.push({ value: ind.valueAreaLow, score: 2 });
    if (ind.bollDn     > 0 && ind.bollDn      < price)        slC.push({ value: ind.bollDn,   score: 2 });
    if (ind.sfpBull && ind.swingLow > 0 && ind.swingLow < price) slC.push({ value: ind.swingLow - atr * 0.15, score: 8 });
    clust(slC, price, 0.005, 2);
    const hardFloor = price * 0.95, maxSL = price - atr * 0.2;
    const vsl = slC.filter(c => c.value >= hardFloor && c.value <= maxSL);
    const sl  = Math.max(vsl.length > 0 ? vsl.sort((a, b) => b.score - a.score || b.value - a.value)[0].value : Math.max(price - atr * atrMult, hardFloor), hardFloor);
    const risk = price - sl;
    const minTP = price + risk * 1.5, idealTP = price + risk * targetRR;
    const tpC: C[] = [];
    if (ind.swingHigh    > 0 && ind.swingHigh    >= minTP) tpC.push({ value: ind.swingHigh,          score: 5 });
    if (ind.prevSwingHigh > 0 && ind.prevSwingHigh >= minTP) tpC.push({ value: ind.prevSwingHigh,     score: 4 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh >= minTP) tpC.push({ value: ind.valueAreaHigh,    score: 3 });
    if (ind.bollUp       > 0 && ind.bollUp       >= minTP) tpC.push({ value: ind.bollUp,             score: 2 });
    tpC.push({ value: price + risk * 1.618, score: 3 });
    if (idealTP > minTP) tpC.push({ value: idealTP, score: 2 });
    if (confirmed) {
      if (ind.liqHigh     > 0 && ind.liqHigh     >= minTP) tpC.push({ value: ind.liqHigh * 0.998,   score: 9 });
      if (ind.fvgBearBot  > 0 && ind.fvgBearBot  >= minTP) tpC.push({ value: ind.fvgBearBot,        score: 7 });
      if (ind.fibConvAbove > 0 && ind.fibConvAbove >= minTP) tpC.push({ value: ind.fibConvAbove,    score: 8 });
      if (ind.sfpBull && ind.liqHigh > 0 && ind.liqHigh >= minTP) tpC.push({ value: ind.liqHigh * 0.996, score: 10 });
      const impL = ind.swingHigh > 0 && ind.prevSwingLow > 0 ? ind.swingHigh - ind.prevSwingLow : 0;
      if (impL > 0) {
        const f1618 = ind.swingHigh + 0.618 * impL;
        if (f1618 >= minTP) tpC.push({ value: f1618, score: 6 });
      }
    } else {
      if (ind.fvgBearBot > 0 && ind.fvgBearBot >= minTP) tpC.push({ value: ind.fvgBearBot, score: 5 });
      if (ind.vwap20     > 0 && ind.vwap20     >= minTP) tpC.push({ value: ind.vwap20,     score: 4 });
    }
    clust(tpC, price, 0.008, 3);
    const tp = Math.max(tpC.length > 0 ? tpC.sort((a, b) => b.score - a.score || a.value - b.value)[0].value : price + risk * 2.0, minTP);
    return { tp, sl };
  } else {
    const slC: C[] = [];
    if (ind.swingHigh  > 0 && ind.swingHigh    > price)       slC.push({ value: ind.swingHigh   + atr * 0.3, score: 6 });
    if (ind.bearOBHigh > 0 && ind.bearOBHigh   > price)       slC.push({ value: ind.bearOBHigh  + atr * 0.1, score: 5 });
    if (goldenS        > 0 && goldenS           > price)       slC.push({ value: goldenS         + atr * 0.1, score: 4 });
    slC.push({ value: price + atr * atrMult, score: 3 });
    if (ind.fvgBearTop > 0 && ind.fvgBearTop   > price)       slC.push({ value: ind.fvgBearTop  + atr * 0.1, score: 5 });
    if (ind.bosResistance > 0 && ind.bosResistance > price)   slC.push({ value: ind.bosResistance + atr * 0.1, score: 4 });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh > price)   slC.push({ value: ind.valueAreaHigh, score: 2 });
    if (ind.bollUp     > 0 && ind.bollUp       > price)       slC.push({ value: ind.bollUp,   score: 2 });
    if (ind.sfpBear && ind.swingHigh > 0 && ind.swingHigh > price) slC.push({ value: ind.swingHigh + atr * 0.15, score: 8 });
    clust(slC, price, 0.005, 2);
    const hardCeil = price * 1.05, minSL = price + atr * 0.2;
    const vsl = slC.filter(c => c.value >= minSL && c.value <= hardCeil);
    const sl  = Math.min(vsl.length > 0 ? vsl.sort((a, b) => b.score - a.score || a.value - b.value)[0].value : Math.min(price + atr * atrMult, hardCeil), hardCeil);
    const risk = sl - price;
    const minTP = price - risk * 1.5, idealTP = price - risk * targetRR;
    const tpC: C[] = [];
    if (ind.swingLow    > 0 && ind.swingLow    <= minTP) tpC.push({ value: ind.swingLow,            score: 5 });
    if (ind.prevSwingLow > 0 && ind.prevSwingLow <= minTP) tpC.push({ value: ind.prevSwingLow,       score: 4 });
    if (ind.valueAreaLow > 0 && ind.valueAreaLow <= minTP) tpC.push({ value: ind.valueAreaLow,      score: 3 });
    if (ind.bollDn      > 0 && ind.bollDn      <= minTP) tpC.push({ value: ind.bollDn,              score: 2 });
    tpC.push({ value: price - risk * 1.618, score: 3 });
    if (idealTP < minTP) tpC.push({ value: idealTP, score: 2 });
    if (confirmed) {
      if (ind.liqLow      > 0 && ind.liqLow      <= minTP) tpC.push({ value: ind.liqLow * 1.002,   score: 9 });
      if (ind.fvgBullTop  > 0 && ind.fvgBullTop  <= minTP) tpC.push({ value: ind.fvgBullTop,        score: 7 });
      if (ind.fibConvBelow > 0 && ind.fibConvBelow <= minTP) tpC.push({ value: ind.fibConvBelow,    score: 8 });
      if (ind.sfpBear && ind.liqLow > 0 && ind.liqLow <= minTP) tpC.push({ value: ind.liqLow * 1.004, score: 10 });
      const impS = ind.prevSwingHigh > 0 && ind.swingLow > 0 ? ind.prevSwingHigh - ind.swingLow : 0;
      if (impS > 0) {
        const f1618 = ind.swingLow - 0.618 * impS;
        if (f1618 <= minTP) tpC.push({ value: f1618, score: 6 });
      }
    } else {
      if (ind.fvgBullTop > 0 && ind.fvgBullTop <= minTP) tpC.push({ value: ind.fvgBullTop, score: 5 });
      if (ind.vwap20     > 0 && ind.vwap20     <= minTP) tpC.push({ value: ind.vwap20,     score: 4 });
    }
    clust(tpC, price, 0.008, 3);
    const tp = Math.min(tpC.length > 0 ? tpC.sort((a, b) => b.score - a.score || b.value - a.value)[0].value : price - risk * 2.0, minTP);
    return { tp, sl };
  }
}

// ─── 統一入口 ────────────────────────────────────────────────────────────────

/**
 * 根據退出模式計算 TP/SL
 * @returns TPSL 或 null（只有 V6/V7 無確認時返回 null，代表跳過本次入場）
 */
export function calcTPSL(
  mode: ExitMode,
  price: number,
  isLong: boolean,
  ind: TechnicalIndicators,
): TPSL | null {
  switch (mode) {
    case 'v1': return calcTPSL_V1(price, isLong, ind);
    case 'v2': return calcTPSL_V2(price, isLong, ind);
    case 'v3': return calcTPSL_V3(price, isLong, ind);
    case 'v4': return calcTPSL_V4(price, isLong, ind);
    case 'v5': return calcTPSL_V5(price, isLong, ind);
    case 'v6':
    case 'v7': return calcTPSL_V6(price, isLong, ind);
    default:   return calcTPSL_V6(price, isLong, ind);
  }
}

/** 描述各退出模式的文字 */
export const EXIT_MODE_LABELS: Record<ExitMode, string> = {
  v1: 'V1 Bollinger 基礎',
  v2: 'V2 ATR 結構止損',
  v3: 'V3 多因子評分',
  v4: 'V4 機構錨點層',
  v5: 'V5 三重確認',
  v6: 'V6 確認+跳單過濾',
  v7: 'V7 分批止盈+移動止損',
};
