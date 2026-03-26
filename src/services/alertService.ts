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
 * 機構級止盈止損計算引擎 v2
 *
 * 設計原則：
 *   止損 → 失效點位：結構性高低點 + ATR 緩衝，價格突破即交易邏輯失效
 *   止盈 → 目標集群：下一阻力/支撐 × 斐波那契擴展 × 成交量分布共振
 *   驗證 → 品質門檻：R:R ≥ 1.5；止損幅度 ≤ 7%
 *
 * 多因子評分（止損候選 / 止盈候選各自使用）：
 *   結構性波段高低點  +5  ← 機構最看重的訂單流錨位
 *   斐波那契黃金比例  +4  ← 1.618 擴展（自然界黃金分割）
 *   斐波那契次級延伸  +3  ← 1.272 擴展
 *   成交量分布 (VAH/VAL/POC)  +3  ← 流動性最濃縮的節點
 *   均線動態支撐      +2  ← EMA21 trend-following 動能
 *   布林帶邊界        +2  ← 統計標準差偏離邊界
 *   多位置共振加成    +2~+3  ← 兩個不同因子在同一區間聚集
 */
function calcTPSL(
  price: number,
  type: 'buy' | 'sell' | 'top' | 'bottom',
  ind: TechnicalIndicators,
): { takeProfit: number; stopLoss: number } {
  const isLong = type === 'buy' || type === 'bottom';

  // ATR：優先使用真實 14 期威爾德 ATR；無數據時降級布林帶估算
  const atr = ind.atr14 > 0
    ? ind.atr14
    : ind.bollWidth > 0
      ? (ind.bollUp - ind.bollDn) / 4
      : price * 0.015;

  interface Cand { value: number; score: number; tag: string }

  /** 兩個候選位置相差 ≤ pct 時，視為「共振」，雙方各加 bonus 分 */
  function applyClusterBonus(cands: Cand[], pct: number, bonus: number): void {
    for (let i = 0; i < cands.length; i++) {
      for (let j = i + 1; j < cands.length; j++) {
        if (Math.abs(cands[i].value - cands[j].value) / price <= pct) {
          cands[i].score += bonus;
          cands[j].score += bonus;
        }
      }
    }
  }

  if (isLong) {
    // ════════════════════════════════════════════
    //  LONG — 止損候選集
    // ════════════════════════════════════════════
    const slCands: Cand[] = [];

    // ① 結構性止損：最近波段低點下方 0.3 ATR 緩衝
    //    機構止損掛在波段低點之下，被拂掃即趨勢反轉，撤場有據
    if (ind.swingLow > 0 && ind.swingLow < price) {
      slCands.push({ value: ind.swingLow - atr * 0.3, score: 5, tag: 'struct' });
    }

    // ② ATR 止損：2 倍 ATR（2σ 噪音過濾）
    slCands.push({ value: price - atr * 2.0, score: 3, tag: 'atr' });

    // ③ 布林下軌（短期統計支撐）
    if (ind.bollDn > 0 && ind.bollDn < price) {
      slCands.push({ value: ind.bollDn, score: 2, tag: 'boll' });
    }

    // ④ 成交量分布低位（VAL）—— 流動性重心下沿
    if (ind.valueAreaLow > 0 && ind.valueAreaLow < price) {
      slCands.push({ value: ind.valueAreaLow, score: 2, tag: 'val' });
    }

    // ⑤ EMA21 動態支撐（趨勢市 ADX>20 才有效）
    if (ind.ema21 > 0 && ind.ema21 < price && ind.adx > 20) {
      slCands.push({ value: ind.ema21, score: 2, tag: 'ema21' });
    }

    // 共振加成：同一 0.5% 區間多重因子 → 確認性更強
    applyClusterBonus(slCands, 0.005, 2);

    // 有效邊界：SL 在 [price×0.93, price - 0.3×atr]
    const hardFloor = price * 0.93;
    const maxSL     = price - atr * 0.3;
    const validSL   = slCands.filter(c => c.value >= hardFloor && c.value <= maxSL);

    // 同分優先選較靠近入場的（更精確）
    const bestSL = validSL.length > 0
      ? validSL.sort((a, b) => b.score - a.score || b.value - a.value)[0]
      : { value: Math.max(price - atr * 2, hardFloor), score: 0, tag: 'fallback' };

    const stopLoss = Math.max(bestSL.value, hardFloor);
    const risk     = price - stopLoss;

    // ════════════════════════════════════════════
    //  LONG — 止盈候選集
    // ════════════════════════════════════════════
    const minTP    = price + risk * 1.5;           // 最低 1.5:1 R:R
    const tpCands: Cand[] = [];

    // ① 結構性目標：最近 / 前一個波段高點（天然流動性節點）
    if (ind.swingHigh > 0 && ind.swingHigh >= minTP) {
      tpCands.push({ value: ind.swingHigh, score: 5, tag: 'struct' });
    }
    if (ind.prevSwingHigh > 0 && ind.prevSwingHigh >= minTP) {
      tpCands.push({ value: ind.prevSwingHigh, score: 4, tag: 'struct2' });
    }

    // ② 斐波那契擴展（以 risk 為底邊，黃金比例投射目標）
    const fib1272 = price + risk * 1.272;
    const fib1618 = price + risk * 1.618;  // 黃金比例，機構最常使用
    const fib2000 = price + risk * 2.000;
    if (fib1272 >= minTP) tpCands.push({ value: fib1272, score: 3, tag: 'fib1272' });
    if (fib1618 >= minTP) tpCands.push({ value: fib1618, score: 4, tag: 'fib1618' });
    if (fib2000 >= minTP) tpCands.push({ value: fib2000, score: 2, tag: 'fib2000' });

    // ③ 成交量分布（POC / VAH）—— 流動性磁鐵
    if (ind.poc > price && ind.poc >= minTP) {
      tpCands.push({ value: ind.poc, score: 3, tag: 'poc' });
    }
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh >= minTP) {
      tpCands.push({ value: ind.valueAreaHigh, score: 3, tag: 'vah' });
    }

    // ④ 布林上軌（統計阻力）
    if (ind.bollUp > 0 && ind.bollUp >= minTP) {
      tpCands.push({ value: ind.bollUp, score: 2, tag: 'boll' });
    }

    // ⑤ MA60（大週期均線壓力）
    if (ind.ma60 > 0 && ind.ma60 >= minTP) {
      tpCands.push({ value: ind.ma60, score: 1, tag: 'ma60' });
    }

    // 共振加成：0.8% 區間多因子聚集（結構 + 斐波那契 → 極強目標）
    applyClusterBonus(tpCands, 0.008, 3);

    // 同分優先選較近的（更易觸及）
    const bestTP = tpCands.length > 0
      ? tpCands.sort((a, b) => b.score - a.score || a.value - b.value)[0]
      : { value: fib1618 >= minTP ? fib1618 : minTP, score: 0, tag: 'fallback' };

    return {
      takeProfit: Math.max(bestTP.value, minTP),
      stopLoss,
    };
  } else {
    // ════════════════════════════════════════════
    //  SHORT — 止損候選集
    // ════════════════════════════════════════════
    const slCands: Cand[] = [];

    if (ind.swingHigh > 0 && ind.swingHigh > price) {
      slCands.push({ value: ind.swingHigh + atr * 0.3, score: 5, tag: 'struct' });
    }
    slCands.push({ value: price + atr * 2.0, score: 3, tag: 'atr' });
    if (ind.bollUp > 0 && ind.bollUp > price) {
      slCands.push({ value: ind.bollUp, score: 2, tag: 'boll' });
    }
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh > price) {
      slCands.push({ value: ind.valueAreaHigh, score: 2, tag: 'vah' });
    }
    if (ind.ema21 > 0 && ind.ema21 > price && ind.adx > 20) {
      slCands.push({ value: ind.ema21, score: 2, tag: 'ema21' });
    }

    applyClusterBonus(slCands, 0.005, 2);

    const hardCeil = price * 1.07;
    const minSL    = price + atr * 0.3;
    const validSL  = slCands.filter(c => c.value >= minSL && c.value <= hardCeil);

    const bestSL = validSL.length > 0
      ? validSL.sort((a, b) => b.score - a.score || a.value - b.value)[0]
      : { value: Math.min(price + atr * 2, hardCeil), score: 0, tag: 'fallback' };

    const stopLoss = Math.min(bestSL.value, hardCeil);
    const risk     = stopLoss - price;

    // ════════════════════════════════════════════
    //  SHORT — 止盈候選集
    // ════════════════════════════════════════════
    const minTP    = price - risk * 1.5;
    const tpCands: Cand[] = [];

    if (ind.swingLow > 0 && ind.swingLow <= minTP) {
      tpCands.push({ value: ind.swingLow, score: 5, tag: 'struct' });
    }
    if (ind.prevSwingLow > 0 && ind.prevSwingLow <= minTP) {
      tpCands.push({ value: ind.prevSwingLow, score: 4, tag: 'struct2' });
    }

    const fib1272 = price - risk * 1.272;
    const fib1618 = price - risk * 1.618;
    const fib2000 = price - risk * 2.000;
    if (fib1272 <= minTP) tpCands.push({ value: fib1272, score: 3, tag: 'fib1272' });
    if (fib1618 <= minTP) tpCands.push({ value: fib1618, score: 4, tag: 'fib1618' });
    if (fib2000 <= minTP) tpCands.push({ value: fib2000, score: 2, tag: 'fib2000' });

    if (ind.poc > 0 && ind.poc < price && ind.poc <= minTP) {
      tpCands.push({ value: ind.poc, score: 3, tag: 'poc' });
    }
    if (ind.valueAreaLow > 0 && ind.valueAreaLow <= minTP) {
      tpCands.push({ value: ind.valueAreaLow, score: 3, tag: 'val' });
    }
    if (ind.bollDn > 0 && ind.bollDn <= minTP) {
      tpCands.push({ value: ind.bollDn, score: 2, tag: 'boll' });
    }
    if (ind.ma60 > 0 && ind.ma60 <= minTP) {
      tpCands.push({ value: ind.ma60, score: 1, tag: 'ma60' });
    }

    applyClusterBonus(tpCands, 0.008, 3);

    const bestTP = tpCands.length > 0
      ? tpCands.sort((a, b) => b.score - a.score || b.value - a.value)[0]
      : { value: fib1618 <= minTP ? fib1618 : minTP, score: 0, tag: 'fallback' };

    return {
      takeProfit: Math.min(bestTP.value, minTP),
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
