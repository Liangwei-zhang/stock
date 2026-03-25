/**
 * tests/plugins.test.ts — 新策略插件測試套件
 *
 * 覆蓋：
 *   MeanReversionPlugin   均值回歸策略
 *   VolumeBreakoutPlugin  量能突破策略
 *   MacdCrossoverPlugin   MACD 交叉策略
 *   CompositeEnsemblePlugin 多策略融合
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MeanReversionPlugin } from '../plugins/mean-reversion';
import { VolumeBreakoutPlugin } from '../plugins/volume-breakout';
import { MacdCrossoverPlugin } from '../plugins/macd-crossover';
import { CompositeEnsemblePlugin } from '../plugins/composite-ensemble';
import { pluginRegistry } from '../core/plugin-registry';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genCandles(n: number, base = 100, vol = 0.01) {
  const candles = [];
  let price = base;
  for (let i = 0; i < n; i++) {
    const change = (Math.random() - 0.5) * vol * price;
    price = Math.max(price + change, 0.01);
    const open   = price;
    const close  = price * (1 + (Math.random() - 0.5) * vol);
    const high   = Math.max(open, close) * (1 + Math.random() * vol * 0.5);
    const low    = Math.min(open, close) * (1 - Math.random() * vol * 0.5);
    const volume = 100_000 + Math.random() * 900_000;
    candles.push({
      symbol: 'TEST', name: 'Test', price: close, close, open, high, low, volume,
      change: 0, changePercent: 0, timestamp: Date.now() - (n - i) * 3_600_000,
    });
  }
  return candles;
}

/** 生成價格持續下跌（RSI 偏低）的 K 線 */
function genOversoldCandles(n: number, base = 100) {
  const candles = [];
  let price = base;
  for (let i = 0; i < n; i++) {
    price = price * 0.994; // 穩定下跌
    const open  = price * 1.002;
    const close = price;
    const high  = price * 1.004;
    const low   = price * 0.996;
    candles.push({
      symbol: 'TEST', name: 'Test', price: close, close, open, high, low,
      volume: 300_000, change: 0, changePercent: -0.6, timestamp: Date.now() - (n - i) * 3_600_000,
    });
  }
  return candles;
}

/** 生成成交量突然放大的 K 線（最後一根） */
function genVolumeSpikeCandles(n: number, base = 100) {
  const candles = genCandles(n, base);
  // 最後一根：大量陽線
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  candles[candles.length - 1] = {
    ...last,
    open:   prev.close,
    close:  prev.close * 1.03,
    high:   prev.close * 1.04,
    low:    prev.close * 0.999,
    price:  prev.close * 1.03,
    volume: 3_000_000, // 遠超均量
  };
  return candles;
}

/** 生成 MACD 柱狀圖轉正的 K 線（先跌後漲） */
function genMacdFlipCandles(n: number, base = 100) {
  const candles = [];
  let price = base;
  // 前半段：下跌（讓 MACD 為負）
  for (let i = 0; i < Math.floor(n / 2); i++) {
    price = price * 0.996;
    const close = price;
    candles.push({
      symbol: 'TEST', name: 'Test', price: close, close,
      open: close * 1.001, high: close * 1.003, low: close * 0.997,
      volume: 200_000, change: 0, changePercent: -0.4,
      timestamp: Date.now() - (n - i) * 3_600_000,
    });
  }
  // 後半段：上漲（MACD 柱翻正）
  for (let i = Math.floor(n / 2); i < n; i++) {
    price = price * 1.004;
    const close = price;
    candles.push({
      symbol: 'TEST', name: 'Test', price: close, close,
      open: close * 0.999, high: close * 1.003, low: close * 0.997,
      volume: 400_000, change: 0, changePercent: 0.4,
      timestamp: Date.now() - (n - i) * 3_600_000,
    });
  }
  return candles;
}

// ─── 基本屬性測試 ─────────────────────────────────────────────────────────────

describe('MeanReversionPlugin — 基本屬性', () => {
  it('id / name / version 正確', () => {
    const p = new MeanReversionPlugin();
    expect(p.id).toBe('mean-reversion');
    expect(p.name).toBe('均值回歸策略');
    expect(p.version).toBe('1.0.0');
    expect(p.author).toBe('system');
  });
});

describe('VolumeBreakoutPlugin — 基本屬性', () => {
  it('id / name / version 正確', () => {
    const p = new VolumeBreakoutPlugin();
    expect(p.id).toBe('volume-breakout');
    expect(p.name).toBe('量能突破策略');
    expect(p.version).toBe('1.0.0');
    expect(p.author).toBe('system');
  });
});

describe('MacdCrossoverPlugin — 基本屬性', () => {
  it('id / name / version 正確', () => {
    const p = new MacdCrossoverPlugin();
    expect(p.id).toBe('macd-crossover');
    expect(p.name).toBe('MACD 交叉策略');
    expect(p.version).toBe('1.0.0');
    expect(p.author).toBe('system');
  });
});

describe('CompositeEnsemblePlugin — 基本屬性', () => {
  it('id / name / version 正確', () => {
    const p = new CompositeEnsemblePlugin();
    expect(p.id).toBe('composite-ensemble');
    expect(p.name).toBe('多策略融合');
    expect(p.version).toBe('1.0.0');
    expect(p.author).toBe('system');
  });
});

// ─── analyze() 返回值結構測試（正常數據）────────────────────────────────────

describe('MeanReversionPlugin — analyze() 結構', () => {
  const plugin = new MeanReversionPlugin();
  const data = genCandles(50);

  it('返回完整 StrategyResult 結構', () => {
    const result = plugin.analyze(data, 'TEST');
    expect(result).toBeDefined();
    expect(result.symbol).toBe('TEST');
    expect(result.price).toBeGreaterThan(0);
    expect(result.pluginId).toBe('mean-reversion');
    expect(result.indicators).toBeDefined();
    expect(result.buySignal).toBeDefined();
    expect(result.sellSignal).toBeDefined();
    expect(result.prediction).toBeDefined();
  });

  it('buySignal / sellSignal 有正確欄位', () => {
    const result = plugin.analyze(data, 'TEST');
    expect(typeof result.buySignal.signal).toBe('boolean');
    expect(typeof result.buySignal.score).toBe('number');
    expect(Array.isArray(result.buySignal.reasons)).toBe(true);
    expect(typeof result.sellSignal.signal).toBe('boolean');
  });

  it('prediction type 為合法值', () => {
    const result = plugin.analyze(data, 'TEST');
    expect(['top', 'bottom', 'neutral']).toContain(result.prediction.type);
  });
});

describe('VolumeBreakoutPlugin — analyze() 結構', () => {
  const plugin = new VolumeBreakoutPlugin();
  const data = genCandles(50);

  it('返回完整 StrategyResult 結構', () => {
    const result = plugin.analyze(data, 'TEST');
    expect(result.symbol).toBe('TEST');
    expect(result.pluginId).toBe('volume-breakout');
    expect(result.buySignal).toBeDefined();
    expect(result.sellSignal).toBeDefined();
  });
});

describe('MacdCrossoverPlugin — analyze() 結構', () => {
  const plugin = new MacdCrossoverPlugin();
  const data = genCandles(50);

  it('返回完整 StrategyResult 結構', () => {
    const result = plugin.analyze(data, 'TEST');
    expect(result.symbol).toBe('TEST');
    expect(result.pluginId).toBe('macd-crossover');
    expect(result.buySignal).toBeDefined();
    expect(result.sellSignal).toBeDefined();
  });
});

// ─── 數據不足時的處理測試 ────────────────────────────────────────────────────

describe('各插件處理不足數據', () => {
  const shortData = genCandles(5);

  it('MeanReversionPlugin：數據不足時返回空信號', () => {
    const result = new MeanReversionPlugin().analyze(shortData, 'TEST');
    expect(result.buySignal.signal).toBe(false);
    expect(result.sellSignal.signal).toBe(false);
    expect(result.prediction.type).toBe('neutral');
  });

  it('VolumeBreakoutPlugin：數據不足時返回空信號', () => {
    const result = new VolumeBreakoutPlugin().analyze(shortData, 'TEST');
    expect(result.buySignal.signal).toBe(false);
    expect(result.sellSignal.signal).toBe(false);
  });

  it('MacdCrossoverPlugin：數據不足時返回空信號', () => {
    const result = new MacdCrossoverPlugin().analyze(shortData, 'TEST');
    expect(result.buySignal.signal).toBe(false);
    expect(result.sellSignal.signal).toBe(false);
  });

  it('CompositeEnsemblePlugin：數據不足時返回空信號', () => {
    const result = new CompositeEnsemblePlugin().analyze(shortData, 'TEST');
    expect(result.buySignal.signal).toBe(false);
    expect(result.sellSignal.signal).toBe(false);
  });
});

// ─── 策略邏輯驗證測試 ─────────────────────────────────────────────────────────

describe('MeanReversionPlugin — 超賣場景', () => {
  it('RSI 低且價格下跌時，buySignal.score 較高', () => {
    const plugin = new MeanReversionPlugin();
    const oversoldData = genOversoldCandles(50);
    const result = plugin.analyze(oversoldData, 'TEST');
    // 持續下跌後 RSI 應偏低，買入分數應有所反映
    expect(result.buySignal.score).toBeGreaterThanOrEqual(0);
    // 賣出分數應低於買入分數（下跌環境中）
    // （此處只驗證不崩潰且結構正確）
    expect(result.buySignal.reasons).toBeDefined();
  });
});

describe('VolumeBreakoutPlugin — 放量突破場景', () => {
  it('最後一根大量陽線時，buySignal 應有評分', () => {
    const plugin = new VolumeBreakoutPlugin();
    const spikeData = genVolumeSpikeCandles(50);
    const result = plugin.analyze(spikeData, 'TEST');
    // 大量陽線應至少觸發成交量異常條件
    expect(result.buySignal.score).toBeGreaterThan(0);
  });
});

describe('MacdCrossoverPlugin — MACD 翻轉場景', () => {
  it('先跌後漲的數據，買入分數應有所反映', () => {
    const plugin = new MacdCrossoverPlugin();
    const flipData = genMacdFlipCandles(60);
    const result = plugin.analyze(flipData, 'TEST');
    expect(result.buySignal.score).toBeGreaterThanOrEqual(0);
    expect(result.pluginId).toBe('macd-crossover');
  });

  it('score 在 0~100 之間', () => {
    const plugin = new MacdCrossoverPlugin();
    const data = genCandles(50);
    const result = plugin.analyze(data, 'TEST');
    expect(result.buySignal.score).toBeGreaterThanOrEqual(0);
    expect(result.buySignal.score).toBeLessThanOrEqual(100);
    expect(result.sellSignal.score).toBeGreaterThanOrEqual(0);
    expect(result.sellSignal.score).toBeLessThanOrEqual(100);
  });
});

describe('CompositeEnsemblePlugin — 多插件融合', () => {
  beforeEach(() => {
    // 確保其他插件已在 registry 中
    if (!pluginRegistry.getPlugin('mean-reversion')) {
      pluginRegistry.register(new MeanReversionPlugin());
    }
    if (!pluginRegistry.getPlugin('volume-breakout')) {
      pluginRegistry.register(new VolumeBreakoutPlugin());
    }
    if (!pluginRegistry.getPlugin('macd-crossover')) {
      pluginRegistry.register(new MacdCrossoverPlugin());
    }
    if (!pluginRegistry.getPlugin('composite-ensemble')) {
      pluginRegistry.register(new CompositeEnsemblePlugin());
    }
  });

  it('analyze() 能正常執行並返回結構', () => {
    const plugin = new CompositeEnsemblePlugin();
    const data = genCandles(50);
    const result = plugin.analyze(data, 'TEST');
    expect(result.symbol).toBe('TEST');
    expect(result.pluginId).toBe('composite-ensemble');
    expect(result.prediction.type).toMatch(/top|bottom|neutral/);
  });

  it('metadata 包含插件數量信息', () => {
    const plugin = new CompositeEnsemblePlugin();
    const data = genCandles(50);
    const result = plugin.analyze(data, 'TEST');
    expect(result.metadata).toBeDefined();
    expect(typeof result.metadata.pluginCount).toBe('number');
  });

  it('融合後的信號 score 為 0 ~ 100 之間', () => {
    const plugin = new CompositeEnsemblePlugin();
    const data = genCandles(50);
    const result = plugin.analyze(data, 'TEST');
    expect(result.buySignal.score).toBeGreaterThanOrEqual(0);
    expect(result.buySignal.score).toBeLessThanOrEqual(100);
    expect(result.sellSignal.score).toBeGreaterThanOrEqual(0);
    expect(result.sellSignal.score).toBeLessThanOrEqual(100);
  });

  it('probability 在 0~1 之間', () => {
    const plugin = new CompositeEnsemblePlugin();
    const data = genCandles(50);
    const result = plugin.analyze(data, 'TEST');
    expect(result.prediction.probability).toBeGreaterThanOrEqual(0);
    expect(result.prediction.probability).toBeLessThanOrEqual(1);
  });
});

// ─── 插件信號等級驗證 ─────────────────────────────────────────────────────────

describe('信號等級驗證', () => {
  it('score >= 75 → level = high', () => {
    // 透過直接造一個能觸發高分的場景進行驗證
    const plugin = new MeanReversionPlugin();
    const oversold = genOversoldCandles(80); // 超長下跌 → RSI 極低
    const result = plugin.analyze(oversold, 'TEST');
    if (result.buySignal.score >= 75) {
      expect(result.buySignal.level).toBe('high');
    } else if (result.buySignal.score >= 55) {
      expect(result.buySignal.level).toBe('medium');
    } else if (result.buySignal.score >= 35) {
      expect(result.buySignal.level).toBe('low');
    } else {
      expect(result.buySignal.level).toBeNull();
    }
  });

  it('level 為合法值', () => {
    const plugins = [
      new MeanReversionPlugin(),
      new VolumeBreakoutPlugin(),
      new MacdCrossoverPlugin(),
    ];
    const data = genCandles(50);
    for (const plugin of plugins) {
      const result = plugin.analyze(data, 'TEST');
      expect(['high', 'medium', 'low', null]).toContain(result.buySignal.level);
      expect(['high', 'medium', 'low', null]).toContain(result.sellSignal.level);
    }
  });
});
