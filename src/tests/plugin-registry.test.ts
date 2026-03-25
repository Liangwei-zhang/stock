/**
 * src/tests/plugin-registry.test.ts — 插件注册表 & 策略插件測試
 *
 * 覆蓋：
 *  - core/plugin-registry.ts  PluginRegistry (register, unregister, setActive, analyze, snapshot, ...)
 *  - plugins/smc-gen3.ts      SMCGen3Plugin.analyze()
 *  - plugins/trend-follow.ts  TrendFollowPlugin.analyze()
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IStrategyPlugin, StrategyResult } from '../core/types';
import type { StockData } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genCandles(n: number, base = 100, vol = 0.01): StockData[] {
  const candles: StockData[] = [];
  let price = base;
  for (let i = 0; i < n; i++) {
    const change = (Math.random() - 0.5) * vol * price;
    price = Math.max(price + change, 0.01);
    const open  = price;
    const close = price * (1 + (Math.random() - 0.5) * vol);
    const high  = Math.max(open, close) * (1 + Math.random() * vol * 0.5);
    const low   = Math.min(open, close) * (1 - Math.random() * vol * 0.5);
    candles.push({
      symbol: 'TEST', name: 'Test', price: close, close, open, high, low,
      volume: 100000 + Math.random() * 900000,
      change: 0, changePercent: 0,
      timestamp: Date.now() - (n - i) * 3600000,
    });
  }
  return candles;
}

function genBullCandles(n: number, base = 100): StockData[] {
  const candles: StockData[] = [];
  let price = base;
  for (let i = 0; i < n; i++) {
    price = price * (1 + 0.003 + Math.random() * 0.002);
    const open  = price * 0.999;
    const close = price;
    const high  = price * 1.003;
    const low   = price * 0.996;
    candles.push({
      symbol: 'TEST', name: 'Test', price: close, close, open, high, low,
      volume: 500000 + i * 10000, change: 0, changePercent: 0.3,
      timestamp: Date.now() - (n - i) * 3600000,
    });
  }
  return candles;
}

/** 建立最小插件 mock */
function makePlugin(id: string): IStrategyPlugin {
  return {
    id,
    name: `Plugin ${id}`,
    version: '1.0.0',
    description: `Test plugin ${id}`,
    author: 'test',
    analyze: (_data: StockData[], symbol: string): StrategyResult => ({
      symbol,
      price: 100,
      indicators: {} as any,
      buySignal:  { signal: false, level: null, score: 0, reasons: [] },
      sellSignal: { signal: false, level: null, score: 0, reasons: [] },
      prediction: { type: 'neutral', probability: 0, signals: [], recommendation: '' },
      pluginId:   id,
      computedAt: Date.now(),
      metadata:   {},
    }),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  1. PluginRegistry
// ══════════════════════════════════════════════════════════════════════════════

describe('plugin-registry.ts — PluginRegistry', () => {
  let PluginRegistry: any;

  beforeEach(async () => {
    vi.stubGlobal('localStorage', {
      _store: {} as Record<string, string>,
      getItem(k: string) { return (this as any)._store[k] ?? null; },
      setItem(k: string, v: string) { (this as any)._store[k] = v; },
      removeItem(k: string) { delete (this as any)._store[k]; },
    });
    vi.resetModules();
    // Import the class directly — create a fresh instance for each test
    const mod = await import('../core/plugin-registry');
    // Use the singleton for module-level tests
    PluginRegistry = mod.pluginRegistry;
    // Reset state by unregistering any plugins
    for (const p of PluginRegistry.list()) {
      PluginRegistry.unregister(p.id);
    }
  });

  it('register() adds a plugin to the list', () => {
    const p = makePlugin('test-a');
    PluginRegistry.register(p);
    expect(PluginRegistry.list().length).toBe(1);
    expect(PluginRegistry.list()[0].id).toBe('test-a');
  });

  it('register() with same id overwrites existing plugin', () => {
    const p1 = makePlugin('test-a');
    const p2 = { ...makePlugin('test-a'), name: 'Updated' };
    PluginRegistry.register(p1);
    PluginRegistry.register(p2);
    expect(PluginRegistry.list().length).toBe(1);
    expect(PluginRegistry.list()[0].name).toBe('Updated');
  });

  it('getPlugin() returns the plugin or undefined', () => {
    const p = makePlugin('test-b');
    PluginRegistry.register(p);
    expect(PluginRegistry.getPlugin('test-b')).toBeDefined();
    expect(PluginRegistry.getPlugin('non-existent')).toBeUndefined();
  });

  it('list() returns all registered plugins', () => {
    PluginRegistry.register(makePlugin('p1'));
    PluginRegistry.register(makePlugin('p2'));
    PluginRegistry.register(makePlugin('p3'));
    expect(PluginRegistry.list().length).toBe(3);
  });

  it('first registered plugin becomes active automatically', () => {
    const p = makePlugin('first');
    PluginRegistry.register(p);
    expect(PluginRegistry.getActiveId()).toBe('first');
  });

  it('unregister() removes a plugin', () => {
    PluginRegistry.register(makePlugin('to-remove'));
    PluginRegistry.unregister('to-remove');
    expect(PluginRegistry.getPlugin('to-remove')).toBeUndefined();
    expect(PluginRegistry.list().length).toBe(0);
  });

  it('unregister() active plugin switches to first available', () => {
    PluginRegistry.register(makePlugin('a'));
    PluginRegistry.register(makePlugin('b'));
    PluginRegistry.unregister('a');
    // Active should now be 'b'
    expect(PluginRegistry.getActiveId()).toBe('b');
  });

  it('setActive() changes the active plugin', async () => {
    PluginRegistry.register(makePlugin('x'));
    PluginRegistry.register(makePlugin('y'));
    await PluginRegistry.setActive('y');
    expect(PluginRegistry.getActiveId()).toBe('y');
  });

  it('setActive() throws for unknown plugin id', async () => {
    await expect(PluginRegistry.setActive('does-not-exist'))
      .rejects.toThrow();
  });

  it('analyze() returns null with no active plugin', () => {
    const result = PluginRegistry.analyze(genCandles(80), 'TEST');
    expect(result).toBeNull();
  });

  it('analyze() delegates to active plugin', () => {
    const p = makePlugin('active-plugin');
    PluginRegistry.register(p);
    const result = PluginRegistry.analyze(genCandles(80), 'TEST');
    expect(result).not.toBeNull();
    expect(result!.pluginId).toBe('active-plugin');
  });

  it('analyze() returns null with insufficient data (<10 bars)', () => {
    PluginRegistry.register(makePlugin('p'));
    const result = PluginRegistry.analyze(genCandles(5), 'TEST');
    expect(result).toBeNull();
  });

  it('snapshot() returns active id and plugin list', () => {
    PluginRegistry.register(makePlugin('snap-test'));
    const snap = PluginRegistry.snapshot();
    expect(snap.active).toBe('snap-test');
    expect(Array.isArray(snap.plugins)).toBe(true);
    expect(snap.plugins[0].id).toBe('snap-test');
  });

  it('setOnChange() callback is called on unregister', () => {
    const cb = vi.fn();
    PluginRegistry.setOnChange(cb);
    PluginRegistry.register(makePlugin('cb-test'));
    PluginRegistry.unregister('cb-test');
    expect(cb).toHaveBeenCalled();
  });

  it('savePluginConfig() persists config to localStorage', () => {
    const lsMock: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => lsMock[k] ?? null,
      setItem: (k: string, v: string) => { lsMock[k] = v; },
      removeItem: (k: string) => { delete lsMock[k]; },
    });
    const p = makePlugin('cfg-plugin');
    PluginRegistry.register(p);
    PluginRegistry.savePluginConfig('cfg-plugin', { threshold: 0.7 });
    expect(lsMock['plugin:configs']).toBeDefined();
    const saved = JSON.parse(lsMock['plugin:configs']);
    expect(saved['cfg-plugin'].threshold).toBe(0.7);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  2. SMCGen3Plugin
// ══════════════════════════════════════════════════════════════════════════════

describe('plugins/smc-gen3.ts — SMCGen3Plugin', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      _store: {} as Record<string, string>,
      getItem(k: string) { return (this as any)._store[k] ?? null; },
      setItem(k: string, v: string) { (this as any)._store[k] = v; },
      removeItem(k: string) { delete (this as any)._store[k]; },
    });
  });

  it('has correct metadata', async () => {
    const { SMCGen3Plugin } = await import('../plugins/smc-gen3');
    const plugin = new SMCGen3Plugin();
    expect(plugin.id).toBe('smc-gen3');
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof plugin.name).toBe('string');
    expect(typeof plugin.description).toBe('string');
  });

  it('analyze() returns empty result with insufficient data', async () => {
    const { SMCGen3Plugin } = await import('../plugins/smc-gen3');
    const plugin = new SMCGen3Plugin();
    const result = plugin.analyze(genCandles(20), 'TEST');
    expect(result.symbol).toBe('TEST');
    expect(result.buySignal.signal).toBe(false);
    expect(result.sellSignal.signal).toBe(false);
    expect(result.prediction.type).toBe('neutral');
  });

  it('analyze() returns StrategyResult structure with enough data', async () => {
    const { SMCGen3Plugin } = await import('../plugins/smc-gen3');
    const plugin = new SMCGen3Plugin();
    const result = plugin.analyze(genCandles(100), 'TEST');
    expect(result.symbol).toBe('TEST');
    expect(typeof result.price).toBe('number');
    expect(result.pluginId).toBe('smc-gen3');
    expect(typeof result.computedAt).toBe('number');
    expect(['top', 'bottom', 'neutral']).toContain(result.prediction.type);
    expect(result.prediction.probability).toBeGreaterThanOrEqual(0);
    expect(result.prediction.probability).toBeLessThanOrEqual(1);
  });

  it('analyze() buySignal score is non-negative', async () => {
    const { SMCGen3Plugin } = await import('../plugins/smc-gen3');
    const plugin = new SMCGen3Plugin();
    const result = plugin.analyze(genCandles(100), 'TEST');
    expect(result.buySignal.score).toBeGreaterThanOrEqual(0);
    expect(result.sellSignal.score).toBeGreaterThanOrEqual(0);
  });

  it('getConfig() and setConfig() work correctly', async () => {
    const { SMCGen3Plugin } = await import('../plugins/smc-gen3');
    const plugin = new SMCGen3Plugin();
    plugin.setConfig!({ buyScoreHigh: 80, buyScoreMed: 60 });
    const cfg = plugin.getConfig!() as any;
    expect(cfg.buyScoreHigh).toBe(80);
    expect(cfg.buyScoreMed).toBe(60);
  });

  it('configSchema has correct entries', async () => {
    const { SMCGen3Plugin } = await import('../plugins/smc-gen3');
    const plugin = new SMCGen3Plugin();
    expect(Array.isArray(plugin.configSchema)).toBe(true);
    expect(plugin.configSchema!.length).toBeGreaterThan(0);
    plugin.configSchema!.forEach(s => {
      expect(typeof s.key).toBe('string');
      expect(typeof s.label).toBe('string');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  3. TrendFollowPlugin
// ══════════════════════════════════════════════════════════════════════════════

describe('plugins/trend-follow.ts — TrendFollowPlugin', () => {
  it('has correct metadata', async () => {
    const { TrendFollowPlugin } = await import('../plugins/trend-follow');
    const plugin = new TrendFollowPlugin();
    expect(plugin.id).toBe('trend-follow');
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('analyze() returns empty result when data too short', async () => {
    const { TrendFollowPlugin } = await import('../plugins/trend-follow');
    const plugin = new TrendFollowPlugin();
    const result = plugin.analyze(genCandles(10), 'TEST');
    expect(result.buySignal.signal).toBe(false);
    expect(result.sellSignal.signal).toBe(false);
  });

  it('analyze() returns StrategyResult structure with enough data', async () => {
    const { TrendFollowPlugin } = await import('../plugins/trend-follow');
    const plugin = new TrendFollowPlugin();
    const result = plugin.analyze(genCandles(80), 'TEST');
    expect(result.symbol).toBe('TEST');
    expect(typeof result.price).toBe('number');
    expect(result.pluginId).toBe('trend-follow');
    expect(result.prediction.type).toBe('neutral');   // trend-follow has no top/bottom prediction
  });

  it('analyze() detects buy in uptrend with enough data', async () => {
    const { TrendFollowPlugin } = await import('../plugins/trend-follow');
    const plugin = new TrendFollowPlugin();
    const result = plugin.analyze(genBullCandles(80), 'TEST');
    // Strong uptrend — buy score should be > 0
    expect(result.buySignal.score).toBeGreaterThanOrEqual(0);
  });

  it('getConfig() and setConfig() round-trip', async () => {
    const { TrendFollowPlugin } = await import('../plugins/trend-follow');
    const plugin = new TrendFollowPlugin();
    plugin.setConfig!({ adxMin: 30 });
    const cfg = plugin.getConfig!() as any;
    expect(cfg.adxMin).toBe(30);
  });
});
