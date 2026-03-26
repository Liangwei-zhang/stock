/**
 * alertService.ts — 预警通知服务（纯通知，不负责交易）
 *
 * 自动交易逻辑已迁移到 autoTradeService.ts
 * 去重窗口从 24h 缩短为 2h，避免过于激进地抑制通知
 *
 * Telegram 配置：在项目根目录创建 .env 文件（参考 .env.example）
 *   TELEGRAM_BOT_TOKEN=xxx   (服務端環境變量，不含 VITE_ 前綴)
 *   TELEGRAM_CHAT_ID=xxx
 */

import { Alert, StockAnalysis, TechnicalIndicators } from '../types';
import { pushAlertToServer, sendTelegramViaServer } from './serverBridge';

const DEDUP_WINDOW_MS = 2 * 60 * 60 * 1000; // 2小时去重

/**
 * 根據技術指標計算止盈止損價位
 * 多空：止損取布林下軌 / VAL（支撑區下緣），止盈取布林上軌 / VAH（阻力區上緣）
 * 做空：反之
 * 最小 R:R = 1.5，止損不超過價格的 8%
 */
function calcTPSL(
  price: number,
  type: 'buy' | 'sell' | 'top' | 'bottom',
  ind: TechnicalIndicators,
): { takeProfit: number; stopLoss: number } {
  const isLong = type === 'buy' || type === 'bottom';

  // ATR 估算：布林帶寬 = (upper - lower)，入場風險大約為它的 1/4
  const bollWidth = ind.bollUp - ind.bollDn;
  const atr       = bollWidth > 0 ? bollWidth / 4 : price * 0.015;

  if (isLong) {
    // 止損：取「已在價格下方」的支撑位中最高的一個
    const slCands = [ind.bollDn, ind.valueAreaLow]
      .filter(v => v > 0 && v < price);
    let stopLoss = slCands.length
      ? Math.max(...slCands)
      : price - atr * 2;
    stopLoss = Math.max(stopLoss, price * 0.92);  // 最大止損 8%

    const risk = price - stopLoss;

    // 止盈：取「已在價格上方」的阻力位中最低的一個，且满足 R:R ≥1.5
    const minTP     = price + risk * 1.5;
    const tpCands   = [ind.bollUp, ind.valueAreaHigh]
      .filter(v => v > 0 && v >= minTP);
    const takeProfit = tpCands.length
      ? Math.min(...tpCands)
      : price + risk * 2;

    return {
      takeProfit: Math.max(takeProfit, minTP),
      stopLoss,
    };
  } else {
    // 止損：取「已在價格上方」的阻力位中最低的一個
    const slCands = [ind.bollUp, ind.valueAreaHigh]
      .filter(v => v > 0 && v > price);
    let stopLoss = slCands.length
      ? Math.min(...slCands)
      : price + atr * 2;
    stopLoss = Math.min(stopLoss, price * 1.08);  // 最大止損 8%

    const risk = stopLoss - price;

    // 止盈：取「已在價格下方」的支撑位中最高的一個，且满足 R:R ≥1.5
    const minTP     = price - risk * 1.5;
    const tpCands   = [ind.bollDn, ind.valueAreaLow]
      .filter(v => v > 0 && v <= minTP);
    const takeProfit = tpCands.length
      ? Math.max(...tpCands)
      : price - risk * 2;

    return {
      takeProfit: Math.min(takeProfit, minTP),
      stopLoss,
    };
  }
}

class AlertService {
  private alerts: Alert[] = [];
  private maxAlerts = 200;
  private counter   = 0;
  private onChange: (() => void) | null = null;

  setOnChange(cb: () => void): void { this.onChange = cb; }
  private notify(): void { this.onChange?.(); }

  createAlert(
    analysis: StockAnalysis,
    type: 'buy' | 'sell' | 'top' | 'bottom',
    signal: { signal: boolean; level: 'high' | 'medium' | 'low' | null; score: number; reasons: string[] },
  ): Alert | null {
    if (!signal.signal || !signal.level) return null;

    const now = Date.now();
    const pri: Record<string, number> = { high: 3, medium: 2, low: 1 };

    const dup = this.alerts.some(
      a =>
        a.symbol     === analysis.symbol &&
        a.type       === type &&
        pri[a.level] >= pri[signal.level!] &&
        now - a.timestamp < DEDUP_WINDOW_MS,
    );
    if (dup) return null;

    const icons:     Record<string, string> = { buy: '🟢', sell: '🔴', top: '🔺', bottom: '🔻' };
    const typeLabel: Record<string, string> = { buy: '買入', sell: '賣出', top: '頂部', bottom: '底部' };
    const lvLabel:   Record<string, string> = { high: '高', medium: '中', low: '低' };

    const alert: Alert = {
      id:        `alert_${now}_${++this.counter}`,
      symbol:    analysis.symbol,
      type,
      level:     signal.level,
      price:     analysis.price,
      score:     signal.score,
      reasons:   signal.reasons,
      timestamp: now,
      read:      false,
      message:   `${icons[type]} ${analysis.symbol} ${typeLabel[type]}信號 [${lvLabel[signal.level]}] $${analysis.price.toFixed(2)} | ${signal.score}分`,
      ...calcTPSL(analysis.price, type, analysis.indicators),
    };

    this.alerts.unshift(alert);
    if (this.alerts.length > this.maxAlerts) this.alerts.length = this.maxAlerts;

    // Push to server for external monitoring
    pushAlertToServer(alert);

    // Send to Telegram via server（服務端統一發送，避免 CORS，Token 不暴露於前端）
    const fmt = (v: number) => `$${v.toFixed(v >= 100 ? 2 : 4)}`;
    const tgMsg =
      `🚸 *股票預警*\n\n` +
      `${icons[type]} *${analysis.symbol}* ${typeLabel[type]}信號\n` +
      `等級：${lvLabel[signal.level]}  |  價格：${fmt(analysis.price)}  |  評分：${signal.score}分\n` +
      (alert.takeProfit ? `🎯 止盈：${fmt(alert.takeProfit)}` : '') +
      (alert.stopLoss   ? `  🛡️ 止損：${fmt(alert.stopLoss)}` : '') +
      (alert.takeProfit && alert.stopLoss
        ? `  \`R:R ${ ((Math.abs(alert.takeProfit - analysis.price)) / Math.abs(alert.stopLoss - analysis.price)).toFixed(1) }:1\`\n`
        : '\n') +
      signal.reasons.slice(0, 3).map(r => '• ' + r).join('\n');
    sendTelegramViaServer(tgMsg);

    this.notify();
    return alert;
  }

  flush(): void { this.notify(); }

  getAlerts():      Alert[]  { return this.alerts; }
  getUnreadCount(): number   { return this.alerts.filter(a => !a.read).length; }

  markAsRead(id: string): void {
    const a = this.alerts.find(x => x.id === id);
    if (a) { a.read = true; this.notify(); }
  }
  markAllAsRead(): void { this.alerts.forEach(a => { a.read = true; }); this.notify(); }
  clearAlerts():   void { this.alerts = []; this.notify(); }
  removeAlert(id: string): void {
    this.alerts = this.alerts.filter(a => a.id !== id);
    this.notify();
  }

  // 保留兼容性 stub（已迁移到 autoTradeService）
  initSimulator(_balance: number = 100000): void {}
  setAutoTrade(_enabled: boolean): void {}
  isAutoTradeEnabled(): boolean { return false; }
}

export const alertService = new AlertService();
