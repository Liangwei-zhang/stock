/**
 * plugins/macd-crossover.ts — MACD 交叉策略插件
 *
 * 策略邏輯：
 *   買入：MACD 柱狀圖轉正 + 金叉 + EMA9 > EMA21 + RSI 動量確認
 *   賣出：MACD 柱狀圖轉負 + 死叉 + EMA9 < EMA21 + RSI 偏弱
 *   預測：金叉/死叉位於零軸位置 → 頂/底判斷
 */

import type { IStrategyPlugin, StrategyResult } from '../core/types';
import type { StockData, TechnicalIndicators } from '../types';
import { calculateAllIndicators, getPreviousIndicators } from '../utils/indicators';

export class MacdCrossoverPlugin implements IStrategyPlugin {
  readonly id          = 'macd-crossover';
  readonly name        = 'MACD 交叉策略';
  readonly version     = '1.0.0';
  readonly description = '基於 MACD 金叉/死叉 + 柱狀圖翻轉 + EMA 趨勢過濾的動量策略';
  readonly author      = 'system';

  analyze(data: StockData[], symbol: string): StrategyResult {
    if (data.length < 30) {
      return this.empty(symbol, data[data.length - 1]?.price ?? 0);
    }

    const ind  = calculateAllIndicators(data, symbol);
    const prev = getPreviousIndicators(data, 1, symbol);
    const cur  = data[data.length - 1];
    const price = cur.price;

    // MACD 欄位對應：macdDif = MACD 線, macdDea = 訊號線, macdHistogram = 柱狀圖
    const histNow  = ind.macdHistogram;
    const histPrev = prev.macdHistogram;
    const macdNow  = ind.macdDif;
    const macdPrev = prev.macdDif;
    const sigNow   = ind.macdDea;
    const sigPrev  = prev.macdDea;

    // 柱狀圖翻轉
    const histFlipPos = histNow > 0 && histPrev <= 0;
    const histFlipNeg = histNow < 0 && histPrev >= 0;

    // 金叉：MACD 線從下穿上訊號線
    const goldenCross = macdNow > sigNow && macdPrev <= sigPrev;
    // 死叉：MACD 線從上穿下訊號線
    const deathCross  = macdNow < sigNow && macdPrev >= sigPrev;

    // ── 買入評分 ─────────────────────────────────────────────────────────────
    let buyScore = 0;
    const buyReasons: string[] = [];

    if (histFlipPos) {
      buyScore += 25;
      buyReasons.push('MACD 柱狀圖轉正');
    }
    if (goldenCross) {
      buyScore += 20;
      buyReasons.push('MACD 金叉');
    }
    if (ind.ema9 > ind.ema21) {
      buyScore += 15;
      buyReasons.push('短期均線多頭排列');
    }
    if (macdNow > 0) {
      buyScore += 10;
      buyReasons.push('MACD 位於零軸上方');
    }
    if (ind.rsi14 > 50) {
      buyScore += 10;
      buyReasons.push('RSI 動量確認 (> 50)');
    }
    if (ind.adx > 20) {
      buyScore += 10;
      buyReasons.push('ADX 趨勢存在');
    }

    // ── 賣出評分 ─────────────────────────────────────────────────────────────
    let sellScore = 0;
    const sellReasons: string[] = [];

    if (histFlipNeg) {
      sellScore += 25;
      sellReasons.push('MACD 柱狀圖轉負');
    }
    if (deathCross) {
      sellScore += 20;
      sellReasons.push('MACD 死叉');
    }
    if (ind.ema9 < ind.ema21) {
      sellScore += 15;
      sellReasons.push('短期均線空頭排列');
    }
    if (macdNow < 0) {
      sellScore += 10;
      sellReasons.push('MACD 位於零軸下方');
    }
    if (ind.rsi14 < 50) {
      sellScore += 10;
      sellReasons.push('RSI 動量偏弱 (< 50)');
    }
    if (ind.adx > 20) {
      sellScore += 10;
      sellReasons.push('ADX 趨勢存在');
    }

    const mkSignal = (score: number, reasons: string[]) => ({
      signal: score >= 35,
      level:  score >= 75 ? 'high' as const
            : score >= 55 ? 'medium' as const
            : score >= 35 ? 'low' as const
            : null,
      score,
      reasons,
    });

    // ── 預測 ─────────────────────────────────────────────────────────────────
    // 金叉在零軸下方 + 柱狀圖放大 → 底部反轉
    // 死叉在零軸上方 + 柱狀圖縮小 → 頂部反轉
    const histExpanding  = Math.abs(histNow) > Math.abs(histPrev);

    let predType: 'top' | 'bottom' | 'neutral' = 'neutral';
    let probability = 0;
    const predSignals: string[] = [];

    if (goldenCross && macdNow < 0 && histExpanding) {
      predType = 'bottom';
      probability = 0.65;
      predSignals.push('MACD 金叉於零軸下方 + 柱狀圖放大');
    } else if (deathCross && macdNow > 0 && !histExpanding) {
      predType = 'top';
      probability = 0.65;
      predSignals.push('MACD 死叉於零軸上方 + 柱狀圖收縮');
    }

    return {
      symbol,
      price,
      indicators:  ind,
      buySignal:   mkSignal(buyScore,  buyReasons),
      sellSignal:  mkSignal(sellScore, sellReasons),
      prediction: {
        type:           predType,
        probability,
        signals:        predSignals,
        recommendation: predType === 'bottom'
          ? 'MACD：零軸下方金叉，底部動能啟動'
          : predType === 'top'
          ? 'MACD：零軸上方死叉，頂部動能衰竭'
          : 'MACD：暫無明確頂底信號',
      },
      pluginId:   this.id,
      computedAt: Date.now(),
      metadata:   { macdDif: macdNow, macdDea: sigNow, macdHistogram: histNow, histFlipPos, histFlipNeg, goldenCross, deathCross },
    };
  }

  private empty(symbol: string, price: number): StrategyResult {
    return {
      symbol, price,
      indicators:  {} as TechnicalIndicators,
      buySignal:   { signal: false, level: null, score: 0, reasons: [] },
      sellSignal:  { signal: false, level: null, score: 0, reasons: [] },
      prediction:  { type: 'neutral', probability: 0, signals: [], recommendation: '數據不足' },
      pluginId:    this.id,
      computedAt:  Date.now(),
      metadata:    {},
    };
  }
}
