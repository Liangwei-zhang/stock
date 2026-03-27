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
 * 機構級止盈止損計算引擎 v3 — Smart Money Concepts × 斐波那契 × 訂單流
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  止損原則：「失效點位」—— 價格到達此處代表交易邏輯已被推翻，立即出場   │
 * │  止盈原則：「目標集群」—— 多維因子共振，取最高分且可達的阻力/支撐位   │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * 止損因子優先級（多頭為例）：
 *   ① 訂單塊 OB 底邊      +6  機構做多保護位，跌破=機構放棄多頭
 *   ② 結構性波段低點       +5  最近確認 pivot low，3根保護
 *   ③ 黃金口袋 61.8% 回撤  +4  傳統趨勢失效線（Fibonacci invalidation）
 *   ④ 自適應 ATR × 倍數    +3  基於市場環境（ADX/squeeze）的動態緩衝
 *   ⑤ 成交量 VAL / 布林下軌 +2  流動性重心下沿 / 統計偏差支撐
 *   ⑥ EMA21 動態均線       +2  趨勢市（ADX>15）才計入
 *   ⑦ 同一 0.5% 區間共振   +2  兩個不同因子聚合 → 確認度提升
 *
 * 止盈因子優先級（多頭為例）：
 *   ① 流動性池 liqHigh      +6  等高點群，機構必掃止損後反空 → 在燈芯前出
 *   ② 結構性波段頂          +5  最近 pivot high，天然賣壓集中
 *   ③ OB+斐波通道協同       +5  看跌 OB 恰在 1.618 附近 → 雙重確認
 *   ④ 看跌 OB 底邊          +4  機構空頭保護位下緣 = 供給開始
 *   ⑤ 前一波段頂            +4  更大結構阻力
 *   ⑥ 斐波那契 1.618 擴展   +4  黃金比例：最常被機構用作目標
 *   ⑦ 衝動通道斐波 1.618    +5  以實際價格結構投射（更精確）
 *   ⑧ 成交量 POC / VAH      +3  流動性磁鐵
 *   ⑨ 同一 0.8% 區間共振   +3  多因子聚合 → 極強目標
 *
 * 自適應 ATR 倍數（止損緩衝）：
 *   布林收窄 → ×1.0   超強趨勢 ADX>35 → ×1.5   強趨勢 ADX>25 → ×1.8
 *   普通 ADX>15 → ×2.2   盤整 → ×2.5
 *
 * 動態 R:R 目標：ADX>30 → 2.5:1   ADX>20 → 2.0:1   其他 → 1.5:1（最低保底）
 */
function calcTPSL(
  price: number,
  type: 'buy' | 'sell' | 'top' | 'bottom',
  ind: TechnicalIndicators,
): { takeProfit: number; stopLoss: number } {
  const isLong = type === 'buy' || type === 'bottom';

  // ── 自適應 ATR 倍數：趨勢越強止損越緊（騎趨勢），盤整給更多喘息空間 ──
  const atrMult =
    ind.bollSqueezing ? 1.0 :
    ind.adx > 35      ? 1.5 :
    ind.adx > 25      ? 1.8 :
    ind.adx > 15      ? 2.2 :
                        2.5;

  const atr = ind.atr14 > 0
    ? ind.atr14
    : ind.bollWidth > 0
      ? (ind.bollUp - ind.bollDn) / 4
      : price * 0.015;

  // ── 動態 R:R 目標：強趨勢市場可以追更遠的目標 ──
  const targetRR = ind.adx > 30 ? 2.5 : ind.adx > 20 ? 2.0 : 1.5;

  // ── 黃金口袋（Golden Pocket 61.8% 回撤）—— 交易失效點 ──
  // 若衝動的 61.8% 被回撤，原始趨勢格局已破壞，止損應置於其下
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
    //  LONG 止損候選集
    // ════════════════════════════════════════════════════════
    const slCands: Cand[] = [];

    // ① 訂單塊底邊（最高優先：機構在此保護多頭，跌破 = 他們認輸出場）
    if (ind.bullOBLow > 0 && ind.bullOBLow < price) {
      slCands.push({ value: ind.bullOBLow - atr * 0.1, score: 6, tag: 'ob' });
    }
    // ② 結構性波段低點（3根 pivot 確認，機構止損聚集區下方）
    if (ind.swingLow > 0 && ind.swingLow < price) {
      slCands.push({ value: ind.swingLow - atr * 0.3, score: 5, tag: 'struct' });
    }
    // ③ 黃金口袋 61.8%（衝動幅度超過此回撤 = 趨勢結構破壞）
    if (goldenPocketLong > 0 && goldenPocketLong < price) {
      slCands.push({ value: goldenPocketLong - atr * 0.1, score: 4, tag: 'gp618' });
    }
    // ④ 自適應 ATR 止損（噪音過濾緩衝）
    slCands.push({ value: price - atr * atrMult, score: 3, tag: 'atr' });
    // ⑤ 成交量分布低位 VAL（流動性重心下沿）
    if (ind.valueAreaLow > 0 && ind.valueAreaLow < price) {
      slCands.push({ value: ind.valueAreaLow, score: 2, tag: 'val' });
    }
    // ⑥ 布林下軌（統計支撐邊界）
    if (ind.bollDn > 0 && ind.bollDn < price) {
      slCands.push({ value: ind.bollDn, score: 2, tag: 'boll' });
    }
    // ⑦ EMA21 動態支撐（趨勢市才有效）
    if (ind.ema21 > 0 && ind.ema21 < price * 0.99) {
      slCands.push({ value: ind.ema21, score: ind.adx > 15 ? 2 : 1, tag: 'ema21' });
    }
    // ⑧ [V4] 看漲 FVG 底邊（FVG 完全填補 = 支撐結構徹底失效，SL 置於其下 0.1 ATR）
    if (ind.fvgBullBot > 0 && ind.fvgBullBot < price) {
      slCands.push({ value: ind.fvgBullBot - atr * 0.1, score: 5, tag: 'fvgBullBot' });
    }
    // ⑨ [V4] BOS 支撐（被向上突破的舊阻力翻轉為支撐，精確到結構翻轉點）
    if (ind.bosSupport > 0 && ind.bosSupport < price) {
      slCands.push({ value: ind.bosSupport - atr * 0.1, score: 4, tag: 'bosSupport' });
    }
    // ⑩ [V4] VWAP-20（機構短期錨點，在其上方做多時 VWAP 是動態支撐）
    if (ind.vwap20 > 0 && ind.vwap20 < price * 0.99) {
      slCands.push({ value: ind.vwap20 - atr * 0.05, score: 3, tag: 'vwap20' });
    }

    applyClusterBonus(slCands, 0.005, 2);

    const hardFloor = price * 0.93;          // 硬性上限 7% 止損
    const maxSL     = price - atr * 0.2;     // 最小距離：≥ 0.2 ATR
    const validSL   = slCands.filter(c => c.value >= hardFloor && c.value <= maxSL);

    const bestSL = validSL.length > 0
      ? validSL.sort((a, b) => b.score - a.score || b.value - a.value)[0]
      : { value: Math.max(price - atr * atrMult, hardFloor), score: 0, tag: 'fallback' };

    const stopLoss = Math.max(bestSL.value, hardFloor);
    const risk     = price - stopLoss;

    // ════════════════════════════════════════════════════════
    //  LONG 止盈候選集
    // ════════════════════════════════════════════════════════
    const minTP   = price + risk * 1.5;       // 最低 R:R = 1.5
    const idealTP = price + risk * targetRR;  // 動態理想目標
    const tpCands: Cand[] = [];

    // ① 流動性聚集高點（等高點群）—— 最強磁鐵：機構必然掃盪止損再反轉
    //    在池子稍下方出場（抓主升段，避開機構掃蕩反轉）
    if (ind.liqHigh > 0 && ind.liqHigh >= minTP) {
      tpCands.push({ value: ind.liqHigh * 0.998, score: 6, tag: 'liq' });
    }
    // ② 最近結構波段頂（天然賣壓最集中的節點）
    if (ind.swingHigh > 0 && ind.swingHigh >= minTP) {
      tpCands.push({ value: ind.swingHigh, score: 5, tag: 'struct' });
    }
    // ③ 衝動結構 Fib 1.618（以真實價格衝動為基礎投射，精確度優於 risk 倍數）
    if (impulseLong > 0 && ind.swingHigh > 0) {
      const fibCh1618 = ind.swingHigh + 0.618 * impulseLong;
      const fibCh1272 = ind.swingHigh + 0.272 * impulseLong;
      if (fibCh1618 >= minTP) tpCands.push({ value: fibCh1618, score: 5, tag: 'fibCh1618' });
      if (fibCh1272 >= minTP) tpCands.push({ value: fibCh1272, score: 3, tag: 'fibCh1272' });
    }
    // ④ 看跌 OB 底邊（機構空頭在此保護，到達此區供給開始大量湧出）
    if (ind.bearOBLow > 0 && ind.bearOBLow >= minTP) {
      tpCands.push({ value: ind.bearOBLow, score: 4, tag: 'bearOBLow' });
    }
    // ⑤ 前一波段頂（更大結構阻力）
    if (ind.prevSwingHigh > 0 && ind.prevSwingHigh >= minTP) {
      tpCands.push({ value: ind.prevSwingHigh, score: 4, tag: 'struct2' });
    }
    // ⑥ 風險比例斐波那契（risk-based，作為輔助確認）
    const fibR1618 = price + risk * 1.618;
    const fibR1272 = price + risk * 1.272;
    if (fibR1618 >= minTP) tpCands.push({ value: fibR1618, score: 4, tag: 'fib_r1618' });
    if (fibR1272 >= minTP) tpCands.push({ value: fibR1272, score: 3, tag: 'fib_r1272' });
    // ⑦ 成交量分布（POC / VAH）—— 流動性磁鐵，價格傾向回歸
    if (ind.poc > price && ind.poc >= minTP) {
      tpCands.push({ value: ind.poc, score: 3, tag: 'poc' });
    }
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh >= minTP) {
      tpCands.push({ value: ind.valueAreaHigh, score: 3, tag: 'vah' });
    }
    // ⑧ 技術形態邊界
    if (ind.bollUp > 0 && ind.bollUp >= minTP) tpCands.push({ value: ind.bollUp, score: 2, tag: 'boll' });
    if (ind.ma60   > 0 && ind.ma60   >= minTP) tpCands.push({ value: ind.ma60,   score: 1, tag: 'ma60' });
    // ⑨ 動態理想目標（ADX 高時追更遠目標的補充）
    if (idealTP > minTP) tpCands.push({ value: idealTP, score: 2, tag: 'dynamic' });
    // ⑩ [V4] 看跌 FVG 底邊（缺口下沿 = gap fill 入口，保守 TP；先觸及即兌現部分）
    if (ind.fvgBearBot > 0 && ind.fvgBearBot >= minTP) {
      tpCands.push({ value: ind.fvgBearBot, score: 6, tag: 'fvgBearBot' });
    }
    // ⑪ [V4] 多重斐波共振上方位（≥2 波段斐波聚合 = 極高概率目標）
    if (ind.fibConvAbove > 0 && ind.fibConvAbove >= minTP) {
      tpCands.push({ value: ind.fibConvAbove, score: 5, tag: 'fibConvAbove' });
    }
    // ⑫ [V4] VWAP-20 作為均值回歸 TP（從 VWAP 下方進場，VWAP 是第一目標）
    if (ind.vwap20 > 0 && ind.vwap20 >= minTP) {
      tpCands.push({ value: ind.vwap20, score: 4, tag: 'vwap20_tp' });
    }

    // 共振加成：0.8% 內多因子聚合（結構 + 斐波 = 極強目標）
    applyClusterBonus(tpCands, 0.008, 3);

    const bestTP = tpCands.length > 0
      ? tpCands.sort((a, b) => b.score - a.score || a.value - b.value)[0]
      : { value: price + risk * 2.0, score: 0, tag: 'fallback' };

    return {
      takeProfit: Math.max(bestTP.value, minTP),
      stopLoss,
    };
  } else {
    // ════════════════════════════════════════════════════════
    //  SHORT 止損候選集（多頭邏輯完全鏡像）
    // ════════════════════════════════════════════════════════
    const slCands: Cand[] = [];

    if (ind.bearOBHigh > 0 && ind.bearOBHigh > price) {
      slCands.push({ value: ind.bearOBHigh + atr * 0.1, score: 6, tag: 'ob' });
    }
    if (ind.swingHigh > 0 && ind.swingHigh > price) {
      slCands.push({ value: ind.swingHigh + atr * 0.3, score: 5, tag: 'struct' });
    }
    if (goldenPocketShort > 0 && goldenPocketShort > price) {
      slCands.push({ value: goldenPocketShort + atr * 0.1, score: 4, tag: 'gp618' });
    }
    slCands.push({ value: price + atr * atrMult, score: 3, tag: 'atr' });
    if (ind.valueAreaHigh > 0 && ind.valueAreaHigh > price) {
      slCands.push({ value: ind.valueAreaHigh, score: 2, tag: 'vah' });
    }
    if (ind.bollUp > 0 && ind.bollUp > price) {
      slCands.push({ value: ind.bollUp, score: 2, tag: 'boll' });
    }
    if (ind.ema21 > 0 && ind.ema21 > price * 1.01) {
      slCands.push({ value: ind.ema21, score: ind.adx > 15 ? 2 : 1, tag: 'ema21' });
    }
    // ⑧ [V4] 看跌 FVG 頂邊（FVG 完全填補 = 空頭結構失效，SL 置於其上 0.1 ATR）
    if (ind.fvgBearTop > 0 && ind.fvgBearTop > price) {
      slCands.push({ value: ind.fvgBearTop + atr * 0.1, score: 5, tag: 'fvgBearTop' });
    }
    // ⑨ [V4] BOS 阻力（被向下突破的舊支撐翻轉為阻力，精確到結構翻轉點）
    if (ind.bosResistance > 0 && ind.bosResistance > price) {
      slCands.push({ value: ind.bosResistance + atr * 0.1, score: 4, tag: 'bosResistance' });
    }
    // ⑩ [V4] VWAP-20（機構短期錨點，在其下方做空時 VWAP 是動態阻力）
    if (ind.vwap20 > 0 && ind.vwap20 > price * 1.01) {
      slCands.push({ value: ind.vwap20 + atr * 0.05, score: 3, tag: 'vwap20' });
    }

    applyClusterBonus(slCands, 0.005, 2);

    const hardCeil = price * 1.07;
    const minSL    = price + atr * 0.2;
    const validSL  = slCands.filter(c => c.value >= minSL && c.value <= hardCeil);

    const bestSL = validSL.length > 0
      ? validSL.sort((a, b) => b.score - a.score || a.value - b.value)[0]
      : { value: Math.min(price + atr * atrMult, hardCeil), score: 0, tag: 'fallback' };

    const stopLoss = Math.min(bestSL.value, hardCeil);
    const risk     = stopLoss - price;

    // ════════════════════════════════════════════════════════
    //  SHORT 止盈候選集
    // ════════════════════════════════════════════════════════
    const minTP   = price - risk * 1.5;
    const idealTP = price - risk * targetRR;
    const tpCands: Cand[] = [];

    if (ind.liqLow > 0 && ind.liqLow <= minTP) {
      tpCands.push({ value: ind.liqLow * 1.002, score: 6, tag: 'liq' });
    }
    if (ind.swingLow > 0 && ind.swingLow <= minTP) {
      tpCands.push({ value: ind.swingLow, score: 5, tag: 'struct' });
    }
    if (impulseShort > 0 && ind.swingLow > 0) {
      const fibCh1618 = ind.swingLow - 0.618 * impulseShort;
      const fibCh1272 = ind.swingLow - 0.272 * impulseShort;
      if (fibCh1618 <= minTP) tpCands.push({ value: fibCh1618, score: 5, tag: 'fibCh1618' });
      if (fibCh1272 <= minTP) tpCands.push({ value: fibCh1272, score: 3, tag: 'fibCh1272' });
    }
    if (ind.bullOBHigh > 0 && ind.bullOBHigh <= minTP) {
      tpCands.push({ value: ind.bullOBHigh, score: 4, tag: 'bullOBHigh' });
    }
    if (ind.prevSwingLow > 0 && ind.prevSwingLow <= minTP) {
      tpCands.push({ value: ind.prevSwingLow, score: 4, tag: 'struct2' });
    }
    const fibR1618 = price - risk * 1.618;
    const fibR1272 = price - risk * 1.272;
    if (fibR1618 <= minTP) tpCands.push({ value: fibR1618, score: 4, tag: 'fib_r1618' });
    if (fibR1272 <= minTP) tpCands.push({ value: fibR1272, score: 3, tag: 'fib_r1272' });
    if (ind.poc > 0 && ind.poc < price && ind.poc <= minTP) {
      tpCands.push({ value: ind.poc, score: 3, tag: 'poc' });
    }
    if (ind.valueAreaLow > 0 && ind.valueAreaLow <= minTP) {
      tpCands.push({ value: ind.valueAreaLow, score: 3, tag: 'val' });
    }
    if (ind.bollDn > 0 && ind.bollDn <= minTP) tpCands.push({ value: ind.bollDn, score: 2, tag: 'boll' });
    if (ind.ma60   > 0 && ind.ma60   <= minTP) tpCands.push({ value: ind.ma60,   score: 1, tag: 'ma60' });
    if (idealTP < minTP) tpCands.push({ value: idealTP, score: 2, tag: 'dynamic' });
    // ⑩ [V4] 看漲 FVG 頂邊（缺口上沿 = gap fill 保守 TP；做空從高點下跌最先觸及此位）
    if (ind.fvgBullTop > 0 && ind.fvgBullTop <= minTP) {
      tpCands.push({ value: ind.fvgBullTop, score: 6, tag: 'fvgBullTop' });
    }
    // ⑪ [V4] 多重斐波共振下方位（≥2 波段斐波聚合 = 極高概率空頭目標）
    if (ind.fibConvBelow > 0 && ind.fibConvBelow <= minTP) {
      tpCands.push({ value: ind.fibConvBelow, score: 5, tag: 'fibConvBelow' });
    }
    // ⑫ [V4] VWAP-20 作為均值回歸 TP（從 VWAP 上方做空，VWAP 是第一目標）
    if (ind.vwap20 > 0 && ind.vwap20 <= minTP) {
      tpCands.push({ value: ind.vwap20, score: 4, tag: 'vwap20_tp' });
    }

    applyClusterBonus(tpCands, 0.008, 3);

    const bestTP = tpCands.length > 0
      ? tpCands.sort((a, b) => b.score - a.score || b.value - a.value)[0]
      : { value: price - risk * 2.0, score: 0, tag: 'fallback' };

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
    // 買入/底部：高值 = 止盈目標；賣出/頂部：高值 = 風控點，低值 = 目標位
    const isLongAlert = type === 'buy' || type === 'bottom';
    const upperVal   = isLongAlert ? alert.takeProfit : alert.stopLoss;
    const lowerVal   = isLongAlert ? alert.stopLoss   : alert.takeProfit;
    const upperLabel = isLongAlert ? '🎯 止盈' : '⚠️ 風控';
    const lowerLabel = isLongAlert ? '🛡️ 止損' : '🎯 目標';
    const tgMsg =
      `🚸 *股票預警*\n\n` +
      `${icons[type]} *${analysis.symbol}* ${typeLabel[type]}信號\n` +
      `等級：${lvLabel[signal.level]}  |  價格：${fmt(analysis.price)}  |  評分：${signal.score}分\n` +
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
