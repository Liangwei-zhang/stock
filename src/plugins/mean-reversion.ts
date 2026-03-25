/**
 * plugins/mean-reversion.ts — 均值回歸策略插件
 *
 * 策略邏輯：
 *   買入：RSI 超賣 + 價格觸及布林帶下軌 + RSI 看漲背離 + 布林帶擠壓釋放
 *   賣出：RSI 超買 + 價格觸及布林帶上軌 + RSI 看跌背離 + 布林帶擠壓釋放
 *   預測：RSI 極端 + 背離 → 頂/底判斷
 */

import type { IStrategyPlugin, StrategyResult } from '../core/types';
import type { StockData, TechnicalIndicators } from '../types';
import { calculateAllIndicators, getPreviousIndicators } from '../utils/indicators';

export class MeanReversionPlugin implements IStrategyPlugin {
  readonly id          = 'mean-reversion';
  readonly name        = '均值回歸策略';
  readonly version     = '1.0.0';
  readonly description = '基於 RSI 超買超賣 + 布林帶反轉 + 背離確認的均值回歸策略';
  readonly author      = 'system';

  analyze(data: StockData[], symbol: string): StrategyResult {
    if (data.length < 30) {
      return this.empty(symbol, data[data.length - 1]?.price ?? 0);
    }

    const ind  = calculateAllIndicators(data);
    const prev = getPreviousIndicators(data, 1);
    const cur  = data[data.length - 1];
    const price = cur.price;

    // ── 買入評分 ─────────────────────────────────────────────────────────────
    let buyScore = 0;
    const buyReasons: string[] = [];

    if (ind.rsi14 < 30) {
      buyScore += 25;
      buyReasons.push('RSI 超賣 (< 30)');
    }
    if (ind.bollDn > 0 && price <= ind.bollDn) {
      buyScore += 20;
      buyReasons.push('價格觸及布林帶下軌');
    }
    if (ind.rsiBullDiv) {
      buyScore += 20;
      buyReasons.push('RSI 看漲背離');
    }
    if (prev.bollSqueezing && (!ind.bollSqueezing || ind.bollWidth > prev.bollWidth)) {
      buyScore += 15;
      buyReasons.push('布林帶擠壓釋放');
    }
    if (ind.rsi14 >= 30 && ind.rsi14 < 40) {
      buyScore += 10;
      buyReasons.push('RSI 接近超賣區');
    }
    if (ind.ma60 > 0 && price < ind.ma60) {
      buyScore += 10;
      buyReasons.push('價格低於 MA60 均線');
    }

    // ── 賣出評分 ─────────────────────────────────────────────────────────────
    let sellScore = 0;
    const sellReasons: string[] = [];

    if (ind.rsi14 > 70) {
      sellScore += 25;
      sellReasons.push('RSI 超買 (> 70)');
    }
    if (ind.bollUp > 0 && price >= ind.bollUp) {
      sellScore += 20;
      sellReasons.push('價格觸及布林帶上軌');
    }
    if (ind.rsiBearDiv) {
      sellScore += 20;
      sellReasons.push('RSI 看跌背離');
    }
    if (prev.bollSqueezing && (!ind.bollSqueezing || ind.bollWidth > prev.bollWidth)) {
      sellScore += 15;
      sellReasons.push('布林帶擠壓釋放');
    }
    if (ind.rsi14 > 60 && ind.rsi14 <= 70) {
      sellScore += 10;
      sellReasons.push('RSI 接近超買區');
    }
    if (ind.ma60 > 0 && price > ind.ma60) {
      sellScore += 10;
      sellReasons.push('價格高於 MA60 均線');
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
    let predType: 'top' | 'bottom' | 'neutral' = 'neutral';
    let probability = 0;
    const predSignals: string[] = [];

    if (ind.rsi14 < 35 && ind.rsiBullDiv) {
      predType = 'bottom';
      probability = 0.65 + Math.max(0, (35 - ind.rsi14) / 35) * 0.2;
      predSignals.push('RSI 極度超賣 + 看漲背離');
    } else if (ind.rsi14 > 65 && ind.rsiBearDiv) {
      predType = 'top';
      probability = 0.65 + Math.max(0, (ind.rsi14 - 65) / 35) * 0.2;
      predSignals.push('RSI 極度超買 + 看跌背離');
    }

    return {
      symbol,
      price,
      indicators:  ind,
      buySignal:   mkSignal(buyScore,  buyReasons),
      sellSignal:  mkSignal(sellScore, sellReasons),
      prediction: {
        type:           predType,
        probability:    Math.min(probability, 1),
        signals:        predSignals,
        recommendation: predType === 'bottom'
          ? '均值回歸：RSI 超賣 + 背離，考慮逢低布局'
          : predType === 'top'
          ? '均值回歸：RSI 超買 + 背離，考慮逢高減倉'
          : '均值回歸：暫無明確頂底信號',
      },
      pluginId:   this.id,
      computedAt: Date.now(),
      metadata:   { rsi14: ind.rsi14, bollDn: ind.bollDn, bollUp: ind.bollUp, bollSqueezing: ind.bollSqueezing },
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
