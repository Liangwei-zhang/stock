/**
 * backtestStats.ts — 胜率统计 & 绩效评估引擎
 *
 * 功能：
 *  1. 从已完成交易计算胜率、盈亏比、最大回撤等
 *  2. 按信号来源分解胜率（SFP / CHOCH / FVG / Triple 三重确认）
 *  3. 实时回测：对历史 K 线回放算法，统计信号质量
 *  4. Sharpe Ratio / Calmar Ratio 风险调整收益
 */

import { Trade } from './tradingSimulator';
import { StockData } from '../types';
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
      summary: '數據不足，無法回測（需至少 ' + (lookbackBars + holdBars + 10) + ' 根 K 線）',
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
    `回測 ${data.length} 根K線 / 約 ${dayCount} 天`,
    `共 ${signals.length} 個信號（買入:${buyCount} 賣出:${sellCount} 頂:${topCount} 底:${botCount}）`,
    `信號方向準確率: ${accPct}`,
    tripleCount > 0 ? `三重確認信號 ${tripleCount} 次（SFP+CHOCH+FVG）` : '',
    highConfCount > 0 ? `高置信度信號 ${highConfCount} 次（>80%）` : '',
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

// ─── 格式化输出（供 UI 展示） ─────────────────────────────────────────────────

export function formatTradeStats(stats: TradeStats): Record<string, string> {
  return {
    '总交易次数':     `${stats.totalTrades}`,
    '胜率':           `${(stats.winRate * 100).toFixed(1)}%`,
    '盈亏比':         `${stats.profitFactor.toFixed(2)}`,
    '期望值/笔':      `$${stats.expectancy.toFixed(2)}`,
    '平均盈利':       `$${stats.avgWin.toFixed(2)}`,
    '平均亏损':       `-$${stats.avgLoss.toFixed(2)}`,
    '总盈亏':         `${stats.totalPnL >= 0 ? '+' : ''}$${stats.totalPnL.toFixed(2)}`,
    '最大回撤':       `${(stats.maxDrawdown * 100).toFixed(1)}%`,
    'Sharpe Ratio':   stats.sharpeRatio.toFixed(2),
    'Calmar Ratio':   stats.calmarRatio.toFixed(2),
    '止损平仓':       `${stats.byExitReason.stop_loss.count} 次`,
    '止盈平仓':       `${stats.byExitReason.take_profit.count} 次`,
  };
}
