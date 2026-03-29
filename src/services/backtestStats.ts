/**
 * backtestStats.ts — 胜率统计 & 绩效评估引擎
 *
 * 功能：
 *  1. 从已完成交易计算胜率、盈亏比、最大回撤等
 *  2. 按信号来源分解胜率（SFP / CHOCH / FVG / Triple 三重确认）
 *  3. 实时回测：对历史 K 线回放算法，统计信号质量
 *  4. Sharpe Ratio / Calmar Ratio 风险调整收益
 */

import type { IStrategyPlugin } from '../core/types';
import { pluginRegistry } from '../core/plugin-registry';
import { Trade } from './tradingSimulator';
import { StockData } from '../types';
import { calculateATR } from '../utils/fvg';
import { predictTopBottom, setPredictionSymbol } from '../utils/prediction';
import { detectBuySignal, detectSellSignal } from '../utils/signals';

// ─── 输出类型 ─────────────────────────────────────────────────────────────────

export interface TradeStats {
  totalTrades:     number;
  winningTrades:   number;
  losingTrades:    number;
  winRate:         number;   // 0-1
  avgWin:          number;   // 平均盈利金额
  avgLoss:         number;   // 平均亏损金额（正数）
  profitFactor:    number;   // 总盈利 / 总亏损
  expectancy:      number;   // 期望值（每笔交易平均盈亏）
  totalPnL:        number;
  maxDrawdown:     number;   // 最大回撤（0-1）
  sharpeRatio:     number;   // 年化夏普比率（假设无风险利率 4%）
  calmarRatio:     number;   // 年化收益 / 最大回撤
  byExitReason: {
    signal:      { count: number; winRate: number; avgPnL: number };
    stop_loss:   { count: number };
    take_profit: { count: number; avgPnL: number };
    manual:      { count: number };
  };
}

export interface BacktestSignalStats {
  totalSignals:     number;
  buySignals:       number;
  sellSignals:      number;
  predTopSignals:   number;
  predBotSignals:   number;
  tripleConfirmed:  number;  // SFP + CHOCH + FVG 同时触发次数
  highConfidence:   number;  // probability > 0.8 且 score >= 75
  signalAccuracy?: number;   // 需要后续价格数据才能计算，留给回测
}

export interface BacktestResult {
  symbol:       string;
  period:       string;   // e.g. "90 days"
  totalBars:    number;
  signalStats:  BacktestSignalStats;
  tradeStats?:  TradeStats; // 若模拟了交易才填充
  summary:      string;
}

export interface PluginBacktestOptions extends BacktestOptions {
  minSignalScore?:    number;   // 只统计达到该分数的买卖信号，默认 55（中等级别）
  includeSignals?:    boolean;  // 是否统计 buy/sell 信号，默认 true
  includePredictions?: boolean; // 是否统计 top/bottom 预测，默认 true
}

export interface PluginSignalStats {
  count:         number;
  winningCount:  number;
  winRate:       number;
  avgReturn:     number;
  highConfidence:number;
}

export interface PluginBacktestStats {
  totalSignals:    number;
  winningSignals:  number;
  winRate:         number;
  avgReturn:       number;
  highConfidence:  number;
  byType: {
    buy:    PluginSignalStats;
    sell:   PluginSignalStats;
    top:    PluginSignalStats;
    bottom: PluginSignalStats;
  };
}

export interface PluginBacktestResult {
  pluginId:    string;
  pluginName:  string;
  symbol:      string;
  period:      string;
  totalBars:   number;
  stats:       PluginBacktestStats;
  summary:     string;
}

export interface PluginTradeBacktestOptions extends BacktestOptions {
  initialBalance?:   number;
  positionPct?:      number;
  feeRate?:          number;
  stopMultiplier?:   number;
  profitMultiplier?: number;
  maxHoldBars?:      number;
  minBuyScore?:      number;
  minSellScore?:     number;
  minPredProb?:      number;
  allowShort?:       boolean;
  includePredictions?: boolean;
}

export interface PluginTradeBacktestResult {
  pluginId:        string;
  pluginName:      string;
  symbol:          string;
  period:          string;
  totalBars:       number;
  trades:          Trade[];
  tradeStats:      TradeStats | null;
  finalBalance:    number;
  equityValue:     number;
  totalReturnPct:  number;
  summary:         string;
}

// ─── 实盘交易统计 ────────────────────────────────────────────────────────────

/**
 * 从已执行的交易记录计算胜率等绩效指标
 */
export function calcTradeStats(trades: Trade[]): TradeStats | null {
  const closedTrades = trades
    .filter(t => t.side === 'sell' && t.pnl !== undefined)
    .sort((a, b) => a.date - b.date);
  if (closedTrades.length === 0) return null;

  const pnls = closedTrades.map(t => t.pnl!);
  const wins  = pnls.filter(p => p > 0);
  const losses = pnls.filter(p => p <= 0);

  const totalPnL    = pnls.reduce((a, b) => a + b, 0);
  const totalWin    = wins.reduce((a, b) => a + b, 0);
  const totalLoss   = Math.abs(losses.reduce((a, b) => a + b, 0));

  const avgWin  = wins.length > 0  ? totalWin / wins.length   : 0;
  const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0;

  // 最大回撤
  let peak = 0;
  let equity = 0;
  let maxDD = 0;
  for (const pnl of pnls) { // closedTrades 已按時間正序排列
    equity += pnl;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? Math.min(1, (peak - equity) / peak) : 0;
    if (dd > maxDD) maxDD = dd;
  }

  // 簡化 Sharpe：以每筆交易盈虧為觀測值，sqrt(252) 為年化因子（非嚴格日收益率，僅供趨勢參考）
  // 注意：此處 avgPnL 為絕對金額，非百分比收益率，結果為相對比較指標
  const avgPnL = totalPnL / pnls.length;
  const variance = pnls.reduce((acc, p) => acc + (p - avgPnL) ** 2, 0) / pnls.length;
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (avgPnL / stdDev) * Math.sqrt(252) : 0;

  // 按退出原因统计
  const byExit = {
    signal:      { count: 0, totalPnL: 0, wins: 0 },
    stop_loss:   { count: 0 },
    take_profit: { count: 0, totalPnL: 0 },
    manual:      { count: 0 },
  };
  for (const t of closedTrades) {
    const r = t.exitReason ?? 'signal';
    if (r === 'signal') {
      byExit.signal.count++;
      byExit.signal.totalPnL += t.pnl!;
      if (t.pnl! > 0) byExit.signal.wins++;
    } else if (r === 'stop_loss') {
      byExit.stop_loss.count++;
    } else if (r === 'take_profit') {
      byExit.take_profit.count++;
      byExit.take_profit.totalPnL += t.pnl!;
    } else {
      byExit.manual.count++;
    }
  }

  const calmar = maxDD > 0
    ? (totalPnL / closedTrades.length) * 252 / (maxDD * 100)
    : 0;

  return {
    totalTrades:   closedTrades.length,
    winningTrades: wins.length,
    losingTrades:  losses.length,
    winRate:       wins.length / closedTrades.length,
    avgWin,
    avgLoss,
    profitFactor:  totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 999 : 0,
    expectancy:    avgPnL,
    totalPnL,
    maxDrawdown:   maxDD,
    sharpeRatio:   sharpe,
    calmarRatio:   calmar,
    byExitReason: {
      signal:      { count: byExit.signal.count,      winRate: byExit.signal.count > 0 ? byExit.signal.wins / byExit.signal.count : 0, avgPnL: byExit.signal.count > 0 ? byExit.signal.totalPnL / byExit.signal.count : 0 },
      stop_loss:   { count: byExit.stop_loss.count },
      take_profit: { count: byExit.take_profit.count, avgPnL: byExit.take_profit.count > 0 ? byExit.take_profit.totalPnL / byExit.take_profit.count : 0 },
      manual:      { count: byExit.manual.count },
    },
  };
}

// ─── 历史回测（信号频率 & 质量扫描） ─────────────────────────────────────────

export interface BacktestOptions {
  minConfidence?: number;   // 最低置信度（0-1），默认 0.65
  lookbackBars?:  number;   // 用多少根 K 线的历史模拟每个时间点，默认 80
  holdBars?:      number;   // 信号后持有多少根 K 线评估结果，默认 5
}

export interface BarSignal {
  barIndex:    number;
  timestamp:   number;
  price:       number;
  type:        'buy' | 'sell' | 'top' | 'bottom';
  score:       number;
  probability: number;
  hasSFP:      boolean;
  hasCHOCH:    boolean;
  hasFVG:      boolean;
  tripleConf:  boolean;
  // 后续 holdBars 后的结果
  futureReturn?: number;   // 正数 = 方向正确
  correct?:      boolean;
}

/**
 * 对历史 K 线逐根扫描信号，返回信号列表和统计
 */
export function runBacktest(
  symbol:  string,
  data:    StockData[],
  options: BacktestOptions = {},
): BacktestResult {
  const {
    minConfidence = 0.65,
    lookbackBars  = 80,
    holdBars      = 5,
  } = options;

  if (data.length < lookbackBars + holdBars + 10) {
    return {
      symbol,
      period:    `${data.length} bars`,
      totalBars: data.length,
      signalStats: { totalSignals: 0, buySignals: 0, sellSignals: 0, predTopSignals: 0, predBotSignals: 0, tripleConfirmed: 0, highConfidence: 0 },
      summary: 'Insufficient data for backtest (need at least ' + (lookbackBars + holdBars + 10) + ' bars)',
    };
  }

  // 初始化 POI 系統（必須在掃描前設定 symbol）
  setPredictionSymbol(symbol);

  const signals: BarSignal[] = [];
  let buyCount  = 0, sellCount = 0, topCount = 0, botCount = 0;
  let tripleCount = 0, highConfCount = 0;

  // 逐根扫描（从 lookbackBars 开始，留 holdBars 评估空间）
  for (let i = lookbackBars; i < data.length - holdBars; i++) {
    const window = data.slice(0, i + 1);
    const cur    = data[i];

    // 买入信号
    const buy = detectBuySignal(window);
    if (buy.signal && buy.level === 'high') {
      const futureClose = data[i + holdBars].close;
      const futureReturn = (futureClose - cur.close) / cur.close;
      signals.push({ barIndex: i, timestamp: cur.timestamp, price: cur.close, type: 'buy', score: buy.score, probability: buy.score / 100, hasSFP: false, hasCHOCH: false, hasFVG: false, tripleConf: false, futureReturn, correct: futureReturn > 0 });
      buyCount++;
    }

    // 卖出信号
    const sell = detectSellSignal(window);
    if (sell.signal && sell.level === 'high') {
      const futureClose = data[i + holdBars].close;
      const futureReturn = (data[i + holdBars].close - cur.close) / cur.close;
      signals.push({ barIndex: i, timestamp: cur.timestamp, price: cur.close, type: 'sell', score: sell.score, probability: sell.score / 100, hasSFP: false, hasCHOCH: false, hasFVG: false, tripleConf: false, futureReturn: -futureReturn, correct: futureReturn < 0 });
      sellCount++;
    }

    // 顶底预测
    const pred = predictTopBottom(window);
    if (pred.type !== 'neutral' && pred.probability >= minConfidence) {
      const hasSFP   = pred.signals.some(s => s.includes('SFP'));
      const hasCHOCH = pred.signals.some(s => s.includes('CHOCH'));
      const hasFVG   = pred.signals.some(s => s.includes('FVG'));
      const triple   = hasSFP && hasCHOCH && hasFVG;
      const highConf = pred.probability > 0.8 && (pred.type === 'top' ? (detectSellSignal(window).score ?? 0) >= 75 : (detectBuySignal(window).score ?? 0) >= 75);

      const futureClose  = data[i + holdBars].close;
      const futureReturn = (futureClose - cur.close) / cur.close;
      const correct = pred.type === 'bottom' ? futureReturn > 0 : futureReturn < 0;

      signals.push({ barIndex: i, timestamp: cur.timestamp, price: cur.close, type: pred.type, score: Math.round(pred.probability * 100), probability: pred.probability, hasSFP, hasCHOCH, hasFVG, tripleConf: triple, futureReturn: pred.type === 'bottom' ? futureReturn : -futureReturn, correct });

      if (pred.type === 'top') topCount++; else botCount++;
      if (triple)   tripleCount++;
      if (highConf) highConfCount++;
    }
  }

  // 计算信号准确率
  const evalSignals = signals.filter(s => s.correct !== undefined);
  const correctCount = evalSignals.filter(s => s.correct).length;
  const signalAccuracy = evalSignals.length > 0 ? correctCount / evalSignals.length : undefined;

  // 生成摘要（直接用首尾時間戳差計算天數，避免乘法溢出）
  const dayCount = data.length > 1 && data[data.length - 1].timestamp > data[0].timestamp
    ? Math.round((data[data.length - 1].timestamp - data[0].timestamp) / (1000 * 60 * 60 * 24))
    : data.length;

  const accPct = signalAccuracy !== undefined ? `${(signalAccuracy * 100).toFixed(1)}%` : 'N/A';
  const summary = [
    `Backtested ${data.length} bars / about ${dayCount} days`,
    `${signals.length} total signals (buy:${buyCount} sell:${sellCount} top:${topCount} bottom:${botCount})`,
    `Directional accuracy: ${accPct}`,
    tripleCount > 0 ? `Triple-confirmed signals: ${tripleCount} (SFP+CHOCH+FVG)` : '',
    highConfCount > 0 ? `High-confidence signals: ${highConfCount} (>80%)` : '',
  ].filter(Boolean).join('\n');

  return {
    symbol,
    period:    `${data.length} bars`,
    totalBars: data.length,
    signalStats: {
      totalSignals:    signals.length,
      buySignals:      buyCount,
      sellSignals:     sellCount,
      predTopSignals:  topCount,
      predBotSignals:  botCount,
      tripleConfirmed: tripleCount,
      highConfidence:  highConfCount,
      signalAccuracy,
    },
    summary,
  };
}

// ─── 插件级回测（按插件比较胜率） ───────────────────────────────────────────

type PluginSignalType = 'buy' | 'sell' | 'top' | 'bottom';

interface PluginSignalAccumulator {
  count: number;
  wins: number;
  totalReturn: number;
  highConfidence: number;
}

function emptyPluginAccumulator(): PluginSignalAccumulator {
  return { count: 0, wins: 0, totalReturn: 0, highConfidence: 0 };
}

function toPluginSignalStats(acc: PluginSignalAccumulator): PluginSignalStats {
  return {
    count: acc.count,
    winningCount: acc.wins,
    winRate: acc.count > 0 ? acc.wins / acc.count : 0,
    avgReturn: acc.count > 0 ? acc.totalReturn / acc.count : 0,
    highConfidence: acc.highConfidence,
  };
}

function pushPluginSignal(
  acc: PluginSignalAccumulator,
  orientedReturn: number,
  highConfidence: boolean,
): void {
  acc.count++;
  acc.totalReturn += orientedReturn;
  if (orientedReturn > 0) acc.wins++;
  if (highConfidence) acc.highConfidence++;
}

export function runPluginBacktest(
  plugin: IStrategyPlugin,
  symbol: string,
  data: StockData[],
  options: PluginBacktestOptions = {},
): PluginBacktestResult {
  const {
    minConfidence = 0.65,
    lookbackBars = 80,
    holdBars = 5,
    minSignalScore = 55,
    includeSignals = true,
    includePredictions = true,
  } = options;

  if (data.length < lookbackBars + holdBars + 10) {
    return {
      pluginId: plugin.id,
      pluginName: plugin.name,
      symbol,
      period: `${data.length} bars`,
      totalBars: data.length,
      stats: {
        totalSignals: 0,
        winningSignals: 0,
        winRate: 0,
        avgReturn: 0,
        highConfidence: 0,
        byType: {
          buy: emptyPluginSignalStats(),
          sell: emptyPluginSignalStats(),
          top: emptyPluginSignalStats(),
          bottom: emptyPluginSignalStats(),
        },
      },
      summary: `Plugin ${plugin.name}: insufficient data for backtest (need at least ${lookbackBars + holdBars + 10} bars)`,
    };
  }

  const buckets: Record<PluginSignalType, PluginSignalAccumulator> = {
    buy: emptyPluginAccumulator(),
    sell: emptyPluginAccumulator(),
    top: emptyPluginAccumulator(),
    bottom: emptyPluginAccumulator(),
  };

  for (let i = lookbackBars; i < data.length - holdBars; i++) {
    const window = data.slice(0, i + 1);
    const cur = data[i];
    const futureClose = data[i + holdBars].close;
    const rawReturn = (futureClose - cur.close) / cur.close;

    let result;
    try {
      result = plugin.analyze(window, symbol);
    } catch {
      continue;
    }

    if (!result) continue;

    if (includeSignals && result.buySignal.signal && result.buySignal.score >= minSignalScore) {
      pushPluginSignal(buckets.buy, rawReturn, result.buySignal.score >= 75);
    }
    if (includeSignals && result.sellSignal.signal && result.sellSignal.score >= minSignalScore) {
      pushPluginSignal(buckets.sell, -rawReturn, result.sellSignal.score >= 75);
    }

    if (includePredictions && result.prediction.type === 'bottom' && result.prediction.probability >= minConfidence) {
      pushPluginSignal(buckets.bottom, rawReturn, result.prediction.probability >= 0.8);
    }
    if (includePredictions && result.prediction.type === 'top' && result.prediction.probability >= minConfidence) {
      pushPluginSignal(buckets.top, -rawReturn, result.prediction.probability >= 0.8);
    }
  }

  const byType = {
    buy: toPluginSignalStats(buckets.buy),
    sell: toPluginSignalStats(buckets.sell),
    top: toPluginSignalStats(buckets.top),
    bottom: toPluginSignalStats(buckets.bottom),
  };

  const totalSignals = byType.buy.count + byType.sell.count + byType.top.count + byType.bottom.count;
  const winningSignals = byType.buy.winningCount + byType.sell.winningCount + byType.top.winningCount + byType.bottom.winningCount;
  const totalReturn =
    buckets.buy.totalReturn +
    buckets.sell.totalReturn +
    buckets.top.totalReturn +
    buckets.bottom.totalReturn;
  const highConfidence = byType.buy.highConfidence + byType.sell.highConfidence + byType.top.highConfidence + byType.bottom.highConfidence;

  const stats: PluginBacktestStats = {
    totalSignals,
    winningSignals,
    winRate: totalSignals > 0 ? winningSignals / totalSignals : 0,
    avgReturn: totalSignals > 0 ? totalReturn / totalSignals : 0,
    highConfidence,
    byType,
  };

  const signalParts = [
    byType.buy.count > 0 ? `Buy ${byType.buy.count}` : '',
    byType.sell.count > 0 ? `Sell ${byType.sell.count}` : '',
    byType.top.count > 0 ? `Top ${byType.top.count}` : '',
    byType.bottom.count > 0 ? `Bottom ${byType.bottom.count}` : '',
  ].filter(Boolean).join(' / ');

  return {
    pluginId: plugin.id,
    pluginName: plugin.name,
    symbol,
    period: `${data.length} bars`,
    totalBars: data.length,
    stats,
    summary: [
      `${plugin.name} backtest complete`,
      `Total signals ${stats.totalSignals}, win rate ${(stats.winRate * 100).toFixed(1)}%`,
      `Average directional return ${(stats.avgReturn * 100).toFixed(2)}% over ${holdBars} bars`,
      signalParts ? `Signal mix: ${signalParts}` : '',
      stats.highConfidence > 0 ? `High-confidence signals ${stats.highConfidence}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export function rankPluginsByBacktest(
  symbol: string,
  data: StockData[],
  options: PluginBacktestOptions = {},
  plugins: IStrategyPlugin[] = pluginRegistry.list(),
): PluginBacktestResult[] {
  return plugins
    .map(plugin => runPluginBacktest(plugin, symbol, data, options))
    .sort((a, b) => {
      if (b.stats.winRate !== a.stats.winRate) return b.stats.winRate - a.stats.winRate;
      if (b.stats.avgReturn !== a.stats.avgReturn) return b.stats.avgReturn - a.stats.avgReturn;
      return b.stats.totalSignals - a.stats.totalSignals;
    });
}

function emptyPluginSignalStats(): PluginSignalStats {
  return {
    count: 0,
    winningCount: 0,
    winRate: 0,
    avgReturn: 0,
    highConfidence: 0,
  };
}

// ─── 插件级真实交易回测（胜率 / 盈亏比 / Sharpe / 回撤）────────────────────

interface SimulatedPosition {
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  openedAtBar: number;
}

function closeSimulatedPosition(
  position: SimulatedPosition,
  exitPrice: number,
  exitReason: Trade['exitReason'],
  feeRate: number,
  tradeId: number,
  timestamp: number,
): { trade: Trade; balanceDelta: number } {
  const gross = position.quantity * exitPrice;
  const fee = gross * feeRate;
  const signedMove = position.side === 'long'
    ? exitPrice - position.entryPrice
    : position.entryPrice - exitPrice;
  const pnl = signedMove * position.quantity - fee;
  const pnlPercent = (signedMove / position.entryPrice) * 100;

  return {
    trade: {
      id: tradeId,
      symbol: '',
      side: 'sell',
      quantity: position.quantity,
      price: exitPrice,
      total: gross,
      fee,
      date: timestamp,
      pnl,
      pnlPercent,
      exitReason,
    },
    balanceDelta: position.side === 'long'
      ? gross - fee
      : position.quantity * position.entryPrice * 0.3 + pnl,
  };
}

function getEquity(balance: number, position: SimulatedPosition | null, lastPrice: number): number {
  if (!position) return balance;
  if (position.side === 'long') {
    return balance + position.quantity * lastPrice;
  }
  const unrealized = (position.entryPrice - lastPrice) * position.quantity;
  return balance + position.quantity * position.entryPrice * 0.3 + unrealized;
}

export function runPluginTradeBacktest(
  plugin: IStrategyPlugin,
  symbol: string,
  data: StockData[],
  options: PluginTradeBacktestOptions = {},
): PluginTradeBacktestResult {
  const {
    lookbackBars = 80,
    initialBalance = 100_000,
    positionPct = 0.1,
    feeRate = 0.001,
    stopMultiplier = 2,
    profitMultiplier = 3,
    maxHoldBars = 0,
    minBuyScore = 55,
    minSellScore = 55,
    minPredProb = 0.65,
    allowShort = true,
    includePredictions = true,
  } = options;

  if (data.length < lookbackBars + 10) {
    return {
      pluginId: plugin.id,
      pluginName: plugin.name,
      symbol,
      period: `${data.length} bars`,
      totalBars: data.length,
      trades: [],
      tradeStats: null,
      finalBalance: initialBalance,
      equityValue: initialBalance,
      totalReturnPct: 0,
      summary: `Plugin ${plugin.name}: insufficient data for trade backtest (need at least ${lookbackBars + 10} bars)`,
    };
  }

  let balance = initialBalance;
  let nextTradeId = 1;
  let position: SimulatedPosition | null = null;
  const trades: Trade[] = [];

  for (let i = lookbackBars; i < data.length; i++) {
    const window = data.slice(0, i + 1);
    const bar = data[i];
    const atr = Math.max(calculateATR(window), bar.close * 0.015);

    let result;
    try {
      result = plugin.analyze(window, symbol);
    } catch {
      continue;
    }
    if (!result) continue;

    if (position) {
      let exitPrice: number | null = null;
      let exitReason: Trade['exitReason'] = 'signal';

      if (position.side === 'long') {
        if (bar.low <= position.stopLoss) {
          exitPrice = position.stopLoss;
          exitReason = 'stop_loss';
        } else if (bar.high >= position.takeProfit) {
          exitPrice = position.takeProfit;
          exitReason = 'take_profit';
        } else if (maxHoldBars > 0 && i - position.openedAtBar >= maxHoldBars) {
          exitPrice = bar.close;
          exitReason = 'manual';
        } else if (
          (result.sellSignal.signal && result.sellSignal.score >= minSellScore) ||
          (includePredictions && result.prediction.type === 'top' && result.prediction.probability >= minPredProb)
        ) {
          exitPrice = bar.close;
          exitReason = 'signal';
        }
      } else {
        if (bar.high >= position.stopLoss) {
          exitPrice = position.stopLoss;
          exitReason = 'stop_loss';
        } else if (bar.low <= position.takeProfit) {
          exitPrice = position.takeProfit;
          exitReason = 'take_profit';
        } else if (maxHoldBars > 0 && i - position.openedAtBar >= maxHoldBars) {
          exitPrice = bar.close;
          exitReason = 'manual';
        } else if (
          (result.buySignal.signal && result.buySignal.score >= minBuyScore) ||
          (includePredictions && result.prediction.type === 'bottom' && result.prediction.probability >= minPredProb)
        ) {
          exitPrice = bar.close;
          exitReason = 'signal';
        }
      }

      if (exitPrice !== null) {
        const closed = closeSimulatedPosition(position, exitPrice, exitReason, feeRate, nextTradeId++, bar.timestamp);
        closed.trade.symbol = symbol;
        trades.push(closed.trade);
        balance += closed.balanceDelta;
        position = null;
      }
    }

    if (position) continue;

    const wantLong =
      (result.buySignal.signal && result.buySignal.score >= minBuyScore) ||
      (includePredictions && result.prediction.type === 'bottom' && result.prediction.probability >= minPredProb);
    const wantShort = allowShort && (
      (result.sellSignal.signal && result.sellSignal.score >= minSellScore) ||
      (includePredictions && result.prediction.type === 'top' && result.prediction.probability >= minPredProb)
    );

    if (!wantLong && !wantShort) continue;

    const capital = balance * positionPct;
    if (capital <= 0) continue;

    const quantity = Math.floor((capital / bar.close) * 10_000) / 10_000;
    if (quantity <= 0) continue;

    const total = quantity * bar.close;
    const fee = total * feeRate;

    if (wantLong) {
      if (balance < total + fee) continue;
      balance -= total + fee;
      position = {
        side: 'long',
        quantity,
        entryPrice: bar.close,
        stopLoss: bar.close - atr * stopMultiplier,
        takeProfit: bar.close + atr * profitMultiplier,
        openedAtBar: i,
      };
    } else if (wantShort) {
      const margin = total * 0.3 + fee;
      if (balance < margin) continue;
      balance -= margin;
      position = {
        side: 'short',
        quantity,
        entryPrice: bar.close,
        stopLoss: bar.close + atr * stopMultiplier,
        takeProfit: bar.close - atr * profitMultiplier,
        openedAtBar: i,
      };
    }
  }

  if (position) {
    const lastBar = data[data.length - 1];
    const closed = closeSimulatedPosition(position, lastBar.close, 'manual', feeRate, nextTradeId++, lastBar.timestamp);
    closed.trade.symbol = symbol;
    trades.push(closed.trade);
    balance += closed.balanceDelta;
    position = null;
  }

  const tradeStats = calcTradeStats(trades);
  const equityValue = getEquity(balance, position, data[data.length - 1].close);
  const totalReturnPct = ((equityValue - initialBalance) / initialBalance) * 100;

  return {
    pluginId: plugin.id,
    pluginName: plugin.name,
    symbol,
    period: `${data.length} bars`,
    totalBars: data.length,
    trades,
    tradeStats,
    finalBalance: balance,
    equityValue,
    totalReturnPct,
    summary: tradeStats
      ? [
          `${plugin.name} trade backtest complete`,
          `Trades ${tradeStats.totalTrades}, win rate ${(tradeStats.winRate * 100).toFixed(1)}%`,
          `Total PnL ${tradeStats.totalPnL >= 0 ? '+' : ''}$${tradeStats.totalPnL.toFixed(2)}`,
          `Profit factor ${tradeStats.profitFactor.toFixed(2)}, Sharpe ${tradeStats.sharpeRatio.toFixed(2)}`,
          `Max drawdown ${(tradeStats.maxDrawdown * 100).toFixed(1)}%, equity change ${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}%`,
        ].join('\n')
      : `${plugin.name} trade backtest produced no closed trades`,
  };
}

export function rankPluginsByTradeBacktest(
  symbol: string,
  data: StockData[],
  options: PluginTradeBacktestOptions = {},
  plugins: IStrategyPlugin[] = pluginRegistry.list(),
): PluginTradeBacktestResult[] {
  return plugins
    .map(plugin => runPluginTradeBacktest(plugin, symbol, data, options))
    .sort((a, b) => {
      const aStats = a.tradeStats;
      const bStats = b.tradeStats;
      if (!aStats && !bStats) return 0;
      if (!aStats) return 1;
      if (!bStats) return -1;
      if (bStats.totalPnL !== aStats.totalPnL) return bStats.totalPnL - aStats.totalPnL;
      if (bStats.sharpeRatio !== aStats.sharpeRatio) return bStats.sharpeRatio - aStats.sharpeRatio;
      if (bStats.winRate !== aStats.winRate) return bStats.winRate - aStats.winRate;
      if (bStats.profitFactor !== aStats.profitFactor) return bStats.profitFactor - aStats.profitFactor;
      return bStats.totalTrades - aStats.totalTrades;
    });
}

// ─── 格式化输出（供 UI 展示） ─────────────────────────────────────────────────

export function formatTradeStats(stats: TradeStats): Record<string, string> {
  return {
    'Total Trades':    `${stats.totalTrades}`,
    'Win Rate':        `${(stats.winRate * 100).toFixed(1)}%`,
    'Profit Factor':   `${stats.profitFactor.toFixed(2)}`,
    'Expectancy / Trade': `$${stats.expectancy.toFixed(2)}`,
    'Average Win':     `$${stats.avgWin.toFixed(2)}`,
    'Average Loss':    `-$${stats.avgLoss.toFixed(2)}`,
    'Total PnL':       `${stats.totalPnL >= 0 ? '+' : ''}$${stats.totalPnL.toFixed(2)}`,
    'Max Drawdown':    `${(stats.maxDrawdown * 100).toFixed(1)}%`,
    'Sharpe Ratio':    stats.sharpeRatio.toFixed(2),
    'Calmar Ratio':    stats.calmarRatio.toFixed(2),
    'Stop Exits':      `${stats.byExitReason.stop_loss.count}`,
    'Target Exits':    `${stats.byExitReason.take_profit.count}`,
  };
}

export function formatPluginBacktestStats(stats: PluginBacktestStats): Record<string, string> {
  return {
    'Total Signals': `${stats.totalSignals}`,
    'Win Rate': `${(stats.winRate * 100).toFixed(1)}%`,
    'Average Directional Return': `${(stats.avgReturn * 100).toFixed(2)}%`,
    'High-Confidence Signals': `${stats.highConfidence}`,
    'Buy Win Rate': `${(stats.byType.buy.winRate * 100).toFixed(1)}% (${stats.byType.buy.count})`,
    'Sell Win Rate': `${(stats.byType.sell.winRate * 100).toFixed(1)}% (${stats.byType.sell.count})`,
    'Top Prediction Win Rate': `${(stats.byType.top.winRate * 100).toFixed(1)}% (${stats.byType.top.count})`,
    'Bottom Prediction Win Rate': `${(stats.byType.bottom.winRate * 100).toFixed(1)}% (${stats.byType.bottom.count})`,
  };
}
