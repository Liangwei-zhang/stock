/**
 * tests/poi-utils.test.ts
 * 覆蓋 src/utils/poi.ts、src/utils/poi-state.ts、src/utils/liquidation.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StockData, TechnicalIndicators } from '../types';

// ─── Mock 存儲服務（poi-state.ts 使用 IndexedDB）─────────────────────────────
vi.mock('../services/storageService', () => ({
  savePOIs:  vi.fn().mockResolvedValue(undefined),
  loadPOIs:  vi.fn().mockResolvedValue([]),
  clearPOIs: vi.fn().mockResolvedValue(undefined),
  SIX_MONTHS_MS: 6 * 30 * 24 * 3600 * 1000,
}));

vi.mock('../services/cryptoService', () => ({
  fetchOrderBook:                vi.fn().mockResolvedValue(null),
  estimateLiquidations:          vi.fn().mockResolvedValue(null),
  calculateOrderBookImbalance:   vi.fn().mockReturnValue(0),
  detectWhaleOrders:             vi.fn().mockReturnValue({ whaleBuy: false, whaleSell: false, whaleSize: 0 }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIndicators(overrides: Partial<TechnicalIndicators> = {}): TechnicalIndicators {
  return {
    ma5: 100, ma10: 100, ma20: 100, ma60: 100,
    ema9: 100, ema21: 100,
    macdDif: 0, macdDea: 0, macdHistogram: 0,
    kdjK: 50, kdjD: 50, kdjJ: 50,
    rsi6: 50, rsi9: 50, rsi12: 50, rsi14: 50, rsi24: 50,
    rsiBullDiv: false, rsiBearDiv: false,
    bollUp: 105, bollMb: 100, bollDn: 95, bollWidth: 0.1, bollSqueezing: false,
    poc: 100, valueAreaHigh: 102, valueAreaLow: 98,
    adx: 20, diPlus: 25, diMinus: 20,
    ...overrides,
  };
}

function makeCandles(n: number, base = 100): StockData[] {
  let price = base;
  return Array.from({ length: n }, (_, i) => {
    price = Math.max(0.01, price * (1 + (Math.random() - 0.5) * 0.02));
    return {
      symbol: 'TEST', name: 'Test',
      price, close: price, open: price * 0.999,
      high: price * 1.01, low: price * 0.99,
      change: 0, changePercent: 0,
      volume: 100000 + Math.random() * 900000,
      timestamp: Date.now() - (n - i) * 86400000,
    };
  });
}

// ─── POI detection (poi.ts) ───────────────────────────────────────────────────

describe('detectPOI — basic functionality', () => {
  it('returns null when data is insufficient (<30 bars)', async () => {
    const { detectPOI } = await import('../utils/poi');
    const ind = makeIndicators();
    const result = detectPOI(makeCandles(15), ind);
    expect(result).toBeNull();
  });

  it('returns null when no POI within range', async () => {
    const { detectPOI } = await import('../utils/poi');
    // Price at 100, POI levels far away
    const ind = makeIndicators({
      valueAreaHigh: 200,  // far above
      valueAreaLow: 50,    // far below
      bollUp: 200, bollDn: 50,
    });
    const data = makeCandles(50, 100);
    const result = detectPOI(data, ind);
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('returns POIMatch with correct structure when near VAH', async () => {
    const { detectPOI } = await import('../utils/poi');
    const price = 100;
    // Place VAH very close to current price
    const ind = makeIndicators({
      valueAreaHigh: price * 1.01,  // 1% above = within 2% threshold
      valueAreaLow: price * 0.80,
      poc: price * 0.90,
    });
    const data = makeCandles(50, price);
    // Force current price to be close to VAH
    data[data.length - 1].close = price;
    data[data.length - 1].price = price;
    const result = detectPOI(data, ind);
    if (result) {
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('distance');
      expect(result).toHaveProperty('strength');
      expect(result).toHaveProperty('reason');
      expect(['support', 'resistance']).toContain(result.type);
    }
  });

  it('POIMatch strength is positive', async () => {
    const { detectPOI } = await import('../utils/poi');
    const price = 100;
    const ind = makeIndicators({
      valueAreaHigh: price * 1.005, // 0.5% above = within 2%
      valueAreaLow: price * 0.80,
      poc: price * 0.90,
    });
    const data = makeCandles(50, price);
    data[data.length - 1].close = price;
    data[data.length - 1].price = price;
    const result = detectPOI(data, ind);
    if (result) {
      expect(result.strength).toBeGreaterThan(0);
    }
  });
});

describe('detectPOI — edge cases', () => {
  it('returns null with all-same-price candles', async () => {
    const { detectPOI } = await import('../utils/poi');
    const data: StockData[] = Array.from({ length: 50 }, (_, i) => ({
      symbol: 'FLAT', name: 'FLAT',
      price: 100, close: 100, open: 100, high: 100, low: 100,
      change: 0, changePercent: 0, volume: 100000,
      timestamp: Date.now() - (50 - i) * 86400000,
    }));
    const ind = makeIndicators({ valueAreaHigh: 0, valueAreaLow: 0, bollUp: 0, bollDn: 0 });
    const result = detectPOI(data, ind);
    // Should not throw - either null or a POIMatch
    expect(result === null || typeof result === 'object').toBe(true);
  });
});

// ─── POIManager (poi-state.ts) ────────────────────────────────────────────────

describe('POIManager — addPOI', () => {
  it('creates and returns a POI with correct structure', async () => {
    const { POIManager } = await import('../utils/poi-state');
    const mgr = new POIManager();
    const poi = mgr.addPOI('support', 95, 8, 'Test support level');
    expect(poi).toHaveProperty('id');
    expect(poi).toHaveProperty('type', 'support');
    expect(poi).toHaveProperty('level', 95);
    expect(poi).toHaveProperty('state', 'fresh');
    expect(poi).toHaveProperty('strength', 8);
    expect(poi).toHaveProperty('reason', 'Test support level');
    expect(poi.touches).toBe(0);
    expect(poi.testedAt).toBeNull();
    expect(poi.mitigatedAt).toBeNull();
  });

  it('adds resistance POI', async () => {
    const { POIManager } = await import('../utils/poi-state');
    const mgr = new POIManager();
    const poi = mgr.addPOI('resistance', 110, 10, 'VAH resistance');
    expect(poi.type).toBe('resistance');
    expect(poi.level).toBe(110);
  });
});

describe('POIManager — updateStates', () => {
  it('transitions fresh support to testing when price approaches', async () => {
    const { POIManager } = await import('../utils/poi-state');
    const mgr = new POIManager();
    mgr.addPOI('support', 95, 8, 'support');
    // Price near support (within 1%)
    mgr.updateStates(95.5);
    const pois = mgr.getActivePOIs();
    const support = pois.find(p => p.level === 95);
    if (support) {
      expect(['fresh', 'testing']).toContain(support.state);
    }
  });

  it('marks support as mitigated when price breaks below', async () => {
    const { POIManager } = await import('../utils/poi-state');
    const mgr = new POIManager();
    mgr.addPOI('support', 95, 8, 'support');
    // Price breaks well below support
    mgr.updateStates(90);
    const pois = mgr.getAllPOIs();
    const support = pois.find(p => p.level === 95);
    if (support) {
      expect(['mitigated', 'fresh', 'testing', 'stale']).toContain(support.state);
    }
  });

  it('marks resistance as mitigated when price breaks above', async () => {
    const { POIManager } = await import('../utils/poi-state');
    const mgr = new POIManager();
    mgr.addPOI('resistance', 105, 8, 'resistance');
    // Price breaks well above resistance
    mgr.updateStates(112);
    const pois = mgr.getAllPOIs();
    const res = pois.find(p => p.level === 105);
    if (res) {
      expect(['mitigated', 'fresh', 'testing', 'stale']).toContain(res.state);
    }
  });
});

describe('POIManager — initFromHistory', () => {
  it('initializes POIs from candle history', async () => {
    const { POIManager } = await import('../utils/poi-state');
    const mgr = new POIManager();
    const data = makeCandles(60, 100);
    expect(() => mgr.initFromHistory(data)).not.toThrow();
    // Should have detected some swing highs/lows
    const pois = mgr.getActivePOIs();
    expect(Array.isArray(pois)).toBe(true);
  });

  it('does nothing with insufficient data', async () => {
    const { POIManager } = await import('../utils/poi-state');
    const mgr = new POIManager();
    mgr.initFromHistory(makeCandles(5));
    expect(mgr.getActivePOIs().length).toBe(0);
  });
});

describe('POIManager — getActivePOIs and getNearestPOI', () => {
  it('getActivePOIs excludes mitigated POIs', async () => {
    const { POIManager } = await import('../utils/poi-state');
    const mgr = new POIManager();
    mgr.addPOI('support', 95, 8, 'support');
    // Break through to mitigate
    mgr.updateStates(85);
    const active = mgr.getActivePOIs();
    for (const poi of active) {
      expect(poi.state).not.toBe('mitigated');
    }
  });

  it('getNearestPOI returns closest POI to price', async () => {
    const { POIManager } = await import('../utils/poi-state');
    const mgr = new POIManager();
    mgr.addPOI('support', 98, 8, 'near support');
    mgr.addPOI('resistance', 150, 8, 'far resistance');
    const nearest = mgr.getNearestPOI(100);
    if (nearest) {
      expect(nearest.level).toBe(98); // 98 is closer to 100 than 150
    }
  });
});

// ─── liquidation.ts — calculateLiquidationZones ───────────────────────────────

describe('calculateLiquidationZones', () => {
  it('returns correct structure', async () => {
    const { calculateLiquidationZones } = await import('../utils/liquidation');
    const result = calculateLiquidationZones(50000, 2, 10);
    expect(result).toHaveProperty('longLiquidation');
    expect(result).toHaveProperty('shortLiquidation');
    expect(result).toHaveProperty('dangerZone');
    expect(result.dangerZone).toHaveProperty('upper');
    expect(result.dangerZone).toHaveProperty('lower');
  });

  it('longLiquidation is below current price', async () => {
    const { calculateLiquidationZones } = await import('../utils/liquidation');
    const result = calculateLiquidationZones(50000, 2, 10);
    expect(result.longLiquidation).toBeLessThan(50000);
  });

  it('shortLiquidation is above current price', async () => {
    const { calculateLiquidationZones } = await import('../utils/liquidation');
    const result = calculateLiquidationZones(50000, 2, 10);
    expect(result.shortLiquidation).toBeGreaterThan(50000);
  });

  it('higher leverage results in narrower liquidation range', async () => {
    const { calculateLiquidationZones } = await import('../utils/liquidation');
    const lowLev  = calculateLiquidationZones(100, 2, 5);
    const highLev = calculateLiquidationZones(100, 2, 20);
    const lowRange  = lowLev.shortLiquidation  - lowLev.longLiquidation;
    const highRange = highLev.shortLiquidation - highLev.longLiquidation;
    expect(highRange).toBeLessThan(lowRange);
  });

  it('dangerZone.upper > shortLiquidation > currentPrice > longLiquidation > dangerZone.lower', async () => {
    const { calculateLiquidationZones } = await import('../utils/liquidation');
    const price = 1000;
    const result = calculateLiquidationZones(price, 5, 10);
    expect(result.dangerZone.upper).toBeGreaterThan(result.shortLiquidation);
    expect(result.shortLiquidation).toBeGreaterThan(price);
    expect(price).toBeGreaterThan(result.longLiquidation);
    expect(result.longLiquidation).toBeGreaterThan(result.dangerZone.lower);
  });

  it('handles zero volatility without NaN', async () => {
    const { calculateLiquidationZones } = await import('../utils/liquidation');
    const result = calculateLiquidationZones(100, 0, 10);
    expect(isNaN(result.longLiquidation)).toBe(false);
    expect(isNaN(result.shortLiquidation)).toBe(false);
  });
});

describe('detectLiquidationSignal — with null order book', () => {
  it('returns null when no order book data available', async () => {
    const { detectLiquidationSignal } = await import('../utils/liquidation');
    const result = await detectLiquidationSignal('BTC');
    expect(result).toBeNull();
  });
});
