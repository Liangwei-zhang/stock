/**
 * alertService.ts — 预警通知服务（纯通知，不负责交易）
 *
 * 自动交易逻辑已迁移到 autoTradeService.ts
 * 去重窗口从 24h 缩短为 2h，避免过于激进地抑制通知
 *
 * Telegram 配置：在项目根目录创建 .env 文件（参考 .env.example）
 *   VITE_TELEGRAM_BOT_TOKEN=xxx
 *   VITE_TELEGRAM_CHAT_ID=xxx
 */

import { Alert, StockAnalysis } from '../types';
import { pushAlertToServer } from './serverBridge';

const DEDUP_WINDOW_MS = 2 * 60 * 60 * 1000; // 2小时去重

// ─── Telegram 配置（从环境变量读取，不硬编码）────────────────────────────────
// 在 .env 中设置 VITE_TELEGRAM_BOT_TOKEN 和 VITE_TELEGRAM_CHAT_ID
// 未配置时 Telegram 推送静默跳过，不影响其他功能
const TELEGRAM_BOT_TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN as string | undefined;
const TELEGRAM_CHAT_ID   = import.meta.env.VITE_TELEGRAM_CHAT_ID   as string | undefined;

async function sendToTelegram(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return; // 未配置则跳过
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:    TELEGRAM_CHAT_ID,
        text:       message,
        parse_mode: 'Markdown',
      }),
    });
  } catch (e) {
    console.error('Telegram notification failed:', e);
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
    };

    this.alerts.unshift(alert);
    if (this.alerts.length > this.maxAlerts) this.alerts.length = this.maxAlerts;

    // Push to server for external monitoring
    pushAlertToServer(alert);

    // Send to Telegram（仅在 .env 配置了 token 时生效）
    const tgMsg =
      `🛎️ *股票預警*\n\n` +
      `${icons[type]} *${analysis.symbol}* ${typeLabel[type]}信號\n` +
      `等級：${lvLabel[signal.level]}\n` +
      `價格：$${analysis.price.toFixed(2)}\n` +
      `評分：${signal.score}分\n` +
      signal.reasons.slice(0, 3).map(r => '• ' + r).join('\n');
    sendToTelegram(tgMsg);

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

// ─── HMR 保護：防止 Vite 熱更新時產生多個服務實例 ────────────────────────────
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    alertService.setOnChange(() => {});
  });
}
