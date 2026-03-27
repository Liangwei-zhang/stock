/**
 * src/tests/alert-service.test.ts — 預警服務測試
 *
 * 覆蓋：
 *  - services/alertService.ts  AlertService (createAlert, getAlerts, unread, mark, clear, ...)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Helper: 建立最小分析物件 ─────────────────────────────────────────────────

function makeAnalysis(symbol = 'BTC', price = 50000) {
  return {
    symbol,
    price,
    name: symbol,
    indicators: {
      // V6 需要至少一個確認信號才會生成警報（部分確認即可）
      sfpBull: true, sfpBear: true,
      cvdBullDiv: false, cvdBearDiv: false,
      chochBull: false, chochBear: false,
    } as any,
    buySignal:  { signal: false, level: null as any, score: 0, reasons: [] },
    sellSignal: { signal: false, level: null as any, score: 0, reasons: [] },
    prediction: { type: 'neutral' as const, probability: 0, signals: [], recommendation: '' },
    timestamp:  Date.now(),
  };
}

function makeSignal(level: 'high' | 'medium' | 'low', score = 80) {
  return {
    signal: true,
    level,
    score,
    reasons: ['reason1', 'reason2', 'reason3', 'reason4'],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  AlertService
// ══════════════════════════════════════════════════════════════════════════════

describe('alertService.ts — AlertService', () => {
  let alertService: any;

  beforeEach(async () => {
    vi.resetModules();
    // Mock serverBridge to avoid network calls
    vi.doMock('../services/serverBridge', () => ({
      pushAlertToServer:   vi.fn(),
      sendTelegramViaServer: vi.fn(),
      SERVER_URL:          'http://localhost:3001',
      writeHeaders:        vi.fn(() => ({ 'Content-Type': 'application/json' })),
    }));
    // Mock fetch for Telegram (no env vars set in tests)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const mod = await import('../services/alertService');
    alertService = mod.alertService;
    alertService.clearAlerts();
  });

  it('starts with empty alerts', () => {
    expect(alertService.getAlerts().length).toBe(0);
    expect(alertService.getUnreadCount()).toBe(0);
  });

  it('createAlert() returns null when signal is false', () => {
    const result = alertService.createAlert(
      makeAnalysis(),
      'buy',
      { signal: false, level: null, score: 0, reasons: [] },
    );
    expect(result).toBeNull();
    expect(alertService.getAlerts().length).toBe(0);
  });

  it('createAlert() returns null when level is null', () => {
    const result = alertService.createAlert(
      makeAnalysis(),
      'buy',
      { signal: true, level: null, score: 80, reasons: ['x'] },
    );
    expect(result).toBeNull();
  });

  it('createAlert() creates an alert and adds to list', () => {
    const alert = alertService.createAlert(makeAnalysis('BTC', 50000), 'buy', makeSignal('high'));
    expect(alert).not.toBeNull();
    expect(alertService.getAlerts().length).toBe(1);
    expect(alert.symbol).toBe('BTC');
    expect(alert.type).toBe('buy');
    expect(alert.level).toBe('high');
    expect(alert.price).toBe(50000);
    expect(alert.read).toBe(false);
  });

  it('createAlert() for sell type works', () => {
    const alert = alertService.createAlert(makeAnalysis('AAPL', 200), 'sell', makeSignal('medium'));
    expect(alert).not.toBeNull();
    expect(alert.type).toBe('sell');
    expect(alert.level).toBe('medium');
  });

  it('createAlert() for top/bottom types works', () => {
    const topAlert    = alertService.createAlert(makeAnalysis('ETH', 3000), 'top',    makeSignal('low'));
    const bottomAlert = alertService.createAlert(makeAnalysis('ETH', 2900), 'bottom', makeSignal('low'));
    expect(topAlert?.type).toBe('top');
    expect(bottomAlert?.type).toBe('bottom');
  });

  it('alert has required fields', () => {
    const alert = alertService.createAlert(makeAnalysis('BTC', 50000), 'buy', makeSignal('high'));
    expect(typeof alert.id).toBe('string');
    expect(typeof alert.message).toBe('string');
    expect(typeof alert.timestamp).toBe('number');
    expect(Array.isArray(alert.reasons)).toBe(true);
    expect(typeof alert.score).toBe('number');
  });

  it('deduplication: same symbol/type/level within 2h is rejected', () => {
    alertService.createAlert(makeAnalysis('BTC', 50000), 'buy', makeSignal('high'));
    const dup = alertService.createAlert(makeAnalysis('BTC', 51000), 'buy', makeSignal('high'));
    expect(dup).toBeNull();
    expect(alertService.getAlerts().length).toBe(1);
  });

  it('deduplication: different symbol is allowed', () => {
    alertService.createAlert(makeAnalysis('BTC', 50000), 'buy', makeSignal('high'));
    const other = alertService.createAlert(makeAnalysis('ETH', 3000), 'buy', makeSignal('high'));
    expect(other).not.toBeNull();
    expect(alertService.getAlerts().length).toBe(2);
  });

  it('deduplication: lower level after high level is blocked', () => {
    alertService.createAlert(makeAnalysis('BTC', 50000), 'buy', makeSignal('high', 90));
    const lower = alertService.createAlert(makeAnalysis('BTC', 51000), 'buy', makeSignal('medium', 65));
    expect(lower).toBeNull();
  });

  it('getUnreadCount() returns number of unread alerts', () => {
    alertService.createAlert(makeAnalysis('BTC', 50000), 'buy', makeSignal('high'));
    alertService.createAlert(makeAnalysis('ETH', 3000), 'sell', makeSignal('medium'));
    expect(alertService.getUnreadCount()).toBe(2);
  });

  it('markAsRead() marks a single alert as read', () => {
    const alert = alertService.createAlert(makeAnalysis('BTC', 50000), 'buy', makeSignal('high'));
    alertService.markAsRead(alert.id);
    expect(alertService.getAlerts().find((a: any) => a.id === alert.id)?.read).toBe(true);
    expect(alertService.getUnreadCount()).toBe(0);
  });

  it('markAllAsRead() marks all alerts as read', () => {
    alertService.createAlert(makeAnalysis('BTC', 50000), 'buy', makeSignal('high'));
    alertService.createAlert(makeAnalysis('ETH', 3000), 'sell', makeSignal('medium'));
    alertService.markAllAsRead();
    expect(alertService.getUnreadCount()).toBe(0);
    alertService.getAlerts().forEach((a: any) => expect(a.read).toBe(true));
  });

  it('clearAlerts() removes all alerts', () => {
    alertService.createAlert(makeAnalysis('BTC', 50000), 'buy', makeSignal('high'));
    alertService.clearAlerts();
    expect(alertService.getAlerts().length).toBe(0);
    expect(alertService.getUnreadCount()).toBe(0);
  });

  it('removeAlert() removes a specific alert', () => {
    const a1 = alertService.createAlert(makeAnalysis('BTC', 50000), 'buy', makeSignal('high'));
    alertService.createAlert(makeAnalysis('ETH', 3000), 'sell', makeSignal('medium'));
    alertService.removeAlert(a1.id);
    expect(alertService.getAlerts().length).toBe(1);
    expect(alertService.getAlerts()[0].symbol).toBe('ETH');
  });

  it('setOnChange() callback is called when alert is created', () => {
    const cb = vi.fn();
    alertService.setOnChange(cb);
    alertService.createAlert(makeAnalysis('BTC', 50000), 'buy', makeSignal('high'));
    expect(cb).toHaveBeenCalled();
  });

  it('setOnChange() callback is called when marking as read', () => {
    const cb = vi.fn();
    const alert = alertService.createAlert(makeAnalysis('BTC', 50000), 'buy', makeSignal('high'));
    alertService.setOnChange(cb);
    cb.mockClear();
    alertService.markAsRead(alert.id);
    expect(cb).toHaveBeenCalled();
  });

  it('setOnChange() callback is called on clearAlerts', () => {
    const cb = vi.fn();
    alertService.setOnChange(cb);
    alertService.clearAlerts();
    expect(cb).toHaveBeenCalled();
  });

  it('alerts list is limited to maxAlerts (200)', () => {
    // Create 210 unique alerts by varying symbol
    for (let i = 0; i < 210; i++) {
      const sym = `SYM${i}`;
      alertService.createAlert(makeAnalysis(sym, 100 + i), 'buy', makeSignal('high'));
    }
    expect(alertService.getAlerts().length).toBeLessThanOrEqual(200);
  });

  it('alert ids are unique', () => {
    alertService.createAlert(makeAnalysis('BTC', 50000), 'buy', makeSignal('high'));
    alertService.createAlert(makeAnalysis('ETH', 3000), 'sell', makeSignal('medium'));
    const ids = alertService.getAlerts().map((a: any) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('flush() calls onChange', () => {
    const cb = vi.fn();
    alertService.setOnChange(cb);
    cb.mockClear();
    alertService.flush();
    expect(cb).toHaveBeenCalled();
  });

  it('backward-compat stubs: initSimulator and setAutoTrade do nothing', () => {
    expect(() => alertService.initSimulator(100000)).not.toThrow();
    expect(() => alertService.setAutoTrade(true)).not.toThrow();
    expect(alertService.isAutoTradeEnabled()).toBe(false);
  });
});
