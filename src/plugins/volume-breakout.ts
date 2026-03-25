/**
 * plugins/volume-breakout.ts — 量能突破策略插件
 *
 * 策略邏輯：
 *   買入：成交量異常放大 + 價格突破 POC + ADX 趨勢確認 + 突破前高
 *   賣出：放量下跌 + 跌破 POC + 跌破前低
 *   預測：大量 + 趨勢 → 頂/底判斷
 */

import type { IStrategyPlugin, StrategyResult } from '../core/types';
import type { StockData, TechnicalIndicators } from '../types';
import { calculateAllIndicators, getAverageVolume } from '../utils/indicators';

export class VolumeBreakoutPlugin implements IStrategyPlugin {
  readonly id          = 'volume-breakout';
  readonly name        = '量能突破策略';
  readonly version     = '1.0.0';
  readonly description = '基於成交量異常放大 + 價格突破關鍵位 + ADX 趨勢確認的突破策略';
  readonly author      = 'system';

  analyze(data: StockData[], symbol: string): StrategyResult {
    if (data.length < 30) {
      return this.empty(symbol, data[data.length - 1]?.price ?? 0);
    }

    const ind       = calculateAllIndicators(data);
    const cur       = data[data.length - 1];
    const prev      = data[data.length - 2];
    const price     = cur.price;
    const volumeMA  = getAverageVolume(data, 20);

    // 簡易 OBV 計算（近 2 根）
    const obvUp   = cur.close >= prev.close;
    const obvDown = cur.close <  prev.close;

    // 前高/前低（排除最後一根）
    const priceWindow = data.slice(-21, -1);
    const prevHigh = Math.max(...priceWindow.map(d => d.high));
    const prevLow  = Math.min(...priceWindow.map(d => d.low));

    // ── 買入評分 ─────────────────────────────────────────────────────────────
    let buyScore = 0;
    const buyReasons: string[] = [];

    if (volumeMA > 0 && cur.volume > volumeMA * 2) {
      buyScore += 25;
      buyReasons.push('成交量異常放大 (> 2x 均量)');
    }
    if (ind.poc > 0 && cur.close > ind.poc) {
      buyScore += 20;
      buyReasons.push('價格突破量能密集區');
    }
    if (ind.adx > 25) {
      buyScore += 15;
      buyReasons.push('ADX 確認趨勢 (> 25)');
    }
    if (ind.ema21 > 0 && price > ind.ema21) {
      buyScore += 10;
      buyReasons.push('價格站上 EMA21');
    }
    if (obvUp) {
      buyScore += 10;
      buyReasons.push('OBV 持續上升');
    }
    if (cur.close > prevHigh) {
      buyScore += 15;
      buyReasons.push('突破前高');
    }

    // ── 賣出評分 ─────────────────────────────────────────────────────────────
    let sellScore = 0;
    const sellReasons: string[] = [];

    if (volumeMA > 0 && cur.volume > volumeMA * 2 && cur.close < cur.open) {
      sellScore += 25;
      sellReasons.push('放量下跌 (> 2x 均量)');
    }
    if (ind.poc > 0 && cur.close < ind.poc) {
      sellScore += 20;
      sellReasons.push('價格跌破量能密集區');
    }
    if (ind.adx > 25) {
      sellScore += 15;
      sellReasons.push('ADX 確認趨勢 (> 25)');
    }
    if (ind.ema21 > 0 && price < ind.ema21) {
      sellScore += 10;
      sellReasons.push('價格跌破 EMA21');
    }
    if (obvDown) {
      sellScore += 10;
      sellReasons.push('OBV 持續下降');
    }
    if (cur.close < prevLow) {
      sellScore += 15;
      sellReasons.push('跌破前低');
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
    const largeVolume = volumeMA > 0 && cur.volume > volumeMA * 2;
    const bullishClose = cur.close > cur.open;
    const bearishClose = cur.close < cur.open;
    const adxRising = ind.adx > 20;

    let predType: 'top' | 'bottom' | 'neutral' = 'neutral';
    let probability = 0;
    const predSignals: string[] = [];

    if (largeVolume && bullishClose && adxRising) {
      predType = 'bottom';
      probability = 0.6;
      predSignals.push('大量陽線 + ADX 趨勢確認');
    } else if (largeVolume && bearishClose && adxRising) {
      predType = 'top';
      probability = 0.6;
      predSignals.push('大量陰線 + ADX 趨勢確認');
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
          ? '量能突破：放量突破，趨勢啟動信號'
          : predType === 'top'
          ? '量能突破：放量下跌，趨勢反轉信號'
          : '量能突破：暫無明確方向信號',
      },
      pluginId:   this.id,
      computedAt: Date.now(),
      metadata:   { volumeMA, poc: ind.poc, adx: ind.adx, prevHigh, prevLow },
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
