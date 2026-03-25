/**
 * indicatorService.ts — 分析服务（v2）
 *
 * 变化：不再直接调用 detectBuySignal / predictTopBottom，
 * 改为委托给 pluginRegistry.analyze()，实现算法热插拔。
 *
 * 缓存策略不变：每个周期每个 symbol 只计算一次，
 * invalidateCache() 在数据更新前由 useStockData hook 调用。
 */

import type { StockAnalysis, SignalResult, PredictionResult, TechnicalIndicators } from '../types';
import type { StrategyResult } from '../core/types';
import { pluginRegistry } from '../core/plugin-registry';
import { stockService }   from './stockService';

// StrategyResult → StockAnalysis 的字段映射
function toStockAnalysis(r: StrategyResult): StockAnalysis {
  return {
    symbol:     r.symbol,
    price:      r.price,
    indicators: r.indicators,
    buySignal:  r.buySignal,
    sellSignal: r.sellSignal,
    prediction: r.prediction,
  };
}

class IndicatorService {
  /** 周期缓存：symbol → 当前周期分析结果 */
  private cycleCache = new Map<string, StockAnalysis>();

  /** 由 useStockData 在每次 updateUI() 前调用，清除上一周期缓存 */
  invalidateCache(): void {
    this.cycleCache.clear();
  }

  /**
   * 核心入口：每个周期每个 symbol 只计算一次，后续调用命中缓存。
   * 使用当前激活的算法插件。
   */
  analyzeStock(symbol: string): StockAnalysis | null {
    const cached = this.cycleCache.get(symbol);
    if (cached) return cached;

    const history = stockService.getStockHistory(symbol);
    if (!history || history.length < 10) return null;

    const result = pluginRegistry.analyze(history, symbol);
    if (!result) return null;

    const analysis = toStockAnalysis(result);
    this.cycleCache.set(symbol, analysis);
    return analysis;
  }

  getBuySignal(symbol: string): SignalResult {
    return this.analyzeStock(symbol)?.buySignal
      ?? { signal: false, level: null, score: 0, reasons: [] };
  }

  getSellSignal(symbol: string): SignalResult {
    return this.analyzeStock(symbol)?.sellSignal
      ?? { signal: false, level: null, score: 0, reasons: [] };
  }

  getPrediction(symbol: string): PredictionResult {
    return this.analyzeStock(symbol)?.prediction
      ?? { type: 'neutral', probability: 0, signals: [], recommendation: '数据不足，无法预测' };
  }

  getIndicators(symbol: string): TechnicalIndicators | null {
    return this.analyzeStock(symbol)?.indicators ?? null;
  }

  analyzeAllStocks(symbols: string[]): Map<string, StockAnalysis> {
    const results = new Map<string, StockAnalysis>();
    for (const sym of symbols) {
      const a = this.analyzeStock(sym);
      if (a) results.set(sym, a);
    }
    return results;
  }

  /** 获取当前激活插件的原始 StrategyResult（含 metadata 等扩展字段） */
  getRawResult(symbol: string): StrategyResult | null {
    const history = stockService.getStockHistory(symbol);
    if (!history?.length) return null;
    return pluginRegistry.analyze(history, symbol);
  }
}

export const indicatorService = new IndicatorService();
