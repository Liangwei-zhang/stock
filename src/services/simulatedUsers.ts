/**
 * simulatedUsers.ts — 模拟用户系统
 *
 * 5 种交易性格，每种有独立规则集、独立账户、独立决策日志
 * 每次市场信号更新后调用 SimulatedUserService.onMarketUpdate()
 * 由外部（App.tsx）驱动，不自轮询
 */

import { StockAnalysis } from '../types';
import { calcTradeStats, TradeStats } from './backtestStats';

// ─── 规则集 ───────────────────────────────────────────────────────────────────

export interface UserStrategy {
  // 入场规则
  minBuyScore:       number;   // 买入信号最低分
  minSellScore:      number;   // 卖出信号最低分
  minPredProb:       number;   // 顶底预测最低概率（0-1）
  acceptSignals:     ('buy' | 'sell' | 'top' | 'bottom')[];
  requireTriple:     boolean;  // 需要 SFP+CHOCH+FVG 三重确认
  onlyWithTrend:     boolean;  // 顺趋势（EMA9>EMA21 才买，反之才卖）
  contrarian:        boolean;  // 逆向：把顶部信号当买入，底部当卖出

  // 仓位管理
  positionPct:       number;   // 每笔占余额比例（0.05-0.50）
  maxConcurrent:     number;   // 最大并发持仓数

  // 退出规则
  stopMultiplier:    number;   // 止损 = 入场 ± N×ATR
  profitMultiplier:  number;   // 止盈 = 入场 ± N×ATR
  maxHoldPeriods:    number;   // 最大持仓次数（更新周期），0=无限

  // 风控
  pauseOnDrawdown:   number;   // 回撤超过此值（0-1）暂停交易
}

// ─── 预设性格 ─────────────────────────────────────────────────────────────────

export const PRESET_STRATEGIES: Record<string, UserStrategy> = {
  bull: {
    minBuyScore: 55, minSellScore: 999, minPredProb: 0.65,
    acceptSignals: ['buy', 'bottom'],
    requireTriple: false, onlyWithTrend: true, contrarian: false,
    positionPct: 0.20, maxConcurrent: 3,
    stopMultiplier: 2.0, profitMultiplier: 4.0, maxHoldPeriods: 0,
    pauseOnDrawdown: 0.25,
  },
  bear: {
    minBuyScore: 999, minSellScore: 55, minPredProb: 0.65,
    acceptSignals: ['sell', 'top'],
    requireTriple: false, onlyWithTrend: true, contrarian: false,
    positionPct: 0.20, maxConcurrent: 3,
    stopMultiplier: 2.0, profitMultiplier: 4.0, maxHoldPeriods: 0,
    pauseOnDrawdown: 0.25,
  },
  conservative: {
    minBuyScore: 75, minSellScore: 75, minPredProb: 0.80,
    acceptSignals: ['buy', 'sell', 'top', 'bottom'],
    requireTriple: true, onlyWithTrend: true, contrarian: false,
    positionPct: 0.08, maxConcurrent: 2,
    stopMultiplier: 1.5, profitMultiplier: 3.0, maxHoldPeriods: 0,
    pauseOnDrawdown: 0.10,
  },
  scalper: {
    minBuyScore: 45, minSellScore: 45, minPredProb: 0.60,
    acceptSignals: ['buy', 'sell', 'top', 'bottom'],
    requireTriple: false, onlyWithTrend: false, contrarian: false,
    positionPct: 0.10, maxConcurrent: 4,
    stopMultiplier: 1.0, profitMultiplier: 1.5, maxHoldPeriods: 6,
    pauseOnDrawdown: 0.15,
  },
  contrarian: {
    minBuyScore: 70, minSellScore: 70, minPredProb: 0.75,
    acceptSignals: ['buy', 'sell', 'top', 'bottom'],
    requireTriple: false, onlyWithTrend: false, contrarian: true,
    positionPct: 0.12, maxConcurrent: 3,
    stopMultiplier: 2.5, profitMultiplier: 5.0, maxHoldPeriods: 0,
    pauseOnDrawdown: 0.20,
  },
};

// ─── 单笔持仓记录 ─────────────────────────────────────────────────────────────

interface SimPosition {
  symbol:      string;
  side:        'long' | 'short';
  qty:         number;
  entryPrice:  number;
  stopLoss:    number;
  takeProfit:  number;
  entryAt:     number;   // Date.now()
  holdCount:   number;   // 已持仓更新周期数
}

// ─── 单笔已完成交易 ───────────────────────────────────────────────────────────

export interface SimTrade {
  id:         number;
  symbol:     string;
  side:       'buy' | 'sell';
  qty:        number;
  entryPrice: number;
  exitPrice:  number;
  pnl:        number;
  pnlPct:     number;
  entryAt:    number;
  exitAt:     number;
  exitReason: 'signal' | 'stop_loss' | 'take_profit' | 'timeout' | 'manual';
  signalInfo: string;  // 触发原因摘要
}

// ─── 决策日志条目 ─────────────────────────────────────────────────────────────

export interface DecisionLog {
  ts:       number;
  symbol:   string;
  action:   'buy' | 'sell' | 'hold' | 'skip' | 'close_sl' | 'close_tp' | 'close_timeout' | 'paused';
  price:    number;
  reason:   string;
  score?:   number;
}

// ─── 模拟用户 ─────────────────────────────────────────────────────────────────

export interface SimulatedUser {
  id:          string;
  name:        string;
  emoji:       string;
  description: string;
  strategy:    UserStrategy;
}

export interface SimUserState {
  user:           SimulatedUser;
  balance:        number;
  initBalance:    number;
  allowedSymbols: string[];       // 空数组 = 交易所有标的
  positions:      Map<string, SimPosition>;
  trades:         SimTrade[];
  log:            DecisionLog[];  // 最近 60 条
  tradeStats:     TradeStats | null;
  paused:         boolean;        // 触及回撤上限时暂停
}

// ─── 默认 5 位用户 ────────────────────────────────────────────────────────────

const DEFAULT_USERS: SimulatedUser[] = [
  {
    id: 'bull_wang',
    name: '王大牛',
    emoji: '🐂',
    description: '坚定多头，只做买入信号，顺势重仓，止损宽松',
    strategy: PRESET_STRATEGIES.bull,
  },
  {
    id: 'bear_li',
    name: '李空熊',
    emoji: '🐻',
    description: '专注做空，只做卖出信号，逆行者',
    strategy: PRESET_STRATEGIES.bear,
  },
  {
    id: 'conservative_chen',
    name: '陈稳健',
    emoji: '🦉',
    description: '严苛条件，必须三重确认，小仓轻量，最低回撤',
    strategy: PRESET_STRATEGIES.conservative,
  },
  {
    id: 'scalper_zhang',
    name: '张短线',
    emoji: '⚡',
    description: '低阈值高频出入，快止盈，最多持仓 6 个更新周期',
    strategy: PRESET_STRATEGIES.scalper,
  },
  {
    id: 'contrarian_zhou',
    name: '周逆势',
    emoji: '🦊',
    description: '逆向交易者，顶部信号买入，底部信号做空，高风险高回报',
    strategy: PRESET_STRATEGIES.contrarian,
  },
];

const FEE_RATE       = 0.001;   // 0.1% 手续费
const DEFAULT_ATR    = 0.015;   // 无 ATR 数据时默认 1.5%
const LOG_MAX        = 60;      // 每个用户保留最近 60 条日志
const LS_KEY_PREFIX  = 'sim_user_';

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function calcDrawdown(state: SimUserState, prices?: Map<string, number>): number {
  let posValue = 0;
  for (const [sym, pos] of state.positions) {
    const px = prices?.get(sym) ?? pos.entryPrice;
    posValue += pos.qty * px;
  }
  const totalValue = state.balance + posValue;
  // O(n) peak calculation: single pass through trade history
  let runningBalance = state.initBalance;
  let peak = state.initBalance;
  for (const trade of [...state.trades].reverse()) { // oldest first
    runningBalance += trade.pnl;
    if (runningBalance > peak) peak = runningBalance;
  }
  return peak > 0 ? Math.max(0, (peak - totalValue) / peak) : 0;
}

function getATR(analysis: StockAnalysis): number {
  // ATR 估算：用布林带宽度作为代理（indicators 中没有直接 ATR 字段）
  const bw = analysis.indicators.bollWidth;
  if (bw > 0) return analysis.price * bw * 0.15; // 近似
  return analysis.price * DEFAULT_ATR;
}

function addLog(state: SimUserState, entry: DecisionLog): void {
  state.log.unshift(entry);
  if (state.log.length > LOG_MAX) state.log.length = LOG_MAX;
}

// ─── 持久化 ──────────────────────────────────────────────────────────────────

interface PersistedUserState {
  balance:        number;
  initBalance:    number;
  allowedSymbols: string[];
  positions:      Array<[string, SimPosition]>;
  trades:         SimTrade[];
  log:            DecisionLog[];
  paused:         boolean;
  strategy:       UserStrategy;
}

function persist(state: SimUserState): void {
  try {
    const s: PersistedUserState = {
      balance:        state.balance,
      initBalance:    state.initBalance,
      allowedSymbols: state.allowedSymbols,
      positions:      Array.from(state.positions.entries()),
      trades:         state.trades,
      log:            state.log,
      paused:         state.paused,
      strategy:       state.user.strategy,
    };
    localStorage.setItem(LS_KEY_PREFIX + state.user.id, JSON.stringify(s));
  } catch {}
}

/** 節流持久化：每個用戶最多每 5 秒寫一次 localStorage */
const _throttleTimers = new Map<string, ReturnType<typeof setTimeout>>();
function persistThrottled(state: SimUserState): void {
  const key = state.user.id;
  if (_throttleTimers.has(key)) return;
  _throttleTimers.set(key, setTimeout(() => {
    _throttleTimers.delete(key);
    persist(state);
  }, 5000));
}

function restore(user: SimulatedUser, initBalance: number): SimUserState {
  const blank: SimUserState = {
    user, balance: initBalance, initBalance,
    allowedSymbols: [],
    positions: new Map(), trades: [], log: [],
    tradeStats: null, paused: false,
  };
  try {
    const raw = localStorage.getItem(LS_KEY_PREFIX + user.id);
    if (!raw) return blank;
    const s: PersistedUserState = JSON.parse(raw);
    // 若持久化中有自定義策略，則覆蓋預設值
    const restoredUser = s.strategy
      ? { ...user, strategy: s.strategy }
      : user;
    return {
      ...blank,
      user:           restoredUser,
      balance:        s.balance,
      initBalance:    s.initBalance ?? initBalance,
      allowedSymbols: s.allowedSymbols ?? [],
      positions:      new Map(s.positions),
      trades:         s.trades,
      log:            s.log ?? [],
      paused:         s.paused ?? false,
    };
  } catch { return blank; }
}

// ─── 决策引擎 ─────────────────────────────────────────────────────────────────

function decide(
  state:    SimUserState,
  symbol:   string,
  analysis: StockAnalysis,
  prices:   Map<string, number>,
): void {
  const { strategy } = state.user;
  const price = analysis.price;
  const atr   = getATR(analysis);
  const { buySignal, sellSignal, prediction, indicators } = analysis;

  // 先检查持仓退出条件
  const pos = state.positions.get(symbol);
  if (pos) {
    pos.holdCount++;

    // 超时平仓
    if (strategy.maxHoldPeriods > 0 && pos.holdCount >= strategy.maxHoldPeriods) {
      closeTrade(state, symbol, price, 'timeout', `持仓超時 ${pos.holdCount} 個周期`);
      return;
    }
    // 止损
    if (pos.side === 'long'  && price <= pos.stopLoss)  { closeTrade(state, symbol, price, 'stop_loss', `止損觸發`); return; }
    if (pos.side === 'short' && price >= pos.stopLoss)  { closeTrade(state, symbol, price, 'stop_loss', `止損觸發`); return; }
    // 止盈
    if (pos.side === 'long'  && price >= pos.takeProfit) { closeTrade(state, symbol, price, 'take_profit', `止盈觸發`); return; }
    if (pos.side === 'short' && price <= pos.takeProfit) { closeTrade(state, symbol, price, 'take_profit', `止盈觸發`); return; }

    // 有持仓时检查反向平仓信号
    if (pos.side === 'long' && (sellSignal.signal && sellSignal.score >= strategy.minSellScore)) {
      closeTrade(state, symbol, price, 'signal', `反向賣出信號 (${sellSignal.score}分)`);
      return;
    }
    if (pos.side === 'short' && (buySignal.signal && buySignal.score >= strategy.minBuyScore)) {
      closeTrade(state, symbol, price, 'signal', `反向買入信號 (${buySignal.score}分)`);
      return;
    }
    // 持仓中，无退出条件 → 持有
    addLog(state, { ts: Date.now(), symbol, action: 'hold', price, reason: `持倉中 (SL${pos.stopLoss.toFixed(2)} TP${pos.takeProfit.toFixed(2)})` });
    persistThrottled(state);
    return;
  }

  // 检查暂停
  if (state.paused) {
    const dd = calcDrawdown(state, prices);
    if (dd < strategy.pauseOnDrawdown * 0.7) {
      state.paused = false; // 回撤回复到阈值70%时解除
    } else {
      addLog(state, { ts: Date.now(), symbol, action: 'paused', price, reason: `風控暫停中（回撤 ${(dd*100).toFixed(1)}%）` });
      persistThrottled(state);
      return;
    }
  }

  // 检查并发持仓上限
  if (state.positions.size >= strategy.maxConcurrent) {
    addLog(state, { ts: Date.now(), symbol, action: 'skip', price, reason: `已達最大持倉數 ${strategy.maxConcurrent}` });
    persistThrottled(state);
    return;
  }

  // 计算入场方向
  let wantLong  = false;
  let wantShort = false;
  let signalInfo = '';

  // 三重确认判断
  const hasSFP   = prediction.signals.some(s => s.includes('SFP'));
  const hasCHOCH = prediction.signals.some(s => s.includes('CHOCH'));
  const hasFVG   = prediction.signals.some(s => s.includes('FVG'));
  const tripleOK = !strategy.requireTriple || (hasSFP && hasCHOCH && hasFVG);

  // 顺势判断
  const bullTrend = indicators.ema9 > indicators.ema21;
  const bearTrend = indicators.ema9 < indicators.ema21;

  // 买入信号
  if (strategy.acceptSignals.includes('buy') && buySignal.signal && buySignal.score >= strategy.minBuyScore) {
    if (tripleOK && (!strategy.onlyWithTrend || bullTrend)) {
      wantLong  = !strategy.contrarian;
      wantShort = strategy.contrarian;
      signalInfo = `買入信號 ${buySignal.score}分 | ${buySignal.reasons[0] ?? ''}`;
    }
  }
  // 底部预测
  if (!wantLong && !wantShort && strategy.acceptSignals.includes('bottom')
      && prediction.type === 'bottom' && prediction.probability >= strategy.minPredProb) {
    if (tripleOK && (!strategy.onlyWithTrend || bullTrend)) {
      wantLong  = !strategy.contrarian;
      wantShort = strategy.contrarian;
      signalInfo = `底部預測 ${(prediction.probability*100).toFixed(0)}% | ${prediction.recommendation}`;
    }
  }
  // 卖出信号
  if (!wantLong && !wantShort && strategy.acceptSignals.includes('sell')
      && sellSignal.signal && sellSignal.score >= strategy.minSellScore) {
    if (tripleOK && (!strategy.onlyWithTrend || bearTrend)) {
      wantShort = !strategy.contrarian;
      wantLong  = strategy.contrarian;
      signalInfo = `賣出信號 ${sellSignal.score}分 | ${sellSignal.reasons[0] ?? ''}`;
    }
  }
  // 顶部预测
  if (!wantLong && !wantShort && strategy.acceptSignals.includes('top')
      && prediction.type === 'top' && prediction.probability >= strategy.minPredProb) {
    if (tripleOK && (!strategy.onlyWithTrend || bearTrend)) {
      wantShort = !strategy.contrarian;
      wantLong  = strategy.contrarian;
      signalInfo = `頂部預測 ${(prediction.probability*100).toFixed(0)}% | ${prediction.recommendation}`;
    }
  }

  if (!wantLong && !wantShort) {
    addLog(state, { ts: Date.now(), symbol, action: 'skip', price, reason: '無符合條件的信號' });
    persistThrottled(state);
    return;
  }

  // 计算仓位
  const capital  = state.balance * strategy.positionPct;
  if (capital < price * 0.001) {
    addLog(state, { ts: Date.now(), symbol, action: 'skip', price, reason: '餘額不足' });
    persistThrottled(state);
    return;
  }
  const qty     = Math.floor((capital / price) * 10_000) / 10_000;
  const total   = qty * price;
  const fee     = total * FEE_RATE;

  if (state.balance < total + fee) {
    addLog(state, { ts: Date.now(), symbol, action: 'skip', price, reason: '餘額不足' });
    persistThrottled(state);
    return;
  }

  if (wantLong) {
    state.balance -= total + fee;
    state.positions.set(symbol, {
      symbol, side: 'long', qty, entryPrice: price,
      stopLoss:   price - atr * strategy.stopMultiplier,
      takeProfit: price + atr * strategy.profitMultiplier,
      entryAt: Date.now(), holdCount: 0,
    });
    addLog(state, { ts: Date.now(), symbol, action: 'buy', price, reason: signalInfo, score: buySignal.score || Math.round(prediction.probability * 100) });
  } else {
    // 模拟做空：借券卖出，锁定保证金
    state.balance -= total * 0.3 + fee; // 30% 保证金
    state.positions.set(symbol, {
      symbol, side: 'short', qty, entryPrice: price,
      stopLoss:   price + atr * strategy.stopMultiplier,
      takeProfit: price - atr * strategy.profitMultiplier,
      entryAt: Date.now(), holdCount: 0,
    });
    addLog(state, { ts: Date.now(), symbol, action: 'sell', price, reason: signalInfo, score: sellSignal.score || Math.round(prediction.probability * 100) });
  }

  persist(state);
}

function closeTrade(
  state:      SimUserState,
  symbol:     string,
  exitPrice:  number,
  exitReason: SimTrade['exitReason'],
  reason:     string,
): void {
  const pos = state.positions.get(symbol);
  if (!pos) return;

  const gross   = pos.qty * exitPrice;
  const fee     = gross * FEE_RATE;
  let pnl: number;

  if (pos.side === 'long') {
    pnl = gross - pos.qty * pos.entryPrice - fee;
    state.balance += gross - fee;
  } else {
    // 平空：还券获利
    const entryGross = pos.qty * pos.entryPrice;
    pnl = entryGross - gross - fee;
    state.balance += pos.qty * pos.entryPrice * 0.3 + pnl; // 退还保证金 + 盈亏
  }

  const pnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * (pos.side === 'long' ? 1 : -1) * 100;

  const trade: SimTrade = {
    id:         state.trades.length + 1,
    symbol,
    side:       pos.side === 'long' ? 'buy' : 'sell',
    qty:        pos.qty,
    entryPrice: pos.entryPrice,
    exitPrice,
    pnl,
    pnlPct,
    entryAt:    pos.entryAt,
    exitAt:     Date.now(),
    exitReason,
    signalInfo: reason,
  };

  state.trades.unshift(trade);
  state.positions.delete(symbol);

  const action = exitReason === 'stop_loss' ? 'close_sl'
    : exitReason === 'take_profit' ? 'close_tp'
    : exitReason === 'timeout'     ? 'close_timeout'
    : 'sell';

  addLog(state, {
    ts: Date.now(), symbol, action, price: exitPrice,
    reason: `${reason} | PnL ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`,
  });

  // 刷新统计
  state.tradeStats = calcTradeStats(
    state.trades.map(t => ({
      id: t.id, symbol: t.symbol, side: t.side === 'buy' ? 'buy' : 'sell',
      quantity: t.qty, price: t.exitPrice, total: t.qty * t.exitPrice,
      fee: t.qty * t.exitPrice * FEE_RATE, date: t.exitAt,
      pnl: t.pnl, pnlPercent: t.pnlPct,
      exitReason: t.exitReason,
    }))
  );

  // 检查回撤暂停
  const dd = calcDrawdown(state);
  if (dd >= state.user.strategy.pauseOnDrawdown) {
    state.paused = true;
    addLog(state, {
      ts: Date.now(), symbol, action: 'paused', price: exitPrice,
      reason: `回撤達 ${(dd*100).toFixed(1)}% ≥ 閾值 ${(state.user.strategy.pauseOnDrawdown*100).toFixed(0)}%，暫停交易`,
    });
  }

  persist(state);
}

// ─── 服务主类 ─────────────────────────────────────────────────────────────────

class SimulatedUserService {
  private states: Map<string, SimUserState> = new Map();
  private onUpdate: (() => void) | null = null;
  private enabled = false;
  private initBalance = 50_000;

  constructor() {
    this.loadEnabled();
    this.init();
  }

  private loadEnabled(): void {
    this.enabled = localStorage.getItem('sim_users_enabled') === 'true';
  }

  private init(): void {
    for (const user of DEFAULT_USERS) {
      const state = restore(user, this.initBalance);
      state.tradeStats = calcTradeStats(
        state.trades.map(t => ({
          id: t.id, symbol: t.symbol, side: t.side === 'buy' ? 'buy' : 'sell',
          quantity: t.qty, price: t.exitPrice, total: t.qty * t.exitPrice,
          fee: t.qty * t.exitPrice * FEE_RATE, date: t.exitAt,
          pnl: t.pnl, pnlPercent: t.pnlPct, exitReason: t.exitReason,
        }))
      );
      this.states.set(user.id, state);
    }
  }

  /** App.tsx 每次价格更新后调用 */
  onMarketUpdate(analyses: Map<string, StockAnalysis>, prices: Map<string, number>): void {
    if (!this.enabled) return;

    for (const state of this.states.values()) {
      for (const [symbol, analysis] of analyses) {
        // 如果用户设置了标的白名单，只处理白名单内的标的
        if (state.allowedSymbols.length > 0 && !state.allowedSymbols.includes(symbol)) continue;
        try {
          decide(state, symbol, analysis, prices);
        } catch (e) {
          // silent: decision errors are expected when data is insufficient
        }
      }
    }
    this.onUpdate?.();
  }

  /** 价格更新时检查持仓止损止盈 */
  checkPositions(prices: Map<string, number>): void {
    if (!this.enabled) return;
    for (const state of this.states.values()) {
      for (const [symbol, pos] of state.positions) {
        const price = prices.get(symbol);
        if (!price) continue;
        if (pos.side === 'long'  && price <= pos.stopLoss)  { closeTrade(state, symbol, price, 'stop_loss',  '止損'); }
        if (pos.side === 'long'  && price >= pos.takeProfit) { closeTrade(state, symbol, price, 'take_profit', '止盈'); }
        if (pos.side === 'short' && price >= pos.stopLoss)  { closeTrade(state, symbol, price, 'stop_loss',  '止損'); }
        if (pos.side === 'short' && price <= pos.takeProfit) { closeTrade(state, symbol, price, 'take_profit', '止盈'); }
      }
    }
    this.onUpdate?.();
  }

  // ── 控制 ─────────────────────────────────────────────────────────────────

  setEnabled(v: boolean): void {
    this.enabled = v;
    localStorage.setItem('sim_users_enabled', String(v));
    this.onUpdate?.();
  }

  isEnabled(): boolean { return this.enabled; }

  resetAll(balance?: number): void {
    if (balance) this.initBalance = balance;
    for (const user of DEFAULT_USERS) {
      localStorage.removeItem(LS_KEY_PREFIX + user.id);
    }
    this.init();
    this.onUpdate?.();
  }

  resetUser(userId: string): void {
    const user = DEFAULT_USERS.find(u => u.id === userId);
    if (!user) return;
    localStorage.removeItem(LS_KEY_PREFIX + userId);
    this.states.set(userId, restore(user, this.initBalance));
    this.onUpdate?.();
  }

  // ── 策略修改 ─────────────────────────────────────────────────────────────

  updateStrategy(userId: string, patch: Partial<UserStrategy>): void {
    const state = this.states.get(userId);
    if (!state) return;
    state.user = { ...state.user, strategy: { ...state.user.strategy, ...patch } };
    persist(state);
    this.onUpdate?.();
  }

  // ── 读取 ─────────────────────────────────────────────────────────────────

  getStates(): SimUserState[] {
    return Array.from(this.states.values());
  }

  getState(userId: string): SimUserState | undefined {
    return this.states.get(userId);
  }

  getUserList(): SimulatedUser[] {
    return DEFAULT_USERS;
  }

  /** 设置用户的自动交易标的白名单（空数组 = 所有标的） */
  setUserSymbols(userId: string, symbols: string[]): void {
    const state = this.states.get(userId);
    if (!state) return;
    state.allowedSymbols = symbols;
    persist(state);
    this.onUpdate?.();
  }

  /** 设置用户初始资金（会重置账户，清空持仓和交易记录） */
  setUserInitBalance(userId: string, balance: number): void {
    const user = DEFAULT_USERS.find(u => u.id === userId);
    if (!user || balance <= 0) return;
    const state = this.states.get(userId);
    const savedSymbols = state?.allowedSymbols ?? [];
    const savedStrategy = state?.user.strategy ?? user.strategy;
    // 清除旧持久化数据
    localStorage.removeItem(LS_KEY_PREFIX + userId);
    // 重建 state，保留策略和标的设置
    const fresh = restore(user, balance);
    fresh.user = { ...user, strategy: savedStrategy };
    fresh.allowedSymbols = savedSymbols;
    this.states.set(userId, fresh);
    persist(fresh);
    this.onUpdate?.();
  }

  setOnUpdate(cb: () => void): void { this.onUpdate = cb; }

  /** 当前排名（按总资产） */
  getRanking(prices: Map<string, number>): { state: SimUserState; totalValue: number; pnlPct: number }[] {
    return Array.from(this.states.values())
      .map(state => {
        let posVal = 0;
        for (const [sym, pos] of state.positions) {
          posVal += pos.qty * (prices.get(sym) ?? pos.entryPrice);
        }
        const totalValue = state.balance + posVal;
        const pnlPct     = ((totalValue - state.initBalance) / state.initBalance) * 100;
        return { state, totalValue, pnlPct };
      })
      .sort((a, b) => b.pnlPct - a.pnlPct);
  }
}

export const simulatedUserService = new SimulatedUserService();
