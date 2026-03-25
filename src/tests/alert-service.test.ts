/**
 * tests/alert-service.test.ts
 * 覆蓋 src/services/alertService.ts 中的 AlertService 類
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StockAnalysis } from '../types';

// ─── Mock serverBridge ────────────────────────────────────────────────────────
vi.mock('../services/serverBridge', () => ({
  pushAlertToServer: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLsMock() {
  const store: Record<string, string> = {};
  return {
    getItem:    (k: string) => store[k] ?? null,
    setItem:    (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear:      () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

function makeAnalysis(symbol: string, price = 100): StockAnalysis {
  return {
    symbol, price,
    indicators: {} as any,
    buySignal:  { signal: true, level: 'high', score: 80, reasons: ['RSI divergence'] },
    sellSignal: { signal: false, level: null, score: 0, reasons: [] },
    prediction: { type: 'bottom', probability: 0.8, signals: [], recommendation: 'buy' },
  };
}

function makeSignal(level: 'high' | 'medium' | 'low' | null = 'high', signal = true) {
  return { signal, level, score: 80, reasons: ['test reason'] };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AlertService — basic operations', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLsMock());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
  });

  it('creates an alert and returns it', async () => {
    vi.resetModules();
    const { alertService } = await import('../services/alertService');
    const analysis = makeAnalysis('BTC', 50000);
    const alert = alertService.createAlert(analysis, 'buy', makeSignal('high'));
    expect(alert).not.toBeNull();
    expect(alert?.symbol).toBe('BTC');
    expect(alert?.type).toBe('buy');
    expect(alert?.level).toBe('high');
  });

  it('returns null when signal is false', async () => {
    vi.resetModules();
    const { alertService } = await import('../services/alertService');
    const analysis = makeAnalysis('ETH');
    const alert = alertService.createAlert(analysis, 'buy', makeSignal('high', false));
    expect(alert).toBeNull();
  });

  it('returns null when level is null', async () => {
    vi.resetModules();
    const { alertService } = await import('../services/alertService');
    const analysis = makeAnalysis('ETH');
    const alert = alertService.createAlert(analysis, 'buy', makeSignal(null, true));
    expect(alert).toBeNull();
  });

  it('getAlerts returns created alerts', async () => {
    vi.resetModules();
    const { alertService } = await import('../services/alertService');
    alertService.createAlert(makeAnalysis('AAPL'), 'buy', makeSignal());
    alertService.createAlert(makeAnalysis('TSLA'), 'sell', makeSignal());
    const alerts = alertService.getAlerts();
    expect(alerts.length).toBeGreaterThanOrEqual(2);
  });

  it('clearAlerts empties the list', async () => {
    vi.resetModules();
    const { alertService } = await import('../services/alertService');
    alertService.createAlert(makeAnalysis('BTC'), 'buy', makeSignal());
    alertService.clearAlerts();
    expect(alertService.getAlerts()).toEqual([]);
  });

  it('removeAlert removes specific alert', async () => {
    vi.resetModules();
    const { alertService } = await import('../services/alertService');
    const alert = alertService.createAlert(makeAnalysis('SOL'), 'top', makeSignal('medium'));
    const id = alert!.id;
    alertService.removeAlert(id);
    expect(alertService.getAlerts().some(a => a.id === id)).toBe(false);
  });
});

describe('AlertService — unread count management', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
  });

  it('new alerts are unread', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { alertService } = await import('../services/alertService');
    alertService.clearAlerts();
    alertService.createAlert(makeAnalysis('BTC'), 'buy', makeSignal());
    alertService.createAlert(makeAnalysis('ETH'), 'sell', makeSignal('medium'));
    expect(alertService.getUnreadCount()).toBe(2);
  });

  it('markAsRead reduces unread count', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { alertService } = await import('../services/alertService');
    alertService.clearAlerts();
    const alert = alertService.createAlert(makeAnalysis('BTC'), 'buy', makeSignal());
    const before = alertService.getUnreadCount();
    alertService.markAsRead(alert!.id);
    expect(alertService.getUnreadCount()).toBe(before - 1);
  });

  it('markAllAsRead sets all alerts to read', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { alertService } = await import('../services/alertService');
    alertService.clearAlerts();
    alertService.createAlert(makeAnalysis('BTC'), 'buy', makeSignal());
    alertService.createAlert(makeAnalysis('ETH'), 'sell', makeSignal());
    alertService.markAllAsRead();
    expect(alertService.getUnreadCount()).toBe(0);
  });
});

describe('AlertService — deduplication', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
  });

  it('duplicate alert for same symbol+type within dedup window is rejected', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { alertService } = await import('../services/alertService');
    alertService.clearAlerts();
    const analysis = makeAnalysis('BTC', 50000);
    const first = alertService.createAlert(analysis, 'buy', makeSignal('high'));
    const second = alertService.createAlert(analysis, 'buy', makeSignal('high'));
    expect(first).not.toBeNull();
    expect(second).toBeNull(); // rejected by dedup
  });

  it('lower level after higher level is rejected by dedup', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { alertService } = await import('../services/alertService');
    alertService.clearAlerts();
    const analysis = makeAnalysis('ETH', 3000);
    alertService.createAlert(analysis, 'buy', makeSignal('high'));
    const second = alertService.createAlert(analysis, 'buy', makeSignal('medium'));
    expect(second).toBeNull(); // lower level, rejected
  });

  it('different type for same symbol is allowed', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { alertService } = await import('../services/alertService');
    alertService.clearAlerts();
    const analysis = makeAnalysis('BTC', 50000);
    const buy  = alertService.createAlert(analysis, 'buy', makeSignal('high'));
    const sell = alertService.createAlert(analysis, 'sell', makeSignal('high'));
    expect(buy).not.toBeNull();
    expect(sell).not.toBeNull();
  });

  it('different symbol same type is allowed', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { alertService } = await import('../services/alertService');
    alertService.clearAlerts();
    const a1 = alertService.createAlert(makeAnalysis('BTC'), 'buy', makeSignal('high'));
    const a2 = alertService.createAlert(makeAnalysis('ETH'), 'buy', makeSignal('high'));
    expect(a1).not.toBeNull();
    expect(a2).not.toBeNull();
  });
});

describe('AlertService — capacity limit', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
  });

  it('exceeding maxAlerts (200) trims the list', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { alertService } = await import('../services/alertService');
    alertService.clearAlerts();
    // Create 210 alerts with different symbols to bypass dedup
    for (let i = 0; i < 210; i++) {
      alertService.createAlert(makeAnalysis(`SYM${i}`), 'buy', makeSignal('high'));
    }
    expect(alertService.getAlerts().length).toBeLessThanOrEqual(200);
  });
});

describe('AlertService — onChange callback', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
  });

  it('onChange is triggered when alert is created', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { alertService } = await import('../services/alertService');
    const cb = vi.fn();
    alertService.setOnChange(cb);
    alertService.createAlert(makeAnalysis('BTC'), 'buy', makeSignal());
    expect(cb).toHaveBeenCalled();
  });

  it('onChange is triggered on clearAlerts', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { alertService } = await import('../services/alertService');
    const cb = vi.fn();
    alertService.setOnChange(cb);
    alertService.clearAlerts();
    expect(cb).toHaveBeenCalled();
  });

  it('onChange is triggered on markAsRead', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { alertService } = await import('../services/alertService');
    alertService.clearAlerts();
    const alert = alertService.createAlert(makeAnalysis('BTC'), 'buy', makeSignal());
    const cb = vi.fn();
    alertService.setOnChange(cb);
    alertService.markAsRead(alert!.id);
    expect(cb).toHaveBeenCalled();
  });
});

describe('AlertService — alert message format', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
  });

  it('alert message contains symbol and type', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { alertService } = await import('../services/alertService');
    alertService.clearAlerts();
    const alert = alertService.createAlert(makeAnalysis('MSFT', 400), 'buy', makeSignal('high'));
    expect(alert?.message).toContain('MSFT');
  });

  it('alert has unique ids', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLsMock());
    const { alertService } = await import('../services/alertService');
    alertService.clearAlerts();
    const a1 = alertService.createAlert(makeAnalysis('BTC'), 'buy', makeSignal('high'));
    const a2 = alertService.createAlert(makeAnalysis('ETH'), 'sell', makeSignal('medium'));
    expect(a1?.id).not.toBe(a2?.id);
  });
});
