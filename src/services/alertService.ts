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
 * 機構級止盈止損計算引擎 v6 — V2止損紀律 × V5三重確認 × 無確認跳單
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  V6 設計原則：                                                           │
 * │  ① 無任何三重確認信號（SFP/CVD/CHoCH）→ 不入場，直接跳過（最大創新）      │
 * │  ② 止損 = V2 式 ATR 結構止損，緊貼波段低點，硬性上限收緊至 5%            │
 * │  ③ 部分確認（1-2個）→ 保守 TP（V2 級別，1.5~2.0R）                      │
 * │  ④ 全面確認（SFP/CVD + CHoCH）→ 機構級 TP（V4/V5 共振目標，2.5~3.0R）   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * 止損因子（多頭，按分數排序）：
 *   SFP底部確認     +8  主力掃止損完成點 = 精確失效點
 *   結構波段低點     +6  V2核心：3根pivot確認的低點
 *   訂單塊 OB底邊   +5  機構做多保護位
 *   FVG底邊         +5  缺口填補 = 支撐失效
 *   BOS支撐位        +4  結構翻轉確認點
 *   黃金口袋 61.8%  +4  趨勢失效線
 *   VWAP-20 動態支撐 +3  機構短期錨點
 *   自適應ATR倍數    +3  噪音緩衝
 *   VAL / 布林下軌   +2  統計邊界
 *
 * 止盈因子（多頭，全確認層）：
 *   SFP+流動性池    +10  最強磁鐵：SFP確認後追到整個流動性池
 *   流動性聚集池     +9  等高點群，機構必掃
 *   多重斐波共振     +8  多波段Fib聚合 = 極強目標
 *   FVG缺口底邊      +7  缺口填補目標
 *   衝動Fib 1.618    +6  結構投射
 *   結構波段頂        +5  天然賣壓
 *   前波段頂          +4  更大結構阻力
 *   斐波 1.618        +3  基礎Fib擴展
 *   成交量 VAH/POC   +3  流動性磁鐵
 *
 * 止盈因子（部分確認層）：
 *   FVG缺口底邊      +5  中等目標
 *   VWAP-20          +4  均值回歸第一目標
 *   結構波段頂/前高   +4/3  保守入場不追遠目標
 */
function calcTPSL(
  price: number,
  type: 'buy' | 'sell' | 'top' | 'bottom',
  ind: TechnicalIndicators,
): { takeProfit: number; stopLoss: number; confirmationLevel: 'full' | 'partial' } | null {
  const isLong = type === 'buy' || type === 'bottom';

  // ── V6 核心：三重確認門檻 ───────────────────────────────────────
  const longConfirmed  = (ind.sfpBull || ind.cvdBullDiv) && ind.chochBull;
  const shortConfirmed = (ind.sfpBear || ind.cvdBearDiv) && ind.chochBear;
  const longPartial    = ind.sfpBull || ind.cvdBullDiv || ind.chochBull;
  const shortPartial   = ind.sfpBear || ind.cvdBearDiv || ind.chochBear;

  const confirmed = isLong ? longConfirmed : shortConfirmed;
  const partial   = isLong ? longPartial   : shortPartial;

  // 無任何確認信號 → 跳過此信號，不生成止盈止損（不入場）
  if (!confirmed && !partial) return null;

  const atr = ind.atr14 > 0
    ? ind.atr14
    : ind.bollWidth > 0 ? (ind.bollUp - ind.bollDn) / 4 : price * 0.015;

  // ── V6 自適應 ATR 倍數：全確認再緊 15%，部分確認維持正常 ──────
  const baseAtrM =
    ind.bollSqueezing ? 1.0 :
    ind.adx > 35      ? 1.5 :
    ind.adx > 25      ? 1.8 :
    ind.adx > 15      ? 2.2 : 2.5;
  const atrMult = confirmed ? baseAtrM * 0.85 : baseAtrM * 0.95;

  // ── V6 R:R：全確認 +0.5R，部分確認維持基礎 ──────────────────
  const baseRR  = ind.adx > 30 ? 2.5 : ind.adx > 20 ? 2.0 : 1.5;
  const targetRR = confirmed ? baseRR + 0.5 : baseRR;

  // ── 黃金口袋（61.8% 回撤失效點）──────────────────────────────
  const goldenPocketLong = (ind.prevSwingLow > 0 && ind.swingHigh > ind.prevSwingLow)
    ? ind.swingHigh - 0.618 * (ind.swingHigh - ind.prevSwingLow) : 0;
  const goldenPocketShort = (ind.prevSwingHigh > 0 && ind.swingLow < ind.prevSwingHigh)
    ? ind.swingLow + 0.618 * (ind.prevSwingHigh - ind.swingLow) : 0;

  // ── 衝動幅度（用於斐波那契通道投射，比單純用 risk 更精確）──
  // impulseLong:  prevSwingLow → swingHigh 的完整上漲衝動
  // impulseShort: swingLow → prevSwingHigh 的完整下跌衝動
  const impulseLong =
    (ind.swingHigh > 0 && ind.prevSwingLow > 0 && ind.swingHigh > ind.prevSwingLow)
      ? ind.swingHigh - ind.prevSwingLow : 0;
  const impulseShort =
    (ind.swingLow > 0 && ind.prevSwingHigh > 0 && ind.prevSwingHigh > ind.swingLow)
      ? ind.prevSwingHigh - ind.swingLow : 0;

  interface Cand { value: number; score: number; tag: string }

  /** 兩個候選位在同一 pct 帶內 → 雙方各加 bonus 分（共振加成） */
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
    // ════════════════════════════════════════════════════════
    //  LONG 止損候選集（V6：SFP精確點最高分，波段結構為主幹）
    // ════════════════════════════════════════════════════════
    const slCands: Cand[] = [];

    // ① [V6] SFP 底部精確止損（主力剛完成掃止損 = 最精確失效點，最高優先）
    if (ind.sfpBull && ind.swingLow > 0 && ind.swingLow < price) {
      slCands.push({ value: ind.swingLow - atr * 0.15, score: 8, tag: 'sfpBull_sl' });
    }
    // ② 結構性波段低點（V2核心：3根pivot確認，緊貼低點下方 0.3ATR）
    if (ind.swingLow > 0 && ind.swingLow < price) {
      slCands.push({ value: ind.swingLow - atr * 0.3, score: 6, tag: 'struct' });
    }
    // ③ 訂單塊 OB 底邊（機構做多保護位，跌破=機構放棄多頭）
    if (ind.bullOBLow > 0 && ind.bullOBLow < price) {
      slCands.push({ value: ind.bullOBLow - atr * 0.1, score: 5, tag: 'ob' });
    }
    // ④ 看漲 FVG 底邊（FVG 完全填補 = 支撐結構徹底失效）
    if (ind.fvgBullBot > 0 && ind.fvgBullBot < price) {
      slCands.push({ value: ind.fvgBullBot - atr * 0.1, score: 5, tag: 'fvgBullBot' });
    }
    // ⑤ BOS 支撐（被向上突破的舊阻力翻轉為支撐）
    if (ind.bosSupport > 0 && ind.bosSupport < price) {
      slCands.push({ value: ind.bosSupport - atr * 0.1, score: 4, tag: 'bosSupport' });
    }
    // ⑥ 黃金口袋 61.8%（衝動超過此回撤 = 趨勢結構破壞）
    if (goldenPocketLong > 0 && goldenPocketLong < price) {
      slCands.push({ value: goldenPocketLong - atr * 0.1, score: 4, tag: 'gp618' });
    }
    // ⑦ VWAP-20（機構短期錨點）
    if (ind.vwap20 > 0 && ind.vwap20 < price * 0.99) {
      slCands.push({ value: ind.vwap20 - atr * 0.05, score: 3, tag: 'vwap20' });
    }
    // ⑧ 自適應 ATR 止損（噪音緩衝兜底）
    slCands.push({ value: price - atr * atrMult, score: 3, tag: 'atr' });
    // ⑨ 成交量 VAL / 布林下軌（統計邊界）
    if (ind.valueAreaLow > 0 && ind.valueAreaLow < price) {
      slCands.push({ value: ind.valueAreaLow, score: 2, tag: 'val' });
    }
    if (ind.bollDn > 0 && ind.bollDn < price) {
      slCands.push({ value: ind.bollDn, score: 2, tag: 'boll' });
    }

    applyClusterBonus(slCands, 0.005, 2);

    const hardFloor = price * 0.95;          // V6 收緊至 5%（V5 為 7%）
    const maxSL     = price - atr * 0.2;     // 最小距離：≥ 0.2 ATR
    const validSL   = slCands.filter(c => c.value >= hardFloor && c.value <= maxSL);

    const bestSL = validSL.length > 0
      ? validSL.sort((a, b) => b.score - a.score || b.value - a.value)[0]
      : { value: Math.max(price - atr * atrMult, hardFloor), score: 0, tag: 'fallback' };

    const stopLoss = Math.max(bestSL.value, hardFloor);
    const risk     = price - stopLoss;

    // ════════════════════════════════════════════════════════
    //  LONG 止盈候選集（全確認走機構級遠目標，部分確認走保守 V2 目標）
    // ════════════════════════════════════════════════════════
    const minTP   = price + risk * 1.5;
    const idealTP = price + risk * targetRR;
    const tpCands: Cand[] = [];

    // 共同基礎層（部分確認 + 全確認都採用）
    if (ind.swingHigh > 0 && ind.swingHigh >= minTP) {
      tpCands.push({ value: ind.swingHigh, score: 5, tag: 'struct' });
    }
    if (ind.prevSwingHigh > 0 && ind.prevSwingHigh >= minTP) {
      tpCands.push({ value: ind.prevSwingHigh, score: 4, tag: 'struct2' });
    }
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh >= minTP) {
      tpCands.push({ value: ind.valueAreaHigh, score: 3, tag: 'vah' });
    }
    if (ind.bollUp > 0 && ind.bollUp >= minTP) {
      tpCands.push({ value: ind.bollUp, score: 2, tag: 'boll' });
    }
    const fibR1618 = price + risk * 1.618;
    const fibR1272 = price + risk * 1.272;
    if (fibR1618 >= minTP) tpCands.push({ value: fibR1618, score: 4, tag: 'fib_r1618' });
    if (fibR1272 >= minTP) tpCands.push({ value: fibR1272, score: 3, tag: 'fib_r1272' });
    if (ind.ma60 > 0 && ind.ma60 >= minTP) tpCands.push({ value: ind.ma60, score: 1, tag: 'ma60' });
    if (idealTP > minTP) tpCands.push({ value: idealTP, score: 2, tag: 'dynamic' });

    if (confirmed) {
      // 全確認：啟用所有機構級遠目標
      if (ind.liqHigh > 0 && ind.liqHigh >= minTP) {
        tpCands.push({ value: ind.liqHigh * 0.998, score: 9, tag: 'liq' });
      }
      if (ind.sfpBull && ind.liqHigh > 0 && ind.liqHigh >= minTP) {
        tpCands.push({ value: ind.liqHigh * 0.996, score: 10, tag: 'sfpBull_liq' });
      }
      if (ind.fibConvAbove > 0 && ind.fibConvAbove >= minTP) {
        tpCands.push({ value: ind.fibConvAbove, score: 9, tag: 'fibConvAbove' });
      }
      if (ind.fvgBearBot > 0 && ind.fvgBearBot >= minTP) {
        tpCands.push({ value: ind.fvgBearBot, score: 7, tag: 'fvgBearBot' });
      }
      if (impulseLong > 0 && ind.swingHigh > 0) {
        const fibCh1618 = ind.swingHigh + 0.618 * impulseLong;
        if (fibCh1618 >= minTP) tpCands.push({ value: fibCh1618, score: 6, tag: 'fibCh1618' });
      }
      if (ind.poc > price && ind.poc >= minTP) {
        tpCands.push({ value: ind.poc, score: 3, tag: 'poc' });
      }
    } else {
      // 部分確認：只開放 FVG 和 VWAP 中等目標（不追最遠）
      if (ind.fvgBearBot > 0 && ind.fvgBearBot >= minTP) {
        tpCands.push({ value: ind.fvgBearBot, score: 5, tag: 'fvgBearBot' });
      }
      if (ind.vwap20 > 0 && ind.vwap20 >= minTP) {
        tpCands.push({ value: ind.vwap20, score: 4, tag: 'vwap20_tp' });
      }
    }

    // 共振加成：0.8% 內多因子聚合（結構 + 斐波 = 極強目標）
    applyClusterBonus(tpCands, 0.008, 3);

    const bestTP = tpCands.length > 0
      ? tpCands.sort((a, b) => b.score - a.score || a.value - b.value)[0]
      : { value: price + risk * 2.0, score: 0, tag: 'fallback' };

    return {
      takeProfit: Math.max(bestTP.value, minTP),
      stopLoss,
      confirmationLevel: confirmed ? 'full' : 'partial',
    };
  } else {
    // ════════════════════════════════════════════════════════
    //  SHORT 止損候選集（V6：SFP精確點最高分，波段結構為主幹）
    // ════════════════════════════════════════════════════════
    const slCands: Cand[] = [];

    // ① SFP 頂部精確止損（最高優先）
    if (ind.sfpBear && ind.swingHigh > 0 && ind.swingHigh > price) {
      slCands.push({ value: ind.swingHigh + atr * 0.15, score: 8, tag: 'sfpBear_sl' });
    }
    // ② 結構性波段高點（V2核心）
    if (ind.swingHigh > 0 && ind.swingHigh > price) {
      slCands.push({ value: ind.swingHigh + atr * 0.3, score: 6, tag: 'struct' });
    }
    // ③ 訂單塊 OB 頂邊
    if (ind.bearOBHigh > 0 && ind.bearOBHigh > price) {
      slCands.push({ value: ind.bearOBHigh + atr * 0.1, score: 5, tag: 'ob' });
    }
    // ④ 看跌 FVG 頂邊
    if (ind.fvgBearTop > 0 && ind.fvgBearTop > price) {
      slCands.push({ value: ind.fvgBearTop + atr * 0.1, score: 5, tag: 'fvgBearTop' });
    }
    // ⑤ BOS 阻力
    if (ind.bosResistance > 0 && ind.bosResistance > price) {
      slCands.push({ value: ind.bosResistance + atr * 0.1, score: 4, tag: 'bosResistance' });
    }
    // ⑥ 黃金口袋 61.8%
    if (goldenPocketShort > 0 && goldenPocketShort > price) {
      slCands.push({ value: goldenPocketShort + atr * 0.1, score: 4, tag: 'gp618' });
    }
    // ⑦ VWAP-20 動態阻力
    if (ind.vwap20 > 0 && ind.vwap20 > price * 1.01) {
      slCands.push({ value: ind.vwap20 + atr * 0.05, score: 3, tag: 'vwap20' });
    }
    // ⑧ 自適應 ATR 止損
    slCands.push({ value: price + atr * atrMult, score: 3, tag: 'atr' });
    // ⑨ 成交量 VAH / 布林上軌
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh > price) {
      slCands.push({ value: ind.valueAreaHigh, score: 2, tag: 'vah' });
    }
    if (ind.bollUp > 0 && ind.bollUp > price) {
      slCands.push({ value: ind.bollUp, score: 2, tag: 'boll' });
    }

    applyClusterBonus(slCands, 0.005, 2);

    const hardCeil = price * 1.05;           // V6 收緊至 5%
    const minSL    = price + atr * 0.2;
    const validSL  = slCands.filter(c => c.value >= minSL && c.value <= hardCeil);

    const bestSL = validSL.length > 0
      ? validSL.sort((a, b) => b.score - a.score || a.value - b.value)[0]
      : { value: Math.min(price + atr * atrMult, hardCeil), score: 0, tag: 'fallback' };

    const stopLoss = Math.min(bestSL.value, hardCeil);
    const risk     = stopLoss - price;

    // ════════════════════════════════════════════════════════
    //  SHORT 止盈候選集（全確認走機構級遠目標，部分確認走保守目標）
    // ════════════════════════════════════════════════════════
    const minTP   = price - risk * 1.5;
    const idealTP = price - risk * targetRR;
    const tpCands: Cand[] = [];

    // 共同基礎層
    if (ind.swingLow > 0 && ind.swingLow <= minTP) {
      tpCands.push({ value: ind.swingLow, score: 5, tag: 'struct' });
    }
    if (ind.prevSwingLow > 0 && ind.prevSwingLow <= minTP) {
      tpCands.push({ value: ind.prevSwingLow, score: 4, tag: 'struct2' });
    }
    if (ind.valueAreaLow > 0 && ind.valueAreaLow <= minTP) {
      tpCands.push({ value: ind.valueAreaLow, score: 3, tag: 'val' });
    }
    if (ind.bollDn > 0 && ind.bollDn <= minTP) {
      tpCands.push({ value: ind.bollDn, score: 2, tag: 'boll' });
    }
    const fibR1618s = price - risk * 1.618;
    if (fibR1618s <= minTP) tpCands.push({ value: fibR1618s, score: 3, tag: 'fib_r1618' });
    if (idealTP < minTP) tpCands.push({ value: idealTP, score: 2, tag: 'dynamic' });

    if (confirmed) {
      // 全確認：啟用所有機構級遠目標
      if (ind.liqLow > 0 && ind.liqLow <= minTP) {
        tpCands.push({ value: ind.liqLow * 1.002, score: 9, tag: 'liq' });
      }
      if (ind.sfpBear && ind.liqLow > 0 && ind.liqLow <= minTP) {
        tpCands.push({ value: ind.liqLow * 1.004, score: 10, tag: 'sfpBear_liq' });
      }
      if (ind.fibConvBelow > 0 && ind.fibConvBelow <= minTP) {
        tpCands.push({ value: ind.fibConvBelow, score: 8, tag: 'fibConvBelow' });
      }
      if (ind.fvgBullTop > 0 && ind.fvgBullTop <= minTP) {
        tpCands.push({ value: ind.fvgBullTop, score: 7, tag: 'fvgBullTop' });
      }
      if (impulseShort > 0 && ind.swingLow > 0) {
        const fibCh1618 = ind.swingLow - 0.618 * impulseShort;
        if (fibCh1618 <= minTP) tpCands.push({ value: fibCh1618, score: 6, tag: 'fibCh1618' });
      }
      if (ind.poc > 0 && ind.poc < price && ind.poc <= minTP) {
        tpCands.push({ value: ind.poc, score: 3, tag: 'poc' });
      }
    } else {
      if (ind.fvgBullTop > 0 && ind.fvgBullTop <= minTP) {
        tpCands.push({ value: ind.fvgBullTop, score: 5, tag: 'fvgBullTop' });
      }
      if (ind.vwap20 > 0 && ind.vwap20 <= minTP) {
        tpCands.push({ value: ind.vwap20, score: 4, tag: 'vwap20_tp' });
      }
    }

    applyClusterBonus(tpCands, 0.008, 3);

    const bestTP = tpCands.length > 0
      ? tpCands.sort((a, b) => b.score - a.score || b.value - a.value)[0]
      : { value: price - risk * 2.0, score: 0, tag: 'fallback' };

    return {
      takeProfit: Math.min(bestTP.value, minTP),
      stopLoss,
      confirmationLevel: confirmed ? 'full' : 'partial',
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

    // V6：無確認信號時跳過（不生成警報）
    const tpsl = calcTPSL(analysis.price, type, analysis.indicators);
    if (tpsl === null) return null;

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
      message:   `${icons[type]} ${analysis.symbol} ${typeLabel[type]}信號 [${lvLabel[signal.level]}] $${analysis.price.toFixed(2)} | ${signal.score}分 | ${tpsl.confirmationLevel === 'full' ? '全確認' : '部分確認'}`,
      ...tpsl,
    };

    this.alerts.unshift(alert);
    if (this.alerts.length > this.maxAlerts) this.alerts.length = this.maxAlerts;

    // Push to server for external monitoring
    pushAlertToServer(alert);

    // Send to Telegram via server（服務端統一發送，避免 CORS，Token 不暴露於前端）
    const fmt = (v: number) => `$${v.toFixed(v >= 100 ? 2 : 4)}`;
    // 買入/底部：高值 = 止盈目標；賣出/頂部：高值 = 風控點，低值 = 目標位
    const isLongAlert = type === 'buy' || type === 'bottom';
    const upperVal   = isLongAlert ? alert.takeProfit : alert.stopLoss;
    const lowerVal   = isLongAlert ? alert.stopLoss   : alert.takeProfit;
    const upperLabel = isLongAlert ? '🎯 止盈' : '⚠️ 風控';
    const lowerLabel = isLongAlert ? '🛡️ 止損' : '🎯 目標';
    const confLabel = alert.confirmationLevel === 'full' ? '🔒 全確認' : '⚡ 部分確認';
    const tgMsg =
      `🚸 *股票預警*\n\n` +
      `${icons[type]} *${analysis.symbol}* ${typeLabel[type]}信號\n` +
      `等級：${lvLabel[signal.level]}  |  確認度：${confLabel}  |  評分：${signal.score}分\n` +
      `價格：${fmt(analysis.price)}\n` +
      (upperVal ? `${upperLabel}：${fmt(upperVal)}` : '') +
      (lowerVal ? `  ${lowerLabel}：${fmt(lowerVal)}` : '') +
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
