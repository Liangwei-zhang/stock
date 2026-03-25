/**
 * tradingSimulator.ts — 模擬交易系統 v2
 *
 * 新增：
 *  - 止損/止盈自動平倉（入場 ±N×ATR）
 *  - 持倉浮動 P&L 實時更新
 *  - 交易記錄持久化（localStorage fallback）
 */

const API_BASE = 'http://localhost:3002/api';
const LS_KEY   = 'trading_simulator_v2';

export interface Position {
  symbol:     string;
  name:       string;
  quantity:   number;
  avgPrice:   number;
  entryDate:  number;
  side:       'long' | 'short';
  stopLoss?:  number;
  takeProfit?: number;
}

export interface Trade {
  id:          number;
  symbol:      string;
  side:        'buy' | 'sell';
  quantity:    number;
  price:       number;
  total:       number;
  fee:         number;
  date:        number;
  pnl?:        number;
  pnlPercent?: number;
  exitReason?: 'signal' | 'stop_loss' | 'take_profit' | 'manual';
}

export interface Account {
  balance:         number;
  initialBalance:  number;
  positions:       Map<string, Position>;
  trades:          Trade[];
  totalValue:      number;
  totalPnL:        number;
  totalPnLPercent: number;
}

export interface TradeSignal {
  symbol:     string;
  type:       'buy' | 'sell';
  price:      number;
  reason:     string;
  confidence: number;
  atr?:       number;
}

interface PersistedState {
  balance:        number;
  initialBalance: number;
  positions:      Array<[string, Position]>;
  trades:         Trade[];
}

function saveState(account: Account): void {
  try {
    const state: PersistedState = {
      balance:        account.balance,
      initialBalance: account.initialBalance,
      positions:      Array.from(account.positions.entries()),
      trades:         account.trades,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {}
}

function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch { return null; }
}

const FEE_RATE        = 0.001;
const POSITION_RATIO  = 0.1;
const ATR_STOP_MULT   = 2.0;
const ATR_PROFIT_MULT = 3.0;
const DEFAULT_ATR_PCT = 0.015;

class TradingSimulator {
  private account: Account = {
    balance:         100_000,
    initialBalance:  100_000,
    positions:       new Map(),
    trades:          [],
    totalValue:      100_000,
    totalPnL:        0,
    totalPnLPercent: 0,
  };
  private tradeCounter = 0;
  private onUpdate: (() => void) | null = null;

  constructor() {
    this.restore();
  }

  private restore(): void {
    const saved = loadState();
    if (!saved) return;
    this.account = {
      balance:         saved.balance,
      initialBalance:  saved.initialBalance,
      positions:       new Map(saved.positions),
      trades:          saved.trades,
      totalValue:      saved.balance,
      totalPnL:        0,
      totalPnLPercent: 0,
    };
    this.tradeCounter = saved.trades.length;
    this.recalcTotals();
    // 不再尝试连接不存在的后端，直接从 localStorage 恢复状态
  }

  private async syncFromAPI(): Promise<void> {
    try {
      const [accRes, posRes, tradeRes] = await Promise.all([
        fetch(`${API_BASE}/account`),
        fetch(`${API_BASE}/positions`),
        fetch(`${API_BASE}/trades`),
      ]);
      if (!accRes.ok) return;
      const accData    = await accRes.json();
      const posData: Position[] = await posRes.json();
      const tradeData: Trade[]  = await tradeRes.json();
      const posMap = new Map<string, Position>();
      posData.forEach(p => posMap.set(p.symbol, p));
      this.account = {
        balance:         accData.balance,
        initialBalance:  accData.initialBalance,
        positions:       posMap,
        trades:          tradeData,
        totalValue:      accData.balance,
        totalPnL:        0,
        totalPnLPercent: 0,
      };
      this.tradeCounter = tradeData.length;
      this.recalcTotals();
      this.persist();
      this.notify();
    } catch {}
  }

  private recalcTotals(prices?: Map<string, number>): void {
    let positionsValue = 0;
    this.account.positions.forEach((pos, sym) => {
      const price = prices?.get(sym) ?? pos.avgPrice;
      positionsValue += price * pos.quantity;
    });
    this.account.totalValue      = this.account.balance + positionsValue;
    this.account.totalPnL        = this.account.totalValue - this.account.initialBalance;
    this.account.totalPnLPercent = (this.account.totalPnL / this.account.initialBalance) * 100;
  }

  private persist(): void { saveState(this.account); }
  private notify(): void  { this.onUpdate?.(); }

  init(balance: number = 100_000): Account {
    return this.getAccount();
  }

  async reset(balance: number = 100_000): Promise<void> {
    this.account = {
      balance, initialBalance: balance,
      positions: new Map(), trades: [],
      totalValue: balance, totalPnL: 0, totalPnLPercent: 0,
    };
    this.tradeCounter = 0;
    this.persist();
    this.notify();
  }

  async executeTrade(
    signal: TradeSignal,
    quantity: number,
    exitReason: Trade['exitReason'] = 'signal',
  ): Promise<{ success: boolean; message: string }> {
    const { symbol, type, price, atr } = signal;
    const atrValue = atr ?? price * DEFAULT_ATR_PCT;

    if (price <= 0) return { success: false, message: '價格異常（≤0），無法交易' };
    if (quantity <= 0) {
      quantity = Math.floor((this.account.balance * POSITION_RATIO) / price * 10_000) / 10_000;
    }
    if (quantity <= 0) return { success: false, message: '餘額不足，無法開倉' };

    const total = quantity * price;
    const fee   = total * FEE_RATE;

    if (type === 'buy') {
      if (this.account.balance < total + fee)
        return { success: false, message: `餘額不足（需 $${(total + fee).toFixed(2)}）` };

      this.account.balance -= total + fee;
      const existing = this.account.positions.get(symbol);
      if (existing) {
        const totalQty      = existing.quantity + quantity;
        const avgPrice      = (existing.avgPrice * existing.quantity + price * quantity) / totalQty;
        existing.quantity   = totalQty;
        existing.avgPrice   = avgPrice;
        existing.stopLoss   = avgPrice - atrValue * ATR_STOP_MULT;
        existing.takeProfit = avgPrice + atrValue * ATR_PROFIT_MULT;
      } else {
        this.account.positions.set(symbol, {
          symbol, name: symbol, quantity, avgPrice: price,
          entryDate: Date.now(), side: 'long',
          stopLoss:   price - atrValue * ATR_STOP_MULT,
          takeProfit: price + atrValue * ATR_PROFIT_MULT,
        });
      }
      this.account.trades.unshift({ id: ++this.tradeCounter, symbol, side: 'buy', quantity, price, total, fee, date: Date.now(), exitReason });
    } else {
      const pos = this.account.positions.get(symbol);
      if (!pos) return { success: false, message: `無 ${symbol} 持倉，無法賣出` };

      const sellQty    = Math.min(quantity, pos.quantity);
      const sellTotal  = sellQty * price;
      const sellFee    = sellTotal * FEE_RATE;
      const pnl        = sellTotal - pos.avgPrice * sellQty - sellFee;
      const pnlPercent = ((price - pos.avgPrice) / pos.avgPrice) * 100;

      this.account.balance += sellTotal - sellFee;
      this.account.trades.unshift({ id: ++this.tradeCounter, symbol, side: 'sell', quantity: sellQty, price, total: sellTotal, fee: sellFee, date: Date.now(), pnl, pnlPercent, exitReason });

      if (sellQty >= pos.quantity) this.account.positions.delete(symbol);
      else pos.quantity -= sellQty;
    }

    this.recalcTotals();
    this.persist();
    this.notify();
    return { success: true, message: `${type === 'buy' ? '買入' : '賣出'} ${quantity.toFixed(4)} ${symbol} @ $${price.toFixed(2)}` };
  }

  private async syncToAPI(signal: TradeSignal, quantity: number, exitReason: Trade['exitReason']): Promise<void> {
    try {
      await fetch(`${API_BASE}/trade`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: signal.symbol, side: signal.type, quantity, price: signal.price, exitReason }),
      });
    } catch {}
  }

  /**
   * 止損/止盈巡檢 — 在每次價格更新後調用
   * @param prices 各標的當前最新價格
   * @returns 本次觸發的平倉記錄
   */
  async checkStopLossTakeProfit(prices: Map<string, number>): Promise<string[]> {
    const triggered: string[] = [];
    for (const [sym, pos] of this.account.positions) {
      const price = prices.get(sym);
      if (!price) continue;
      let shouldExit = false;
      let exitReason: Trade['exitReason'] = 'signal';
      let reason = '';
      if (pos.stopLoss && price <= pos.stopLoss) {
        shouldExit = true; exitReason = 'stop_loss';
        reason = `止損觸發 @ $${price.toFixed(2)}（止損線 $${pos.stopLoss.toFixed(2)}）`;
      } else if (pos.takeProfit && price >= pos.takeProfit) {
        shouldExit = true; exitReason = 'take_profit';
        reason = `止盈觸發 @ $${price.toFixed(2)}（止盈線 $${pos.takeProfit.toFixed(2)}）`;
      }
      if (shouldExit) {
        const res = await this.executeTrade({ symbol: sym, type: 'sell', price, reason, confidence: 100 }, pos.quantity, exitReason);
        if (res.success) triggered.push(`[${sym}] ${reason}`);
      }
    }
    return triggered;
  }

  getAccount(prices?: Map<string, number>): Account {
    if (prices) this.recalcTotals(prices);
    return { ...this.account, positions: new Map(this.account.positions) };
  }

  getPositions(): Position[] { return Array.from(this.account.positions.values()); }
  getTrades():    Trade[]    { return [...this.account.trades]; }
  setOnUpdate(cb: () => void): void { this.onUpdate = cb; }
}

export const tradingSimulator = new TradingSimulator();
