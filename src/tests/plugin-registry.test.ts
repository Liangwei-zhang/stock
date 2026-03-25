/**
 * tests/plugin-registry.test.ts
 * 覆蓋 src/core/plugin-registry.ts 中的 PluginRegistry 類
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IStrategyPlugin, StrategyResult } from '../core/types';
import type { StockData, TechnicalIndicators } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIndicators(): TechnicalIndicators {
  return {
    ma5: 100, ma10: 100, ma20: 100, ma60: 100,
    ema9: 100, ema21: 100,
    macdDif: 0, macdDea: 0, macdHistogram: 0,
    kdjK: 50, kdjD: 50, kdjJ: 50,
    rsi6: 50, rsi9: 50, rsi12: 50, rsi14: 50, rsi24: 50,
    rsiBullDiv: false, rsiBearDiv: false,
    bollUp: 105, bollMb: 100, bollDn: 95, bollWidth: 0.1, bollSqueezing: false,
    poc: 100, valueAreaHigh: 103, valueAreaLow: 97,
    adx: 20, diPlus: 25, diMinus: 20,
  };
}

function makeStrategyResult(symbol: string): StrategyResult {
  return {
    symbol,
    price: 100,
    indicators: makeIndicators(),
    buySignal:  { signal: false, level: null, score: 0, reasons: [] },
    sellSignal: { signal: false, level: null, score: 0, reasons: [] },
    prediction: { type: 'neutral', probability: 0.5, signals: [], recommendation: 'hold' },
  };
}

function makePlugin(id: string, defaultEnabled = true): IStrategyPlugin {
  return {
    id,
    name: `Plugin ${id}`,
    version: '1.0.0',
    description: `Test plugin ${id}`,
    defaultEnabled,
    analyze: vi.fn().mockImplementation((data: StockData[], symbol: string) => makeStrategyResult(symbol)),
  };
}

function makeLsMock() {
  const store: Record<string, string> = {};
  return {
    getItem:    (k: string) => store[k] ?? null,
    setItem:    (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear:      () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

function makeCandles(n: number): StockData[] {
  return Array.from({ length: n }, (_, i) => ({
    symbol: 'TEST', name: 'Test', price: 100 + i * 0.1,
    close: 100 + i * 0.1, open: 100, high: 101, low: 99,
    change: 0.1, changePercent: 0.1, volume: 500000,
    timestamp: Date.now() - (n - i) * 86400000,
  }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PluginRegistry — registration', () => {
  it('register stores plugin and sets as active if first', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p = makePlugin('first');
    pluginRegistry.register(p);
    expect(pluginRegistry.getActive()?.id).toBe('first');
  });

  it('duplicate registration overwrites existing plugin', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p1 = makePlugin('dup-a');
    const p2 = makePlugin('dup-a'); // same id
    pluginRegistry.register(p1);
    pluginRegistry.register(p2);
    expect(pluginRegistry.list().filter(p => p.id === 'dup-a').length).toBe(1);
    // p2 should have replaced p1
    expect(pluginRegistry.getPlugin('dup-a')).toBe(p2);
  });

  it('unregister removes plugin from list', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p = makePlugin('to-remove');
    pluginRegistry.register(p);
    pluginRegistry.unregister('to-remove');
    expect(pluginRegistry.list().some(x => x.id === 'to-remove')).toBe(false);
  });

  it('unregister active plugin switches to another', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p1 = makePlugin('switch-1');
    const p2 = makePlugin('switch-2');
    pluginRegistry.register(p1);
    pluginRegistry.register(p2);
    await pluginRegistry.setActive('switch-1');
    pluginRegistry.unregister('switch-1');
    // Active should now be switch-2 or empty string
    const active = pluginRegistry.getActiveId();
    expect(active === 'switch-2' || active === '').toBe(true);
  });
});

describe('PluginRegistry — setActive', () => {
  it('setActive changes active plugin', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p1 = makePlugin('act-1');
    const p2 = makePlugin('act-2');
    pluginRegistry.register(p1);
    pluginRegistry.register(p2);
    await pluginRegistry.setActive('act-2');
    expect(pluginRegistry.getActiveId()).toBe('act-2');
  });

  it('setActive persists to localStorage', async () => {
    vi.resetModules();
    const ls = makeLsMock();
    vi.stubGlobal('localStorage', ls);
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p = makePlugin('persist-p');
    pluginRegistry.register(p);
    await pluginRegistry.setActive('persist-p');
    expect(ls.getItem('plugin:active')).toBe('persist-p');
  });

  it('setActive throws for unknown plugin id', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { pluginRegistry } = await import('../core/plugin-registry');
    await expect(pluginRegistry.setActive('non-existent')).rejects.toThrow();
  });

  it('setActive triggers onChange callback', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p1 = makePlugin('cb-1');
    const p2 = makePlugin('cb-2');
    pluginRegistry.register(p1);
    pluginRegistry.register(p2);
    const cb = vi.fn();
    pluginRegistry.setOnChange(cb);
    await pluginRegistry.setActive('cb-2');
    expect(cb).toHaveBeenCalled();
  });
});

describe('PluginRegistry — analyze', () => {
  it('analyze delegates to active plugin', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p = makePlugin('analyze-p');
    pluginRegistry.register(p);
    await pluginRegistry.setActive('analyze-p');
    const data = makeCandles(30);
    const result = pluginRegistry.analyze(data, 'TEST');
    expect(result).not.toBeNull();
    expect((p.analyze as any)).toHaveBeenCalledWith(data, 'TEST');
  });

  it('analyze returns null when data length < 10', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p = makePlugin('short-data');
    pluginRegistry.register(p);
    const result = pluginRegistry.analyze(makeCandles(5), 'X');
    expect(result).toBeNull();
  });

  it('analyze returns null when no active plugin', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { pluginRegistry } = await import('../core/plugin-registry');
    // No plugins registered
    const result = pluginRegistry.analyze(makeCandles(30), 'NONE');
    expect(result).toBeNull();
  });

  it('analyze catches errors from plugin and returns null', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p = makePlugin('throw-p');
    (p.analyze as any).mockImplementation(() => { throw new Error('plugin crash'); });
    pluginRegistry.register(p);
    await pluginRegistry.setActive('throw-p');
    const result = pluginRegistry.analyze(makeCandles(30), 'CRASH');
    expect(result).toBeNull();
  });
});

describe('PluginRegistry — snapshot', () => {
  it('snapshot returns active id and plugin list', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p1 = makePlugin('snap-1');
    const p2 = makePlugin('snap-2');
    pluginRegistry.register(p1);
    pluginRegistry.register(p2);
    await pluginRegistry.setActive('snap-1');
    const snap = pluginRegistry.snapshot();
    expect(snap.active).toBe('snap-1');
    expect(snap.plugins.some(x => x.id === 'snap-1')).toBe(true);
    expect(snap.plugins.some(x => x.id === 'snap-2')).toBe(true);
  });

  it('snapshot plugin entries have required fields', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p = makePlugin('field-check');
    pluginRegistry.register(p);
    const snap = pluginRegistry.snapshot();
    const entry = snap.plugins.find(x => x.id === 'field-check');
    expect(entry).toBeDefined();
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('name');
    expect(entry).toHaveProperty('version');
    expect(entry).toHaveProperty('description');
  });
});

describe('PluginRegistry — config management', () => {
  it('savePluginConfig persists config to localStorage', async () => {
    vi.resetModules();
    const ls = makeLsMock();
    vi.stubGlobal('localStorage', ls);
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p = makePlugin('cfg-p');
    (p as any).setConfig = vi.fn();
    pluginRegistry.register(p);
    pluginRegistry.savePluginConfig('cfg-p', { threshold: 0.8 });
    const stored = ls.getItem('plugin:configs');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed['cfg-p']?.threshold).toBe(0.8);
  });

  it('bootstrap restores active plugin from localStorage', async () => {
    vi.resetModules();
    const ls = makeLsMock();
    ls.setItem('plugin:active', 'boot-2');
    vi.stubGlobal('localStorage', ls);
    const { pluginRegistry } = await import('../core/plugin-registry');
    const p1 = makePlugin('boot-1');
    const p2 = makePlugin('boot-2');
    pluginRegistry.register(p1);
    pluginRegistry.register(p2);
    pluginRegistry.bootstrap();
    expect(pluginRegistry.getActiveId()).toBe('boot-2');
  });
});
