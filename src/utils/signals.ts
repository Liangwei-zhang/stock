/**
 * signals.ts — 高胜率买卖信号检测（完整重写）
 *
 * 研究依据：
 * ① RSI 背离（Divergence）是所有指标中短期反转预测率最高的先行信号
 * ② EMA9/EMA21 交叉 + 成交量放大：趋势确认的主流专业用法
 * ③ Volume Profile POC：机构级别的支撑/阻力判断
 * ④ ADX > 25 作为趋势强度门槛：过滤低质量"假突破"
 * ⑤ 布林带 Squeeze：波动率压缩后的爆发方向确认
 *
 * 信号层级（提高阈值、宁缺毋滥）：
 *   高级 ≥ 75 且 ≥ 4 个独立原因
 *   中级 ≥ 55 且 ≥ 3 个独立原因
 *   低级 ≥ 35 且 ≥ 2 个独立原因
 */

import { StockData, SignalResult } from '../types';
import { calculateAllIndicators, getPreviousIndicators, getAverageVolume } from './indicators';

// ─── 趋势状态 ────────────────────────────────────────────────────────────────

type TrendState = 'bull' | 'bear' | 'sideways';

function getTrendState(
  ind: ReturnType<typeof calculateAllIndicators>,
  price: number,
): TrendState {
  // 使用 EMA9/21 而非 SMA5/10（更灵敏，减少滞后）
  const emaAlignedBull = ind.ema9 > ind.ema21;
  const emaAlignedBear = ind.ema9 < ind.ema21;

  // MA20 作为中期趋势参考
  const aboveMa20  = ind.ma20 > 0 && price > ind.ma20;
  const belowMa20  = ind.ma20 > 0 && price < ind.ma20;

  // ADX ≥ 20：有趋势强度
  const hasTrend = ind.adx >= 20;

  // 注意：當 hasTrend=false（ADX < 20，橫盤市場）時條件為 true，
  // 表示在趨勢強度不足時僅以 EMA 方向作為分類依據。
  // 這是刻意設計：ADX 低時 DI± 噪音大，不適合做為過濾條件。
  if (emaAlignedBull && aboveMa20 && (hasTrend ? ind.diPlus > ind.diMinus : true)) return 'bull';
  if (emaAlignedBear && belowMa20 && (hasTrend ? ind.diMinus > ind.diPlus : true)) return 'bear';
  return 'sideways';
}

// ═══════════════════════════════════════════════════════════════
//  买入信号
// ═══════════════════════════════════════════════════════════════

export function detectBuySignal(data: StockData[], symbol = ''): SignalResult {
  if (data.length < 60) return { signal: false, level: null, score: 0, reasons: [] };

  const latest  = calculateAllIndicators(data, symbol);
  const prev    = getPreviousIndicators(data, 1, symbol);
  const prev2   = getPreviousIndicators(data, 2, symbol);
  const cur     = data[data.length - 1];
  const pre1    = data[data.length - 2];
  const avgVol  = getAverageVolume(data, 20);
  const trend   = getTrendState(latest, cur.close);

  // ══════════════════════════════════════
  //  硬性门槛（任一触发 → 直接拒绝）
  // ══════════════════════════════════════

  // 空头趋势中禁止买入
  if (trend === 'bear') return { signal: false, level: null, score: 0, reasons: [] };

  // RSI9 极度超买（>85）不追高
  if (latest.rsi9 > 85) return { signal: false, level: null, score: 0, reasons: [] };

  // ADX 极弱（<12）且无背离：市场完全无方向，信号不可信
  if (latest.adx < 12 && !latest.rsiBullDiv) return { signal: false, level: null, score: 0, reasons: [] };

  let score = 0;
  const reasons: string[] = [];

  // ══════════════════════════════════════
  //  A. RSI 背离（最高 30 分）— 先行指标，权重最高
  //     研究显示背离信号的短期反转准确率 >65%
  // ══════════════════════════════════════

  if (latest.rsiBullDiv) {
    score += 30;
    reasons.push('RSI 底背离（先行反转信号）');

    // 背离 + RSI9 同步从超卖区抬头：双重确认
    if (latest.rsi9 < 38 && latest.rsi9 > prev.rsi9) {
      score += 10;
      reasons.push('RSI9 超卖区反弹确认');
    }
  } else if (latest.rsi14 < 30 && latest.rsi14 > prev.rsi14 && latest.rsi9 > prev.rsi9) {
    // 无背离但 RSI14 从超卖区回升，仍有参考价值
    score += 18;
    reasons.push('RSI14 超卖区抬头回升');
  } else if (latest.rsi14 >= 38 && latest.rsi14 <= 58 && latest.rsi14 > prev.rsi14 && prev.rsi14 > prev2.rsi14) {
    // 健康动能区间连续上行
    score += 12;
    reasons.push('RSI 动能健康区间上行');
  }

  // ══════════════════════════════════════
  //  B. EMA9/EMA21 交叉（最高 28 分）
  //     主流趋势交易系统首选，比 MA 减少滞后约 30%
  // ══════════════════════════════════════

  const emaCrossUp = latest.ema9 > latest.ema21 && prev.ema9 <= prev.ema21;

  if (emaCrossUp) {
    score += 22;
    reasons.push('EMA9 上穿 EMA21（趋势金叉）');

    // 金叉时 ADX > 25：有效趋势突破
    if (latest.adx > 25) {
      score += 6;
      reasons.push(`ADX ${latest.adx.toFixed(0)} 确认趋势有效`);
    }
  } else if (latest.ema9 > latest.ema21) {
    // 已处于 EMA 多头状态
    const emaDivergence = (latest.ema9 - latest.ema21) / latest.ema21;
    if (emaDivergence > 0.005 && latest.ema9 > prev.ema9) {
      score += 14;
      reasons.push('EMA 多头排列持续走强');
    }
  }

  // ══════════════════════════════════════
  //  C. Volume Profile — POC 支撑（最高 22 分）
  //     POC 是机构级别的关键支撑/阻力，价格回测往往精确反弹
  // ══════════════════════════════════════

  const price = cur.close;
  const pocDist = latest.poc > 0 ? Math.abs(price - latest.poc) / latest.poc : 1;

  if (pocDist < 0.008 && price >= latest.poc) {
    // 价格精确回踩 POC 且未跌破：极强支撑
    score += 22;
    reasons.push('回踩 POC 支撑（成交量最集中价格区）');
  } else if (pocDist < 0.015 && price >= latest.poc) {
    score += 14;
    reasons.push('接近 POC 支撑位置');
  } else if (latest.valueAreaLow > 0 && price < latest.valueAreaLow * 1.005 && price > latest.valueAreaLow * 0.993) {
    // 价格触及 VAL（价值区下边界）
    score += 16;
    reasons.push('触及价值区下边界（VAL）');
  }

  // ══════════════════════════════════════
  //  D. 布林带 Squeeze 方向确认（最高 20 分）
  //     压缩后放量突破下轨→上方是高概率方向
  // ══════════════════════════════════════

  if (latest.bollSqueezing) {
    // Squeeze 中，价格在中轨下方且 EMA 方向看涨
    if (price > latest.bollMb && pre1.close <= prev.bollMb) {
      score += 20;
      reasons.push('布林带压缩后向上突破中轨');
    } else if (price > latest.bollDn && price < latest.bollMb && latest.ema9 > prev.ema9) {
      score += 12;
      reasons.push('布林带 Squeeze 下轨上方积累');
    }
  } else {
    // 非 Squeeze：传统下轨反弹
    if (latest.bollDn > 0 && pre1.close < prev.bollDn && price > latest.bollDn) {
      score += 14;
      reasons.push('布林下轨强力反弹');
    } else if (price > latest.bollMb && pre1.close <= prev.bollMb) {
      score += 8;
      reasons.push('突破布林中轨');
    }
  }

  // ══════════════════════════════════════
  //  E. 成交量配合（最高 18 分）
  //     上涨无量 = 不可信；放量=机构参与
  // ══════════════════════════════════════

  const volRatio = avgVol > 0 ? cur.volume / avgVol : 0;
  const priceUp  = cur.close > pre1.close;

  if (priceUp && volRatio >= 1.8) {
    score += 18;
    reasons.push(`放量上涨（量比 ${volRatio.toFixed(1)}x）`);
  } else if (priceUp && volRatio >= 1.3) {
    score += 12;
    reasons.push('量价齐升确认');
  } else if (!priceUp && volRatio < 0.75) {
    score += 6;
    reasons.push('缩量回调（卖压减轻）');
  }

  // ══════════════════════════════════════
  //  F. MACD 动量（最高 18 分）
  //     作为辅助确认，不单独触发
  // ══════════════════════════════════════

  const macdCrossUp  = latest.macdDif > latest.macdDea && prev.macdDif <= prev.macdDea;
  const histExpanding = latest.macdHistogram > prev.macdHistogram && prev.macdHistogram > prev2.macdHistogram;

  if (macdCrossUp) {
    score += 16;
    reasons.push('MACD 金叉');
    if (latest.macdDif > 0) { score += 2; }
  } else if (histExpanding && latest.macdHistogram < 0.5) {
    score += 10;
    reasons.push('MACD 柱量能持续积累');
  } else if (latest.macdHistogram > 0 && prev.macdHistogram <= 0) {
    score += 8;
    reasons.push('MACD 柱翻正');
  }

  // ══════════════════════════════════════
  //  G. ADX 趋势强度奖励（+8 分）
  //     ADX > 30：强趋势中顺势信号额外加权
  // ══════════════════════════════════════

  if (latest.adx > 30 && latest.diPlus > latest.diMinus) {
    score += 8;
    reasons.push(`强趋势行情（ADX ${latest.adx.toFixed(0)}）`);
  }

  // ══════════════════════════════════════
  //  H. KDJ 辅助（最高 12 分）
  // ══════════════════════════════════════

  const kdjCrossUp = latest.kdjK > latest.kdjD && prev.kdjK <= prev.kdjD;
  if (kdjCrossUp && latest.kdjK < 40) {
    score += 12;
    reasons.push('KDJ 低位金叉');
  } else if (latest.kdjJ < 5 && latest.kdjK > prev.kdjK) {
    score += 10;
    reasons.push('KDJ J 值极度超卖回升');
  }

  // ══════════════════════════════════════
  //  横盘市场降权（除非有背离信号）
  // ══════════════════════════════════════

  if (trend === 'sideways' && !latest.rsiBullDiv) {
    score = Math.floor(score * 0.75);
  }

  // ══════════════════════════════════════
  //  等级输出
  // ══════════════════════════════════════

  let level: 'high' | 'medium' | 'low' | null = null;
  let signal = false;

  if (score >= 75 && reasons.length >= 4) { level = 'high';   signal = true; }
  else if (score >= 55 && reasons.length >= 3) { level = 'medium'; signal = true; }
  else if (score >= 35 && reasons.length >= 2) { level = 'low';    signal = true; }

  return { signal, level, score, reasons };
}

// ═══════════════════════════════════════════════════════════════
//  卖出信号
// ═══════════════════════════════════════════════════════════════

export function detectSellSignal(data: StockData[], symbol = ''): SignalResult {
  if (data.length < 60) return { signal: false, level: null, score: 0, reasons: [] };

  const latest = calculateAllIndicators(data, symbol);
  const prev   = getPreviousIndicators(data, 1, symbol);
  const prev2  = getPreviousIndicators(data, 2, symbol);
  const cur    = data[data.length - 1];
  const pre1   = data[data.length - 2];
  const avgVol = getAverageVolume(data, 20);
  const trend  = getTrendState(latest, cur.close);

  // ══════════════════════════════════════
  //  硬性门槛
  // ══════════════════════════════════════

  // 多头趋势且价格在 EMA21 之上：不做空
  if (trend === 'bull' && cur.close > latest.ema21 * 1.005) {
    return { signal: false, level: null, score: 0, reasons: [] };
  }

  // RSI9 极度超卖（<15）：不追杀
  if (latest.rsi9 < 15) return { signal: false, level: null, score: 0, reasons: [] };

  // ADX 极弱且无背离
  if (latest.adx < 12 && !latest.rsiBearDiv) return { signal: false, level: null, score: 0, reasons: [] };

  let score = 0;
  const reasons: string[] = [];

  // ══════════════════════════════════════
  //  A. RSI 顶背离（最高 30 分）
  // ══════════════════════════════════════

  if (latest.rsiBearDiv) {
    score += 30;
    reasons.push('RSI 顶背离（先行反转信号）');

    if (latest.rsi9 > 62 && latest.rsi9 < prev.rsi9) {
      score += 10;
      reasons.push('RSI9 超买区回落确认');
    }
  } else if (latest.rsi14 > 70 && latest.rsi14 < prev.rsi14 && latest.rsi9 < prev.rsi9) {
    score += 18;
    reasons.push('RSI14 超买区回落');
  } else if (latest.rsi14 >= 55 && latest.rsi14 <= 72 && latest.rsi14 < prev.rsi14 && prev.rsi14 < prev2.rsi14) {
    score += 12;
    reasons.push('RSI 高位持续下行');
  }

  // ══════════════════════════════════════
  //  B. EMA9/EMA21 死叉（最高 28 分）
  // ══════════════════════════════════════

  const emaCrossDown = latest.ema9 < latest.ema21 && prev.ema9 >= prev.ema21;

  if (emaCrossDown) {
    score += 22;
    reasons.push('EMA9 下穿 EMA21（趋势死叉）');
    if (latest.adx > 25) {
      score += 6;
      reasons.push(`ADX ${latest.adx.toFixed(0)} 确认趋势反转`);
    }
  } else if (latest.ema9 < latest.ema21) {
    const emaDivergence = (latest.ema21 - latest.ema9) / latest.ema21;
    if (emaDivergence > 0.005 && latest.ema9 < prev.ema9) {
      score += 14;
      reasons.push('EMA 空头排列持续走弱');
    }
  }

  // ══════════════════════════════════════
  //  C. Volume Profile — POC 阻力（最高 22 分）
  // ══════════════════════════════════════

  const price   = cur.close;
  const pocDist = latest.poc > 0 ? Math.abs(price - latest.poc) / latest.poc : 1;

  if (pocDist < 0.008 && price <= latest.poc) {
    score += 22;
    reasons.push('反弹至 POC 阻力区遇阻');
  } else if (pocDist < 0.015 && price <= latest.poc) {
    score += 14;
    reasons.push('接近 POC 阻力位置');
  } else if (latest.valueAreaHigh > 0 && price > latest.valueAreaHigh * 0.995 && price < latest.valueAreaHigh * 1.007) {
    score += 16;
    reasons.push('触及价值区上边界（VAH）阻力');
  }

  // ══════════════════════════════════════
  //  D. 布林带 Squeeze 方向（最高 20 分）
  // ══════════════════════════════════════

  if (latest.bollSqueezing) {
    if (price < latest.bollMb && pre1.close >= prev.bollMb) {
      score += 20;
      reasons.push('布林带压缩后向下跌破中轨');
    } else if (price < latest.bollMb && latest.ema9 < prev.ema9) {
      score += 12;
      reasons.push('布林带 Squeeze 中轨下方积累空头');
    }
  } else {
    if (latest.bollUp > 0 && pre1.close > prev.bollUp && price < latest.bollUp) {
      score += 14;
      reasons.push('布林上轨强力回落');
    } else if (price < latest.bollMb && pre1.close >= prev.bollMb) {
      score += 8;
      reasons.push('跌破布林中轨支撑');
    }
  }

  // ══════════════════════════════════════
  //  E. 成交量配合（最高 18 分）
  // ══════════════════════════════════════

  const volRatio  = avgVol > 0 ? cur.volume / avgVol : 0;
  const priceDown = cur.close < pre1.close;

  if (priceDown && volRatio >= 1.8) {
    score += 18;
    reasons.push(`放量下跌（量比 ${volRatio.toFixed(1)}x，主力出逃）`);
  } else if (priceDown && volRatio >= 1.3) {
    score += 12;
    reasons.push('量增价跌');
  } else if (!priceDown && volRatio < 0.7) {
    score += 8;
    reasons.push('缩量反弹（上涨乏力）');
  }

  // ══════════════════════════════════════
  //  F. MACD 动量（最高 18 分）
  // ══════════════════════════════════════

  const macdCrossDown = latest.macdDif < latest.macdDea && prev.macdDif >= prev.macdDea;
  const histExpanding = latest.macdHistogram < prev.macdHistogram && prev.macdHistogram < prev2.macdHistogram;

  if (macdCrossDown) {
    score += 16;
    reasons.push('MACD 死叉');
    if (latest.macdDif < 0) { score += 2; }
  } else if (histExpanding && latest.macdHistogram > -0.5) {
    score += 10;
    reasons.push('MACD 空头动量积累');
  } else if (latest.macdHistogram < 0 && prev.macdHistogram >= 0) {
    score += 8;
    reasons.push('MACD 柱翻负');
  }

  // ══════════════════════════════════════
  //  G. ADX 趋势强度奖励（+8 分）
  // ══════════════════════════════════════

  if (latest.adx > 30 && latest.diMinus > latest.diPlus) {
    score += 8;
    reasons.push(`空头强趋势（ADX ${latest.adx.toFixed(0)}）`);
  }

  // ══════════════════════════════════════
  //  H. KDJ 辅助（最高 12 分）
  // ══════════════════════════════════════

  const kdjCrossDown = latest.kdjK < latest.kdjD && prev.kdjK >= prev.kdjD;
  if (kdjCrossDown && latest.kdjK > 60) {
    score += 12;
    reasons.push('KDJ 高位死叉');
  } else if (latest.kdjJ > 95 && latest.kdjK < prev.kdjK) {
    score += 10;
    reasons.push('KDJ J 值极度超买回落');
  }

  // ══════════════════════════════════════
  //  横盘降权
  // ══════════════════════════════════════

  if (trend === 'sideways' && !latest.rsiBearDiv) {
    score = Math.floor(score * 0.75);
  }

  // ══════════════════════════════════════
  //  等级输出
  // ══════════════════════════════════════

  let level: 'high' | 'medium' | 'low' | null = null;
  let signal = false;

  if (score >= 75 && reasons.length >= 4) { level = 'high';   signal = true; }
  else if (score >= 55 && reasons.length >= 3) { level = 'medium'; signal = true; }
  else if (score >= 35 && reasons.length >= 2) { level = 'low';    signal = true; }

  return { signal, level, score, reasons };
}
