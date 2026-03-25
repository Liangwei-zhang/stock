/**
 * src/tests/liquidation.test.ts — 清算分析測試
 *
 * 覆蓋：
 *  - utils/liquidation.ts  detectLiquidationSignal(), analyzeOrderBook(), calculateLiquidationZones()
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ══════════════════════════════════════════════════════════════════════════════
//  1. calculateLiquidationZones (純函數，無外部依賴)
// ══════════════════════════════════════════════════════════════════════════════

describe('liquidation.ts — calculateLiquidationZones', () => {
  it('returns correct structure', async () => {
    const { calculateLiquidationZones } = await import('../utils/liquidation');
    const zones = calculateLiquidationZones(100, 2, 10);
    expect(typeof zones.longLiquidation).toBe('number');
    expect(typeof zones.shortLiquidation).toBe('number');
    expect(typeof zones.dangerZone.upper).toBe('number');
    expect(typeof zones.dangerZone.lower).toBe('number');
  });

  it('longLiquidation is below current price', async () => {
    const { calculateLiquidationZones } = await import('../utils/liquidation');
    const zones = calculateLiquidationZones(50000, 3, 10);
    expect(zones.longLiquidation).toBeLessThan(50000);
  });

  it('shortLiquidation is above current price', async () => {
    const { calculateLiquidationZones } = await import('../utils/liquidation');
    const zones = calculateLiquidationZones(50000, 3, 10);
    expect(zones.shortLiquidation).toBeGreaterThan(50000);
  });

  it('danger zone upper > shortLiquidation', async () => {
    const { calculateLiquidationZones } = await import('../utils/liquidation');
    const zones = calculateLiquidationZones(50000, 3, 10);
    expect(zones.dangerZone.upper).toBeGreaterThan(zones.shortLiquidation);
  });

  it('danger zone lower < longLiquidation', async () => {
    const { calculateLiquidationZones } = await import('../utils/liquidation');
    const zones = calculateLiquidationZones(50000, 3, 10);
    expect(zones.dangerZone.lower).toBeLessThan(zones.longLiquidation);
  });

  it('higher leverage means tighter liquidation distance', async () => {
    const { calculateLiquidationZones } = await import('../utils/liquidation');
    const low  = calculateLiquidationZones(100, 2, 5);
    const high = calculateLiquidationZones(100, 2, 20);
    const distLow  = 100 - low.longLiquidation;
    const distHigh = 100 - high.longLiquidation;
    expect(distHigh).toBeLessThan(distLow);
  });

  it('uses leverage=10 by default', async () => {
    const { calculateLiquidationZones } = await import('../utils/liquidation');
    const withDefault = calculateLiquidationZones(100, 2);
    const withExplicit = calculateLiquidationZones(100, 2, 10);
    expect(withDefault.longLiquidation).toBeCloseTo(withExplicit.longLiquidation, 10);
    expect(withDefault.shortLiquidation).toBeCloseTo(withExplicit.shortLiquidation, 10);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  2. detectLiquidationSignal (依賴 cryptoService — 需要 mock)
// ══════════════════════════════════════════════════════════════════════════════

describe('liquidation.ts — detectLiquidationSignal', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns null when estimateLiquidations returns null', async () => {
    vi.doMock('../services/cryptoService', () => ({
      fetchOrderBook: vi.fn().mockResolvedValue({ bids: [], asks: [] }),
      estimateLiquidations: vi.fn().mockResolvedValue(null),
      calculateOrderBookImbalance: vi.fn().mockReturnValue(0),
      detectWhaleOrders: vi.fn().mockReturnValue({ whaleBuy: false, whaleSell: false, whaleSize: 0 }),
    }));
    const { detectLiquidationSignal } = await import('../utils/liquidation');
    const result = await detectLiquidationSignal('BTC');
    expect(result).toBeNull();
  });

  it('returns null when orderBook is null', async () => {
    vi.doMock('../services/cryptoService', () => ({
      fetchOrderBook: vi.fn().mockResolvedValue(null),
      estimateLiquidations: vi.fn().mockResolvedValue({ buyWall: 100, sellWall: 100, buyLiquidation: 49000, sellLiquidation: 51000 }),
      calculateOrderBookImbalance: vi.fn().mockReturnValue(0),
      detectWhaleOrders: vi.fn().mockReturnValue({ whaleBuy: false, whaleSell: false, whaleSize: 0 }),
    }));
    const { detectLiquidationSignal } = await import('../utils/liquidation');
    const result = await detectLiquidationSignal('BTC');
    expect(result).toBeNull();
  });

  it('returns sell signal when sellWall >> buyWall', async () => {
    vi.doMock('../services/cryptoService', () => ({
      fetchOrderBook: vi.fn().mockResolvedValue({ bids: [[49000, 10]], asks: [[51000, 10]] }),
      estimateLiquidations: vi.fn().mockResolvedValue({
        buyWall: 100,
        sellWall: 500,   // 5x buyWall → sell signal
        buyLiquidation: 49000,
        sellLiquidation: 51000,
      }),
      calculateOrderBookImbalance: vi.fn().mockReturnValue(-0.5),
      detectWhaleOrders: vi.fn().mockReturnValue({ whaleBuy: false, whaleSell: false, whaleSize: 0 }),
    }));
    const { detectLiquidationSignal } = await import('../utils/liquidation');
    const result = await detectLiquidationSignal('BTC');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('sell');
    expect(result!.level).toBeGreaterThan(0);
    expect(result!.level).toBeLessThanOrEqual(15);
  });

  it('returns buy signal when buyWall >> sellWall', async () => {
    vi.doMock('../services/cryptoService', () => ({
      fetchOrderBook: vi.fn().mockResolvedValue({ bids: [[49000, 10]], asks: [[51000, 10]] }),
      estimateLiquidations: vi.fn().mockResolvedValue({
        buyWall: 500,     // 5x sellWall → buy signal
        sellWall: 100,
        buyLiquidation: 49000,
        sellLiquidation: 51000,
      }),
      calculateOrderBookImbalance: vi.fn().mockReturnValue(0.5),
      detectWhaleOrders: vi.fn().mockReturnValue({ whaleBuy: false, whaleSell: false, whaleSize: 0 }),
    }));
    const { detectLiquidationSignal } = await import('../utils/liquidation');
    const result = await detectLiquidationSignal('BTC');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('buy');
  });

  it('whale buy increases score', async () => {
    vi.doMock('../services/cryptoService', () => ({
      fetchOrderBook: vi.fn().mockResolvedValue({ bids: [[49000, 10]], asks: [[51000, 10]] }),
      estimateLiquidations: vi.fn().mockResolvedValue({
        buyWall: 500, sellWall: 100,
        buyLiquidation: 49000, sellLiquidation: 51000,
      }),
      calculateOrderBookImbalance: vi.fn().mockReturnValue(0.5),
      detectWhaleOrders: vi.fn().mockReturnValue({ whaleBuy: true, whaleSell: false, whaleSize: 1000000 }),
    }));
    const { detectLiquidationSignal } = await import('../utils/liquidation');
    const result = await detectLiquidationSignal('BTC');
    expect(result).not.toBeNull();
    expect(result!.level).toBe(15);   // maxed at 15
  });

  it('result level is capped at 15', async () => {
    vi.doMock('../services/cryptoService', () => ({
      fetchOrderBook: vi.fn().mockResolvedValue({ bids: [], asks: [] }),
      estimateLiquidations: vi.fn().mockResolvedValue({
        buyWall: 1000, sellWall: 100,
        buyLiquidation: 49000, sellLiquidation: 51000,
      }),
      calculateOrderBookImbalance: vi.fn().mockReturnValue(0.9),
      detectWhaleOrders: vi.fn().mockReturnValue({ whaleBuy: true, whaleSell: true, whaleSize: 999999 }),
    }));
    const { detectLiquidationSignal } = await import('../utils/liquidation');
    const result = await detectLiquidationSignal('BTC');
    expect(result).not.toBeNull();
    expect(result!.level).toBeLessThanOrEqual(15);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  3. analyzeOrderBook
// ══════════════════════════════════════════════════════════════════════════════

describe('liquidation.ts — analyzeOrderBook', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns null when fetchOrderBook returns null', async () => {
    vi.doMock('../services/cryptoService', () => ({
      fetchOrderBook: vi.fn().mockResolvedValue(null),
      estimateLiquidations: vi.fn().mockResolvedValue(null),
      calculateOrderBookImbalance: vi.fn().mockReturnValue(0),
      detectWhaleOrders: vi.fn().mockReturnValue({ whaleBuy: false, whaleSell: false, whaleSize: 0 }),
    }));
    const { analyzeOrderBook } = await import('../utils/liquidation');
    const result = await analyzeOrderBook('BTC');
    expect(result).toBeNull();
  });

  it('returns OrderBookAnalysis with correct structure', async () => {
    vi.doMock('../services/cryptoService', () => ({
      fetchOrderBook: vi.fn().mockResolvedValue({ bids: [[49000, 10]], asks: [[51000, 5]] }),
      estimateLiquidations: vi.fn().mockResolvedValue({
        buyWall: 200, sellWall: 100,
        buyLiquidation: 49000, sellLiquidation: 51000,
      }),
      calculateOrderBookImbalance: vi.fn().mockReturnValue(0.3),
      detectWhaleOrders: vi.fn().mockReturnValue({ whaleBuy: false, whaleSell: true, whaleSize: 500000 }),
    }));
    const { analyzeOrderBook } = await import('../utils/liquidation');
    const result = await analyzeOrderBook('BTC');
    expect(result).not.toBeNull();
    expect(typeof result!.imbalance).toBe('number');
    expect(typeof result!.buyWallStrength).toBe('number');
    expect(typeof result!.sellWallStrength).toBe('number');
    expect(typeof result!.whaleBuy).toBe('boolean');
    expect(typeof result!.whaleSell).toBe('boolean');
    expect(typeof result!.liquiditySweep).toBe('boolean');
  });

  it('detects upward sweep when buyWall >> sellWall and positive imbalance', async () => {
    vi.doMock('../services/cryptoService', () => ({
      fetchOrderBook: vi.fn().mockResolvedValue({ bids: [[49000, 10]], asks: [[51000, 5]] }),
      estimateLiquidations: vi.fn().mockResolvedValue({
        buyWall: 1000, sellWall: 100,     // 10x
        buyLiquidation: 49000, sellLiquidation: 51000,
      }),
      calculateOrderBookImbalance: vi.fn().mockReturnValue(0.6),  // > 0.5
      detectWhaleOrders: vi.fn().mockReturnValue({ whaleBuy: false, whaleSell: false, whaleSize: 0 }),
    }));
    const { analyzeOrderBook } = await import('../utils/liquidation');
    const result = await analyzeOrderBook('BTC');
    expect(result!.sweepDirection).toBe('up');
    expect(result!.liquiditySweep).toBe(true);
  });

  it('detects downward sweep when sellWall >> buyWall and negative imbalance', async () => {
    vi.doMock('../services/cryptoService', () => ({
      fetchOrderBook: vi.fn().mockResolvedValue({ bids: [[49000, 10]], asks: [[51000, 5]] }),
      estimateLiquidations: vi.fn().mockResolvedValue({
        buyWall: 100, sellWall: 1000,    // 10x
        buyLiquidation: 49000, sellLiquidation: 51000,
      }),
      calculateOrderBookImbalance: vi.fn().mockReturnValue(-0.6),  // < -0.5
      detectWhaleOrders: vi.fn().mockReturnValue({ whaleBuy: false, whaleSell: false, whaleSize: 0 }),
    }));
    const { analyzeOrderBook } = await import('../utils/liquidation');
    const result = await analyzeOrderBook('BTC');
    expect(result!.sweepDirection).toBe('down');
    expect(result!.liquiditySweep).toBe(true);
  });

  it('no sweep when walls are balanced', async () => {
    vi.doMock('../services/cryptoService', () => ({
      fetchOrderBook: vi.fn().mockResolvedValue({ bids: [[49000, 10]], asks: [[51000, 10]] }),
      estimateLiquidations: vi.fn().mockResolvedValue({
        buyWall: 200, sellWall: 200,
        buyLiquidation: 49000, sellLiquidation: 51000,
      }),
      calculateOrderBookImbalance: vi.fn().mockReturnValue(0),
      detectWhaleOrders: vi.fn().mockReturnValue({ whaleBuy: false, whaleSell: false, whaleSize: 0 }),
    }));
    const { analyzeOrderBook } = await import('../utils/liquidation');
    const result = await analyzeOrderBook('BTC');
    expect(result!.sweepDirection).toBeNull();
    expect(result!.liquiditySweep).toBe(false);
  });
});
