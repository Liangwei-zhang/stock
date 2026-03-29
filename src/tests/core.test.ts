/**
 * tests/core.test.ts — 完整功能测试套件
 *
 * 覆盖：
 *  - signals.ts         买卖信号检测
 *  - prediction.ts      顶底预测
 *  - sfp / choch / cvd / fvg  SMC 算法模块
 *  - tradingSimulator   账户 / 仓位 / 止损止盈
 *  - autoTradeService   自动交易引擎
 *  - backtestStats      胜率统计
 *  - simulatedUsers     模拟用户决策
 *
 * 运行: npx vitest run tests/core.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fmtPrice } from '../utils/format';

function makeLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    _store: store,
    getItem(k: string) { return store[k] ?? null; },
    setItem(k: string, v: string) { store[k] = v; },
    removeItem(k: string) { delete store[k]; },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** 生成 N 根 K 线，价格从 base 开始做正弦波 */
function genCandles(n: number, base = 100, vol = 0.01) {
  const candles = [];
  let price = base;
  for (let i = 0; i < n; i++) {
    const change = (Math.random() - 0.5) * vol * price;
    price = Math.max(price + change, 0.01);
    const open   = price;
    const close  = price * (1 + (Math.random()-0.5) * vol);
    const high   = Math.max(open, close) * (1 + Math.random() * vol * 0.5);
    const low    = Math.min(open, close) * (1 - Math.random() * vol * 0.5);
    const volume = 100000 + Math.random() * 900000;
    candles.push({ symbol: 'TEST', name: 'Test', price: close, close, open, high, low, volume,
                   change: 0, changePercent: 0, timestamp: Date.now() - (n - i) * 3600000 });
  }
  return candles;
}

/** 生成有明确上涨趋势的 K 线 */
function genBullCandles(n: number, base = 100) {
  const candles = [];
  let price = base;
  for (let i = 0; i < n; i++) {
    price = price * (1 + 0.002 + Math.random() * 0.003); // steady uptrend
    const open  = price * 0.999;
    const close = price;
    const high  = price * 1.003;
    const low   = price * 0.996;
    candles.push({ symbol:'TEST', name:'Test', price:close, close, open, high, low,
                   volume: 500000 + i * 10000, change:0, changePercent:0.2, timestamp: Date.now()-(n-i)*3600000 });
  }
  return candles;
}

/** 生成有明确下跌趋势的 K 线 */
function genBearCandles(n: number, base = 100) {
  const candles = [];
  let price = base;
  for (let i = 0; i < n; i++) {
    price = price * (1 - 0.002 - Math.random() * 0.003);
    const open  = price * 1.001;
    const close = price;
    const high  = price * 1.004;
    const low   = price * 0.997;
    candles.push({ symbol:'TEST', name:'Test', price:close, close, open, high, low,
                   volume: 500000 + i * 10000, change:0, changePercent:-0.2, timestamp: Date.now()-(n-i)*3600000 });
  }
  return candles;
}

/** 在数据末尾插入一根假突破 K 线（长上影线） */
function appendSFPCandle(candles: any[], swingHigh: number) {
  const last = candles[candles.length - 1];
  const sfp = {
    ...last,
    open:   last.close,
    high:   swingHigh * 1.005, // 刺穿高点
    close:  last.close * 0.998,// 收盘回到内侧
    low:    last.close * 0.997,
    volume: last.volume * 2,
  };
  return [...candles, sfp];
}

// ══════════════════════════════════════════════════════════════════════════════
//  1. SIGNAL DETECTION
// ══════════════════════════════════════════════════════════════════════════════

describe('signals.ts — detectBuySignal', () => {
  it('returns no signal when data is insufficient (<60 bars)', async () => {
    const { detectBuySignal } = await import('../utils/signals');
    const result = detectBuySignal(genCandles(30));
    expect(result.signal).toBe(false);
    expect(result.level).toBeNull();
    expect(result.score).toBe(0);
  });

  it('rejects buy in bear trend', async () => {
    const { detectBuySignal } = await import('../utils/signals');
    const result = detectBuySignal(genBearCandles(80));
    expect(result.signal).toBe(false);
  });

  it('score is non-negative', async () => {
    const { detectBuySignal } = await import('../utils/signals');
    const result = detectBuySignal(genCandles(80));
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('high level requires score >= 75 and >= 4 reasons', async () => {
    const { detectBuySignal } = await import('../utils/signals');
    const result = detectBuySignal(genBullCandles(80));
    if (result.level === 'high') {
      expect(result.score).toBeGreaterThanOrEqual(75);
      expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('medium level requires score >= 55 and >= 3 reasons', async () => {
    const { detectBuySignal } = await import('../utils/signals');
    for (let trial = 0; trial < 5; trial++) {
      const result = detectBuySignal(genBullCandles(80));
      if (result.level === 'medium') {
        expect(result.score).toBeGreaterThanOrEqual(55);
        expect(result.reasons.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('reasons array is non-empty when signal is true', async () => {
    const { detectBuySignal } = await import('../utils/signals');
    // Try many times to find a signal
    for (let i = 0; i < 10; i++) {
      const result = detectBuySignal(genBullCandles(80));
      if (result.signal) {
        expect(result.reasons.length).toBeGreaterThan(0);
        break;
      }
    }
  });
});

describe('signals.ts — detectSellSignal', () => {
  it('returns no signal when data is insufficient', async () => {
    const { detectSellSignal } = await import('../utils/signals');
    expect(detectSellSignal(genCandles(20)).signal).toBe(false);
  });

  it('rejects sell in bull trend', async () => {
    const { detectSellSignal } = await import('../utils/signals');
    expect(detectSellSignal(genBullCandles(80)).signal).toBe(false);
  });

  it('score is numeric and non-negative', async () => {
    const { detectSellSignal } = await import('../utils/signals');
    const result = detectSellSignal(genBearCandles(80));
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  2. SMC MODULES
// ══════════════════════════════════════════════════════════════════════════════

describe('sfp.ts — detectSFP', () => {
  it('returns null when data is too short', async () => {
    const { detectSFP } = await import('../utils/sfp');
    expect(detectSFP(genCandles(10))).toBeNull();
  });

  it('detects top SFP: long upper wick past swing high, closes inside', async () => {
    const { detectSFP } = await import('../utils/sfp');
    const base = genCandles(25, 100);
    // Create a clear swing high then SFP
    const swingHigh = Math.max(...base.map(c => c.high));
    const data = appendSFPCandle(base, swingHigh);
    const result = detectSFP(data);
    if (result) {
      expect(result.type).toBe('top');
      expect(result.strength).toBeGreaterThan(0);
      expect(result.strength).toBeLessThanOrEqual(35);
      expect(result.wick).toBeGreaterThan(0);
    }
  });

  it('strength is between 0 and 35', async () => {
    const { detectSFP } = await import('../utils/sfp');
    for (let i = 0; i < 5; i++) {
      const result = detectSFP(genCandles(30));
      if (result) {
        expect(result.strength).toBeGreaterThanOrEqual(0);
        expect(result.strength).toBeLessThanOrEqual(35);
      }
    }
  });
});

describe('choch.ts — detectCHOCH', () => {
  it('returns null when data is too short', async () => {
    const { detectCHOCH } = await import('../utils/choch');
    expect(detectCHOCH(genCandles(5), 'top')).toBeNull();
  });

  it('SFP top → CHOCH should confirm bearish structure (type=top)', async () => {
    const { detectCHOCH } = await import('../utils/choch');
    // After SFP at top, CHOCH should look for downside structure
    const data = genBearCandles(20);
    const result = detectCHOCH(data, 'top');
    if (result) {
      // Fixed in our QA: SFP top → CHOCH type = 'top' (bearish confirmation)
      expect(result.type).toBe('top');
      expect(result.strength).toBeGreaterThan(0);
      expect(result.strength).toBeLessThanOrEqual(30);
    }
  });

  it('SFP bottom → CHOCH should confirm bullish structure (type=bottom)', async () => {
    const { detectCHOCH } = await import('../utils/choch');
    const data = genBullCandles(20);
    const result = detectCHOCH(data, 'bottom');
    if (result) {
      expect(result.type).toBe('bottom');
    }
  });
});

describe('cvd.ts — detectCVDBreach', () => {
  it('returns null when data is too short', async () => {
    const { detectCVDBreach } = await import('../utils/cvd');
    expect(detectCVDBreach(genCandles(10))).toBeNull();
  });

  it('strength is between 0 and 20', async () => {
    const { detectCVDBreach } = await import('../utils/cvd');
    for (let i = 0; i < 10; i++) {
      const result = detectCVDBreach(genCandles(25));
      if (result) {
        expect(result.strength).toBeGreaterThanOrEqual(0);
        expect(result.strength).toBeLessThanOrEqual(20);
      }
    }
  });

  it('type is either top or bottom', async () => {
    const { detectCVDBreach } = await import('../utils/cvd');
    for (let i = 0; i < 10; i++) {
      const result = detectCVDBreach(genCandles(25));
      if (result) {
        expect(['top', 'bottom']).toContain(result.type);
      }
    }
  });
});

describe('fvg.ts — detectFVG & calculateATR', () => {
  it('calculateATR returns 0 when data is too short', async () => {
    const { calculateATR } = await import('../utils/fvg');
    expect(calculateATR(genCandles(5))).toBe(0);
  });

  it('calculateATR returns positive value with sufficient data', async () => {
    const { calculateATR } = await import('../utils/fvg');
    const atr = calculateATR(genCandles(30));
    expect(atr).toBeGreaterThan(0);
  });

  it('calculateATRPercent is between 0 and 100', async () => {
    const { calculateATRPercent } = await import('../utils/fvg');
    const pct = calculateATRPercent(genCandles(30));
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThan(100);
  });

  it('detectFVG returns array', async () => {
    const { detectFVG } = await import('../utils/fvg');
    const fvgs = detectFVG(genCandles(20));
    expect(Array.isArray(fvgs)).toBe(true);
  });

  it('FVG strength is between 0 and 15', async () => {
    const { detectFVG } = await import('../utils/fvg');
    const fvgs = detectFVG(genCandles(40));
    fvgs.forEach(f => {
      expect(f.strength).toBeGreaterThanOrEqual(0);
      expect(f.strength).toBeLessThanOrEqual(15);
      expect(['bullish','bearish']).toContain(f.type);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  3. PREDICTION ENGINE
// ══════════════════════════════════════════════════════════════════════════════

describe('prediction.ts — predictTopBottom', () => {
  it('returns neutral when data insufficient (<65 bars)', async () => {
    const { predictTopBottom } = await import('../utils/prediction');
    const result = predictTopBottom(genCandles(30));
    expect(result.type).toBe('neutral');
    expect(result.probability).toBe(0);
  });

  it('probability is always between 0 and 1', async () => {
    const { predictTopBottom } = await import('../utils/prediction');
    for (let i = 0; i < 5; i++) {
      const result = predictTopBottom(genCandles(80));
      expect(result.probability).toBeGreaterThanOrEqual(0);
      expect(result.probability).toBeLessThanOrEqual(1);
    }
  });

  it('signals array is always an array', async () => {
    const { predictTopBottom } = await import('../utils/prediction');
    const result = predictTopBottom(genCandles(80));
    expect(Array.isArray(result.signals)).toBe(true);
  });

  it('type is one of top/bottom/neutral', async () => {
    const { predictTopBottom } = await import('../utils/prediction');
    const result = predictTopBottom(genCandles(80));
    expect(['top','bottom','neutral']).toContain(result.type);
  });

  it('neutral result has empty/zero probability', async () => {
    const { predictTopBottom } = await import('../utils/prediction');
    const result = predictTopBottom(genCandles(80));
    if (result.type === 'neutral') {
      expect(result.probability).toBe(0);
    }
  });

  it('non-neutral result has probability > 0', async () => {
    const { predictTopBottom } = await import('../utils/prediction');
    // Try to get a non-neutral result
    for (let i = 0; i < 10; i++) {
      const result = predictTopBottom(genCandles(90, 100 + i * 5));
      if (result.type !== 'neutral') {
        expect(result.probability).toBeGreaterThan(0);
        break;
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  4. TRADING SIMULATOR
// ══════════════════════════════════════════════════════════════════════════════

describe('tradingSimulator — account management', () => {
  let simulator: any;

  beforeEach(async () => {
    // Reset localStorage mock and create fresh instance
    vi.stubGlobal('localStorage', makeLocalStorageMock());
    vi.resetModules();
    const mod = await import('../services/tradingSimulator');
    simulator = mod.tradingSimulator;
    await simulator.reset(100_000);
  });

  it('initial balance is 100,000 after reset', async () => {
    const acc = simulator.getAccount();
    expect(acc.balance).toBeCloseTo(100_000, 0);
    expect(acc.initialBalance).toBe(100_000);
  });

  it('buy reduces balance by trade total + fee', async () => {
    const before = simulator.getAccount().balance;
    const result = await simulator.executeTrade({ symbol:'BTC', type:'buy', price:50_000, reason:'test', confidence:80 }, 0.1);
    expect(result.success).toBe(true);
    const after = simulator.getAccount().balance;
    const expected = before - 50_000 * 0.1 * 1.001; // total + 0.1% fee
    expect(after).toBeCloseTo(expected, 0);
  });

  it('sell closes position and returns funds', async () => {
    await simulator.executeTrade({ symbol:'BTC', type:'buy', price:50_000, reason:'test', confidence:80 }, 0.1);
    const midBalance = simulator.getAccount().balance;
    const result = await simulator.executeTrade({ symbol:'BTC', type:'sell', price:55_000, reason:'test', confidence:80 }, 0.1);
    expect(result.success).toBe(true);
    const finalBalance = simulator.getAccount().balance;
    expect(finalBalance).toBeGreaterThan(midBalance); // sold at profit
  });

  it('sell fails when no position exists', async () => {
    const result = await simulator.executeTrade({ symbol:'AAPL', type:'sell', price:150, reason:'test', confidence:80 }, 10);
    expect(result.success).toBe(false);
    expect(result.message).toContain('No open');
  });

  it('buy fails when insufficient balance', async () => {
    const result = await simulator.executeTrade({ symbol:'BTC', type:'buy', price:200_000, reason:'test', confidence:80 }, 10);
    expect(result.success).toBe(false);
  });

  it('price=0 returns error', async () => {
    const result = await simulator.executeTrade({ symbol:'BTC', type:'buy', price:0, reason:'test', confidence:80 }, 1);
    expect(result.success).toBe(false);
  });

  it('position is recorded with stop-loss and take-profit', async () => {
    await simulator.executeTrade({ symbol:'BTC', type:'buy', price:50_000, reason:'test', confidence:80, atr:1000 }, 0.1);
    const positions = simulator.getPositions();
    expect(positions.length).toBe(1);
    const pos = positions[0];
    expect(pos.stopLoss).toBeCloseTo(50_000 - 1000 * 2, 0); // ATR_STOP_MULT = 2
    expect(pos.takeProfit).toBeCloseTo(50_000 + 1000 * 3, 0); // ATR_PROFIT_MULT = 3
  });

  it('P&L is calculated correctly on sell', async () => {
    await simulator.executeTrade({ symbol:'BTC', type:'buy', price:50_000, reason:'test', confidence:80 }, 0.1);
    await simulator.executeTrade({ symbol:'BTC', type:'sell', price:60_000, reason:'test', confidence:80 }, 0.1);
    const trades = simulator.getTrades();
    const sellTrade = trades.find((t: any) => t.side === 'sell');
    expect(sellTrade).toBeDefined();
    expect(sellTrade.pnl).toBeGreaterThan(0);
    expect(sellTrade.pnl).toBeCloseTo(60_000 * 0.1 - 50_000 * 0.1 - 60_000 * 0.1 * 0.001, 0);
  });

  it('stop-loss check triggers sell at correct price', async () => {
    await simulator.executeTrade({ symbol:'BTC', type:'buy', price:50_000, reason:'test', confidence:80, atr:1000 }, 0.1);
    const pos = simulator.getPositions()[0];
    const slPrice = pos.stopLoss - 100; // below stop
    const triggered = await simulator.checkStopLossTakeProfit(new Map([['BTC', slPrice]]));
    expect(triggered.length).toBe(1);
    expect(triggered[0]).toContain('Stop triggered');
    expect(simulator.getPositions().length).toBe(0);
  });

  it('take-profit check triggers sell at correct price', async () => {
    await simulator.executeTrade({ symbol:'BTC', type:'buy', price:50_000, reason:'test', confidence:80, atr:1000 }, 0.1);
    const pos = simulator.getPositions()[0];
    const tpPrice = pos.takeProfit + 100; // above TP
    const triggered = await simulator.checkStopLossTakeProfit(new Map([['BTC', tpPrice]]));
    expect(triggered.length).toBe(1);
    expect(triggered[0]).toContain('Target triggered');
  });

  it('totalValue = balance + positions value', async () => {
    await simulator.executeTrade({ symbol:'BTC', type:'buy', price:50_000, reason:'test', confidence:80 }, 0.1);
    const prices = new Map([['BTC', 55_000]]);
    const acc = simulator.getAccount(prices);
    const expected = acc.balance + 0.1 * 55_000;
    expect(acc.totalValue).toBeCloseTo(expected, 0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  5. BACKTEST STATS
// ══════════════════════════════════════════════════════════════════════════════

describe('backtestStats.ts — calcTradeStats', () => {
  it('returns null when no closed trades', async () => {
    const { calcTradeStats } = await import('../services/backtestStats');
    expect(calcTradeStats([])).toBeNull();
  });

  it('returns null for trades with no pnl (open positions)', async () => {
    const { calcTradeStats } = await import('../services/backtestStats');
    const fakeTrades = [{ id:1, symbol:'BTC', side:'buy' as const, quantity:1, price:50000, total:50000, fee:50, date:Date.now() }];
    expect(calcTradeStats(fakeTrades)).toBeNull();
  });

  it('win rate is correct for known wins/losses', async () => {
    const { calcTradeStats } = await import('../services/backtestStats');
    const trades = [
      { id:1, symbol:'A', side:'sell' as const, quantity:1, price:110, total:110, fee:0, date:Date.now(), pnl:10, pnlPercent:10 },
      { id:2, symbol:'B', side:'sell' as const, quantity:1, price:90,  total:90,  fee:0, date:Date.now(), pnl:-10, pnlPercent:-10 },
      { id:3, symbol:'C', side:'sell' as const, quantity:1, price:120, total:120, fee:0, date:Date.now(), pnl:20, pnlPercent:20 },
    ];
    const stats = calcTradeStats(trades);
    expect(stats).not.toBeNull();
    expect(stats!.winRate).toBeCloseTo(2/3, 5);
    expect(stats!.totalTrades).toBe(3);
    expect(stats!.winningTrades).toBe(2);
    expect(stats!.losingTrades).toBe(1);
  });

  it('profit factor = totalWin / totalLoss', async () => {
    const { calcTradeStats } = await import('../services/backtestStats');
    const trades = [
      { id:1, symbol:'A', side:'sell' as const, quantity:1, price:100, total:100, fee:0, date:Date.now(), pnl:30, pnlPercent:30 },
      { id:2, symbol:'B', side:'sell' as const, quantity:1, price:100, total:100, fee:0, date:Date.now(), pnl:-10, pnlPercent:-10 },
    ];
    const stats = calcTradeStats(trades)!;
    expect(stats.profitFactor).toBeCloseTo(3, 5);
  });

  it('expectancy = totalPnL / tradeCount', async () => {
    const { calcTradeStats } = await import('../services/backtestStats');
    const trades = [
      { id:1, symbol:'A', side:'sell' as const, quantity:1, price:100, total:100, fee:0, date:Date.now(), pnl:20, pnlPercent:20 },
      { id:2, symbol:'B', side:'sell' as const, quantity:1, price:100, total:100, fee:0, date:Date.now(), pnl:-5, pnlPercent:-5 },
    ];
    const stats = calcTradeStats(trades)!;
    expect(stats.expectancy).toBeCloseTo(7.5, 5);
    expect(stats.totalPnL).toBeCloseTo(15, 5);
  });

  it('maxDrawdown is between 0 and 1', async () => {
    const { calcTradeStats } = await import('../services/backtestStats');
    const trades = Array.from({ length: 20 }, (_, i) => ({
      id: i+1, symbol:'A', side:'sell' as const, quantity:1,
      price:100, total:100, fee:0, date:Date.now()+(i*1000),
      pnl: i % 3 === 0 ? -20 : 10, pnlPercent: i%3===0 ? -20 : 10,
    }));
    const stats = calcTradeStats(trades)!;
    expect(stats.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(stats.maxDrawdown).toBeLessThanOrEqual(1);
  });

  it('exit reason counts are correct', async () => {
    const { calcTradeStats } = await import('../services/backtestStats');
    const trades = [
      { id:1, symbol:'A', side:'sell' as const, quantity:1, price:100, total:100, fee:0, date:Date.now(), pnl:10, pnlPercent:10, exitReason:'stop_loss' as const },
      { id:2, symbol:'B', side:'sell' as const, quantity:1, price:100, total:100, fee:0, date:Date.now(), pnl:20, pnlPercent:20, exitReason:'take_profit' as const },
      { id:3, symbol:'C', side:'sell' as const, quantity:1, price:100, total:100, fee:0, date:Date.now(), pnl:-5, pnlPercent:-5, exitReason:'stop_loss' as const },
    ];
    const stats = calcTradeStats(trades)!;
    expect(stats.byExitReason.stop_loss.count).toBe(2);
    expect(stats.byExitReason.take_profit.count).toBe(1);
  });

  it('runPluginBacktest computes plugin win rate for directional signals', async () => {
    const { runPluginBacktest } = await import('../services/backtestStats');

    const data = Array.from({ length: 25 }, (_, i) => ({
      symbol: 'TEST',
      name: 'Test',
      price: 100 + i,
      close: 100 + i,
      open: 99 + i,
      high: 101 + i,
      low: 98 + i,
      volume: 1000 + i,
      change: 1,
      changePercent: 1,
      timestamp: i * 60_000,
      source: 'mock' as const,
    }));

    const plugin = {
      id: 'always-buy',
      name: 'Always Buy',
      version: '1.0.0',
      description: 'test',
      author: 'test',
      analyze(window: typeof data) {
        const price = window[window.length - 1].close;
        return {
          symbol: 'TEST',
          price,
          indicators: {} as any,
          buySignal: { signal: true, level: 'high' as const, score: 80, reasons: ['trend up'] },
          sellSignal: { signal: false, level: null, score: 0, reasons: [] },
          prediction: { type: 'neutral' as const, probability: 0, signals: [], recommendation: 'n/a' },
          pluginId: 'always-buy',
          computedAt: Date.now(),
          metadata: {},
        };
      },
    };

    const result = runPluginBacktest(plugin as any, 'TEST', data, {
      lookbackBars: 10,
      holdBars: 2,
      includePredictions: false,
      minSignalScore: 55,
    });

    expect(result.stats.totalSignals).toBe(13);
    expect(result.stats.winRate).toBe(1);
    expect(result.stats.byType.buy.count).toBe(13);
    expect(result.stats.byType.buy.winRate).toBe(1);
  });

  it('rankPluginsByBacktest sorts plugins by win rate then avg return', async () => {
    const { rankPluginsByBacktest } = await import('../services/backtestStats');

    const data = Array.from({ length: 30 }, (_, i) => ({
      symbol: 'TEST',
      name: 'Test',
      price: 100 + i,
      close: 100 + i,
      open: 99 + i,
      high: 101 + i,
      low: 98 + i,
      volume: 1000 + i,
      change: 1,
      changePercent: 1,
      timestamp: i * 60_000,
      source: 'mock' as const,
    }));

    const buyPlugin = {
      id: 'buy', name: 'Buy', version: '1.0.0', description: 'test', author: 'test',
      analyze(window: typeof data) {
        const price = window[window.length - 1].close;
        return {
          symbol: 'TEST', price, indicators: {} as any,
          buySignal: { signal: true, level: 'high' as const, score: 85, reasons: ['buy'] },
          sellSignal: { signal: false, level: null, score: 0, reasons: [] },
          prediction: { type: 'neutral' as const, probability: 0, signals: [], recommendation: 'n/a' },
          pluginId: 'buy', computedAt: Date.now(), metadata: {},
        };
      },
    };

    const sellPlugin = {
      id: 'sell', name: 'Sell', version: '1.0.0', description: 'test', author: 'test',
      analyze(window: typeof data) {
        const price = window[window.length - 1].close;
        return {
          symbol: 'TEST', price, indicators: {} as any,
          buySignal: { signal: false, level: null, score: 0, reasons: [] },
          sellSignal: { signal: true, level: 'high' as const, score: 85, reasons: ['sell'] },
          prediction: { type: 'neutral' as const, probability: 0, signals: [], recommendation: 'n/a' },
          pluginId: 'sell', computedAt: Date.now(), metadata: {},
        };
      },
    };

    const ranked = rankPluginsByBacktest('TEST', data, {
      lookbackBars: 10,
      holdBars: 2,
      includePredictions: false,
      minSignalScore: 55,
    }, [sellPlugin as any, buyPlugin as any]);

    expect(ranked).toHaveLength(2);
    expect(ranked[0].pluginId).toBe('buy');
    expect(ranked[0].stats.winRate).toBeGreaterThan(ranked[1].stats.winRate);
  });

  it('runPluginTradeBacktest produces closed-trade statistics', async () => {
    const { runPluginTradeBacktest } = await import('../services/backtestStats');

    const data = Array.from({ length: 40 }, (_, i) => ({
      symbol: 'TEST',
      name: 'Test',
      price: 100 + i,
      close: 100 + i,
      open: 99 + i,
      high: 101 + i,
      low: 98 + i,
      volume: 1000 + i,
      change: 1,
      changePercent: 1,
      timestamp: i * 60_000,
      source: 'mock' as const,
    }));

    const plugin = {
      id: 'trade-buy',
      name: 'Trade Buy',
      version: '1.0.0',
      description: 'test',
      author: 'test',
      analyze(window: typeof data) {
        const price = window[window.length - 1].close;
        return {
          symbol: 'TEST',
          price,
          indicators: {} as any,
          buySignal: { signal: true, level: 'high' as const, score: 85, reasons: ['buy'] },
          sellSignal: { signal: false, level: null, score: 0, reasons: [] },
          prediction: { type: 'neutral' as const, probability: 0, signals: [], recommendation: 'n/a' },
          pluginId: 'trade-buy',
          computedAt: Date.now(),
          metadata: {},
        };
      },
    };

    const result = runPluginTradeBacktest(plugin as any, 'TEST', data, {
      lookbackBars: 10,
      positionPct: 0.2,
      stopMultiplier: 1,
      profitMultiplier: 2,
      allowShort: false,
      includePredictions: false,
    });

    expect(result.tradeStats).not.toBeNull();
    expect(result.tradeStats!.totalTrades).toBeGreaterThan(0);
    expect(result.tradeStats!.winRate).toBeGreaterThan(0);
    expect(result.totalReturnPct).toBeGreaterThan(0);
  });

  it('rankPluginsByTradeBacktest sorts by trade performance', async () => {
    const { rankPluginsByTradeBacktest } = await import('../services/backtestStats');

    const data = Array.from({ length: 40 }, (_, i) => ({
      symbol: 'TEST',
      name: 'Test',
      price: 100 + i,
      close: 100 + i,
      open: 99 + i,
      high: 101 + i,
      low: 98 + i,
      volume: 1000 + i,
      change: 1,
      changePercent: 1,
      timestamp: i * 60_000,
      source: 'mock' as const,
    }));

    const buyPlugin = {
      id: 'trade-buy', name: 'Trade Buy', version: '1.0.0', description: 'test', author: 'test',
      analyze(window: typeof data) {
        const price = window[window.length - 1].close;
        return {
          symbol: 'TEST', price, indicators: {} as any,
          buySignal: { signal: true, level: 'high' as const, score: 85, reasons: ['buy'] },
          sellSignal: { signal: false, level: null, score: 0, reasons: [] },
          prediction: { type: 'neutral' as const, probability: 0, signals: [], recommendation: 'n/a' },
          pluginId: 'trade-buy', computedAt: Date.now(), metadata: {},
        };
      },
    };

    const shortPlugin = {
      id: 'trade-short', name: 'Trade Short', version: '1.0.0', description: 'test', author: 'test',
      analyze(window: typeof data) {
        const price = window[window.length - 1].close;
        return {
          symbol: 'TEST', price, indicators: {} as any,
          buySignal: { signal: false, level: null, score: 0, reasons: [] },
          sellSignal: { signal: true, level: 'high' as const, score: 85, reasons: ['sell'] },
          prediction: { type: 'neutral' as const, probability: 0, signals: [], recommendation: 'n/a' },
          pluginId: 'trade-short', computedAt: Date.now(), metadata: {},
        };
      },
    };

    const ranked = rankPluginsByTradeBacktest('TEST', data, {
      lookbackBars: 10,
      positionPct: 0.2,
      stopMultiplier: 1,
      profitMultiplier: 2,
      includePredictions: false,
    }, [shortPlugin as any, buyPlugin as any]);

    expect(ranked).toHaveLength(2);
    expect(ranked[0].pluginId).toBe('trade-buy');
    expect(ranked[0].tradeStats?.totalPnL ?? 0).toBeGreaterThan(ranked[1].tradeStats?.totalPnL ?? 0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  6. AUTO TRADE SERVICE
// ══════════════════════════════════════════════════════════════════════════════

describe('autoTradeService — configuration', () => {
  it('starts disabled by default (fresh localStorage)', async () => {
    vi.stubGlobal('localStorage', makeLocalStorageMock());
    vi.resetModules();
    const { autoTradeService } = await import('../services/autoTradeService');
    expect(autoTradeService.getConfig().enabled).toBe(false);
  });

  it('setEnabled persists to localStorage', async () => {
    const lsMock: Record<string,string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => lsMock[k] ?? null,
      setItem: (k: string, v: string) => { lsMock[k] = v; },
      removeItem: (k: string) => { delete lsMock[k]; },
    });
    vi.resetModules();
    const { autoTradeService } = await import('../services/autoTradeService');
    autoTradeService.setEnabled(true);
    expect(lsMock['auto_trade_config_v3']).toBeDefined();
    expect(JSON.parse(lsMock['auto_trade_config_v3']).enabled).toBe(true);
  });

  it('meetsLevel: high > medium > any', async () => {
    const lsMock: Record<string,string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => lsMock[k] ?? null,
      setItem: (k: string, v: string) => { lsMock[k] = v; },
      removeItem: (k: string) => { delete lsMock[k]; },
    });
    vi.resetModules();
    const { autoTradeService } = await import('../services/autoTradeService');
    // With minLevel='medium': high and medium signals pass, low does not
    autoTradeService.updateConfig({ minLevel: 'medium' });
    // Access private method via cast
    const svc = autoTradeService as any;
    expect(svc.meetsLevel('high')).toBe(true);
    expect(svc.meetsLevel('medium')).toBe(true);
    expect(svc.meetsLevel('low')).toBe(false);
    expect(svc.meetsLevel(null)).toBe(false);
  });

  it('setAllSymbols enables/disables all at once', async () => {
    const lsMock: Record<string,string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => lsMock[k] ?? null,
      setItem: (k: string, v: string) => { lsMock[k] = v; },
      removeItem: (k: string) => { delete lsMock[k]; },
    });
    vi.resetModules();
    const { autoTradeService } = await import('../services/autoTradeService');
    autoTradeService.setAllSymbols(['BTC','ETH','AAPL'], true);
    const cfg = autoTradeService.getConfig();
    expect(cfg.symbolsEnabled['BTC']).toBe(true);
    expect(cfg.symbolsEnabled['ETH']).toBe(true);
    expect(cfg.symbolsEnabled['AAPL']).toBe(true);

    autoTradeService.setAllSymbols(['BTC','ETH','AAPL'], false);
    const cfg2 = autoTradeService.getConfig();
    expect(Object.values(cfg2.symbolsEnabled).every(v => !v)).toBe(true);
  });

  it('clearExecutions also clears cooldown timers', async () => {
    const lsMock: Record<string,string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => lsMock[k] ?? null,
      setItem: (k: string, v: string) => { lsMock[k] = v; },
      removeItem: (k: string) => { delete lsMock[k]; },
    });
    vi.resetModules();
    const { autoTradeService } = await import('../services/autoTradeService');
    const svc = autoTradeService as any;
    svc.lastBuyTs.set('BTC', Date.now());
    expect(svc.lastBuyTs.size).toBe(1);
    autoTradeService.clearExecutions();
    expect(svc.lastBuyTs.size).toBe(0);
  });

  it('onMarketUpdate skips disabled symbols', async () => {
    const lsMock: Record<string,string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => lsMock[k] ?? null,
      setItem: (k: string, v: string) => { lsMock[k] = v; },
      removeItem: (k: string) => { delete lsMock[k]; },
    });
    vi.resetModules();
    const { autoTradeService } = await import('../services/autoTradeService');
    autoTradeService.setEnabled(true);
    // BTC disabled
    const mockAnalysis = new Map([['BTC', { price: 50000, buySignal: { signal: true, level: 'high' as const, score: 80, reasons: ['test'] }, sellSignal: { signal:false, level:null, score:0, reasons:[] }, prediction: { type:'neutral' as const, probability:0, signals:[], recommendation:'' }, indicators: {} as any, symbol:'BTC' }]]);
    await autoTradeService.onMarketUpdate(mockAnalysis);
    expect(autoTradeService.getExecutions().length).toBe(0); // symbol not enabled
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  7. SIMULATED USERS
// ══════════════════════════════════════════════════════════════════════════════

describe('simulatedUsers — service', () => {
  it('5 default users are loaded', async () => {
    vi.stubGlobal('localStorage', makeLocalStorageMock());
    vi.resetModules();
    const { simulatedUserService } = await import('../services/simulatedUsers');
    expect(simulatedUserService.getStates().length).toBe(5);
  });

  it('each user has a unique id', async () => {
    vi.stubGlobal('localStorage', makeLocalStorageMock());
    vi.resetModules();
    const { simulatedUserService } = await import('../services/simulatedUsers');
    const ids = simulatedUserService.getStates().map(s => s.user.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('getRanking sorts by pnlPct descending', async () => {
    vi.stubGlobal('localStorage', makeLocalStorageMock());
    vi.resetModules();
    const { simulatedUserService } = await import('../services/simulatedUsers');
    const ranking = simulatedUserService.getRanking(new Map());
    for (let i = 1; i < ranking.length; i++) {
      expect(ranking[i-1].pnlPct).toBeGreaterThanOrEqual(ranking[i].pnlPct);
    }
  });

  it('setUserSymbols filters onMarketUpdate correctly', async () => {
    vi.stubGlobal('localStorage', makeLocalStorageMock());
    vi.resetModules();
    const { simulatedUserService } = await import('../services/simulatedUsers');
    const firstUser = simulatedUserService.getStates()[0];
    simulatedUserService.setUserSymbols(firstUser.user.id, ['BTC']);
    const updated = simulatedUserService.getState(firstUser.user.id);
    expect(updated?.allowedSymbols).toEqual(['BTC']);
  });

  it('resetUser clears trades and positions', async () => {
    vi.stubGlobal('localStorage', makeLocalStorageMock());
    vi.resetModules();
    const { simulatedUserService } = await import('../services/simulatedUsers');
    const firstUser = simulatedUserService.getStates()[0];
    simulatedUserService.resetUser(firstUser.user.id);
    const state = simulatedUserService.getState(firstUser.user.id)!;
    expect(state.trades.length).toBe(0);
    expect(state.positions.size).toBe(0);
  });

  it('contrarian user strategy has contrarian=true', async () => {
    vi.stubGlobal('localStorage', makeLocalStorageMock());
    vi.resetModules();
    const { simulatedUserService } = await import('../services/simulatedUsers');
    const contrarian = simulatedUserService.getStates().find(s => s.user.id === 'contrarian_zhou');
    expect(contrarian?.user.strategy.contrarian).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  8. PRICE DISPLAY PRECISION
// ══════════════════════════════════════════════════════════════════════════════

describe('price display precision', () => {
  it('BTC at 84325.50 shows 2 decimals', () => {
    expect(fmtPrice(84325.50)).toBe('84325.50');
  });

  it('ETH at 3245.80 shows 2 decimals', () => {
    expect(fmtPrice(3245.80)).toBe('3245.80');
  });

  it('DOGE at 0.15 shows 4 decimals', () => {
    expect(fmtPrice(0.15)).toBe('0.1500');
  });

  it('sub-cent token at 0.005 shows 6 decimals', () => {
    expect(fmtPrice(0.005)).toBe('0.005000');
  });

  it('SHIB at 0.00002 shows 8 decimals (not 0.0000)', () => {
    const display = fmtPrice(0.00002);
    expect(display).toBe('0.00002000');
    expect(display).not.toBe('0.0000');
  });

  it('mid-price AAPL at 189.45 shows 2 decimals', () => {
    expect(fmtPrice(189.45)).toBe('189.45');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  9. INDICATOR CALCULATIONS
// ══════════════════════════════════════════════════════════════════════════════

describe('indicators.ts — calculateAllIndicators', () => {
  it('returns object with expected fields', async () => {
    const { calculateAllIndicators } = await import('../utils/indicators');
    const ind = calculateAllIndicators(genCandles(80));
    expect(typeof ind.ema9).toBe('number');
    expect(typeof ind.ema21).toBe('number');
    expect(typeof ind.rsi14).toBe('number');
    expect(typeof ind.adx).toBe('number');
    expect(typeof ind.bollWidth).toBe('number');
    expect(typeof ind.poc).toBe('number');
    expect(typeof ind.rsiBullDiv).toBe('boolean');
    expect(typeof ind.rsiBearDiv).toBe('boolean');
    expect(typeof ind.bollSqueezing).toBe('boolean');
  });

  it('RSI is between 0 and 100', async () => {
    const { calculateAllIndicators } = await import('../utils/indicators');
    for (let i = 0; i < 5; i++) {
      const ind = calculateAllIndicators(genCandles(80));
      expect(ind.rsi9).toBeGreaterThanOrEqual(0);
      expect(ind.rsi9).toBeLessThanOrEqual(100);
      expect(ind.rsi14).toBeGreaterThanOrEqual(0);
      expect(ind.rsi14).toBeLessThanOrEqual(100);
    }
  });

  it('ADX is non-negative', async () => {
    const { calculateAllIndicators } = await import('../utils/indicators');
    const ind = calculateAllIndicators(genCandles(80));
    expect(ind.adx).toBeGreaterThanOrEqual(0);
  });

  it('bollUp >= bollMb >= bollDn', async () => {
    const { calculateAllIndicators } = await import('../utils/indicators');
    for (let i = 0; i < 5; i++) {
      const ind = calculateAllIndicators(genCandles(80));
      if (ind.bollUp > 0) {
        expect(ind.bollUp).toBeGreaterThanOrEqual(ind.bollMb);
        expect(ind.bollMb).toBeGreaterThanOrEqual(ind.bollDn);
      }
    }
  });

  it('EMA9 reacts faster than EMA21 in bull trend', async () => {
    const { calculateAllIndicators } = await import('../utils/indicators');
    const bull = calculateAllIndicators(genBullCandles(80));
    // In uptrend, EMA9 should be above EMA21
    // Not always true immediately, but on prolonged uptrend it should be
    // This is a statistical test - run multiple times
    let bullCount = 0;
    for (let i = 0; i < 5; i++) {
      const ind = calculateAllIndicators(genBullCandles(100));
      if (ind.ema9 > ind.ema21) bullCount++;
    }
    expect(bullCount).toBeGreaterThan(2); // most of the time
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  10. EDGE CASES & BOUNDARY CONDITIONS
// ══════════════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  it('all algorithms handle NaN price gracefully', async () => {
    const { detectBuySignal } = await import('../utils/signals');
    const badCandles = genCandles(80);
    badCandles[79] = { ...badCandles[79], price: NaN, close: NaN };
    expect(() => detectBuySignal(badCandles)).not.toThrow();
  });

  it('all algorithms handle 0-volume candles', async () => {
    const { detectBuySignal } = await import('../utils/signals');
    const noVol = genCandles(80).map(c => ({ ...c, volume: 0 }));
    const result = detectBuySignal(noVol);
    expect(typeof result.score).toBe('number');
  });

  it('prediction handles all-same-price candles', async () => {
    const { predictTopBottom } = await import('../utils/prediction');
    const flat = Array(80).fill(null).map((_, i) => ({
      symbol:'FLAT', name:'Flat', price:100, close:100, open:100, high:100, low:100,
      volume:100000, change:0, changePercent:0, timestamp: Date.now() - (80-i) * 3600000,
    }));
    expect(() => predictTopBottom(flat)).not.toThrow();
  });

  it('calcDrawdown handles single trade', async () => {
    const { calcTradeStats } = await import('../services/backtestStats');
    const single = [{ id:1, symbol:'A', side:'sell' as const, quantity:1, price:110, total:110, fee:0, date:Date.now(), pnl:10, pnlPercent:10 }];
    const stats = calcTradeStats(single);
    expect(stats).not.toBeNull();
    expect(stats!.maxDrawdown).toBeGreaterThanOrEqual(0);
  });

  it('price precision edge: exactly 100 uses 2 decimals', () => {
    expect(fmtPrice(100)).toBe('100.00');
    expect(fmtPrice(99.999)).toBe('99.9990');
  });
});
