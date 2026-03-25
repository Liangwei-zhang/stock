/**
 * plugins/composite-ensemble.ts — 多策略融合插件
 *
 * 策略邏輯：
 *   迭代所有已註冊插件（排除自身），收集各插件的買賣信號，
 *   根據達成共識的插件數量進行加權投票，產生高置信度信號。
 */

import type { IStrategyPlugin, StrategyResult } from '../core/types';
import type { StockData, TechnicalIndicators } from '../types';
import { pluginRegistry } from '../core/plugin-registry';
import { calculateAllIndicators } from '../utils/indicators';

export class CompositeEnsemblePlugin implements IStrategyPlugin {
  readonly id          = 'composite-ensemble';
  readonly name        = '多策略融合';
  readonly version     = '1.0.0';
  readonly description = '綜合所有已註冊策略的信號，加權投票產生高置信度信號';
  readonly author      = 'system';

  analyze(data: StockData[], symbol: string): StrategyResult {
    if (data.length < 30) {
      return this.empty(symbol, data[data.length - 1]?.price ?? 0);
    }

    const cur   = data[data.length - 1];
    const price = cur.price;
    const ind   = calculateAllIndicators(data, symbol);

    // 取得所有其他已註冊插件
    const otherPlugins = pluginRegistry.list().filter(p => p.id !== this.id);

    // 收集各插件分析結果
    const results: StrategyResult[] = [];
    for (const plugin of otherPlugins) {
      try {
        results.push(plugin.analyze(data, symbol));
      } catch { /* 忽略單一插件錯誤 */ }
    }

    if (results.length === 0) {
      return this.empty(symbol, price);
    }

    // ── 買入信號融合 ─────────────────────────────────────────────────────────
    const buyVotes = results.filter(r => r.buySignal.signal);
    const buyCount = buyVotes.length;
    const buyConfidence = buyCount >= 3 ? 1.0 : buyCount === 2 ? 0.8 : buyCount === 1 ? 0.6 : 0;
    const buyAvgScore = buyCount > 0
      ? buyVotes.reduce((s, r) => s + r.buySignal.score, 0) / buyCount
      : 0;
    const weightedBuyScore = Math.round(buyAvgScore * buyConfidence);

    const buyReasons: string[] = [];
    for (const r of buyVotes) {
      const plugin = otherPlugins.find(p => p.id === r.pluginId);
      const pluginName = plugin?.name ?? r.pluginId;
      const topReasons = r.buySignal.reasons.slice(0, 2);
      for (const reason of topReasons) {
        buyReasons.push(`[${pluginName}] ${reason}`);
      }
    }

    // ── 賣出信號融合 ─────────────────────────────────────────────────────────
    const sellVotes = results.filter(r => r.sellSignal.signal);
    const sellCount = sellVotes.length;
    const sellConfidence = sellCount >= 3 ? 1.0 : sellCount === 2 ? 0.8 : sellCount === 1 ? 0.6 : 0;
    const sellAvgScore = sellCount > 0
      ? sellVotes.reduce((s, r) => s + r.sellSignal.score, 0) / sellCount
      : 0;
    const weightedSellScore = Math.round(sellAvgScore * sellConfidence);

    const sellReasons: string[] = [];
    for (const r of sellVotes) {
      const plugin = otherPlugins.find(p => p.id === r.pluginId);
      const pluginName = plugin?.name ?? r.pluginId;
      const topReasons = r.sellSignal.reasons.slice(0, 2);
      for (const reason of topReasons) {
        sellReasons.push(`[${pluginName}] ${reason}`);
      }
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

    // ── 預測融合（多數決） ────────────────────────────────────────────────────
    const predTypes = results.map(r => r.prediction.type);
    const topCount    = predTypes.filter(t => t === 'top').length;
    const bottomCount = predTypes.filter(t => t === 'bottom').length;
    const total       = results.length;

    let predType: 'top' | 'bottom' | 'neutral' = 'neutral';
    if (topCount > total / 2)    predType = 'top';
    else if (bottomCount > total / 2) predType = 'bottom';

    const activePreds = results.filter(r => r.prediction.type === predType && predType !== 'neutral');
    const avgProb = activePreds.length > 0
      ? activePreds.reduce((s, r) => s + r.prediction.probability, 0) / activePreds.length
      : 0;
    const agreementRatio = activePreds.length / total;
    const probability = Math.min(avgProb * agreementRatio * 1.2, 1);

    const predSignals: string[] = [];
    if (predType !== 'neutral') {
      predSignals.push(`${activePreds.length}/${total} 策略達成共識`);
    }

    return {
      symbol,
      price,
      indicators:  ind,
      buySignal:   mkSignal(weightedBuyScore,  buyReasons),
      sellSignal:  mkSignal(weightedSellScore, sellReasons),
      prediction: {
        type:           predType,
        probability,
        signals:        predSignals,
        recommendation: predType === 'bottom'
          ? `多策略融合：${bottomCount}/${total} 策略看漲，高置信度底部信號`
          : predType === 'top'
          ? `多策略融合：${topCount}/${total} 策略看跌，高置信度頂部信號`
          : '多策略融合：策略方向分歧，暫觀望',
      },
      pluginId:   this.id,
      computedAt: Date.now(),
      metadata:   {
        pluginCount: otherPlugins.length,
        buyCount,
        sellCount,
        buyConfidence,
        sellConfidence,
      },
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
