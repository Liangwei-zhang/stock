/**
 * plugins/smc-gen3.ts — SMC Gen 3.1 策略插件
 *
 * 将现有 signals.ts / prediction.ts / indicators.ts 封装为标准插件接口。
 * 这是默认激活的插件，行为与重构前完全一致。
 *
 * 插件可配置参数：
 *   minDataLen        最少历史数据根数（默认 60）
 *   buyScoreHigh      买入高级阈值（默认 75）
 *   buyScoreMed       买入中级阈值（默认 55）
 *   sellScoreHigh     卖出高级阈值（默认 75）
 *   sellScoreMed      卖出中级阈值（默认 55）
 *   predProbThreshold 预测概率阈值（默认 0.65）
 */

import type { IStrategyPlugin, StrategyResult, PluginConfigSchema } from '../core/types';
import type { StockData } from '../types';
import { calculateAllIndicators }            from '../utils/indicators';
import { detectBuySignal, detectSellSignal } from '../utils/signals';
import { predictTopBottom, setPredictionSymbol, initPredictionSystem } from '../utils/prediction';

interface SMCConfig {
  minDataLen:        number;
  buyScoreHigh:      number;
  buyScoreMed:       number;
  sellScoreHigh:     number;
  sellScoreMed:      number;
  predProbThreshold: number;
}

const DEFAULTS: SMCConfig = {
  minDataLen:        60,
  buyScoreHigh:      75,
  buyScoreMed:       55,
  sellScoreHigh:     75,
  sellScoreMed:      55,
  predProbThreshold: 0.65,
};

export class SMCGen3Plugin implements IStrategyPlugin {
  readonly id          = 'smc-gen3';
  readonly name        = 'SMC Gen 3.1';
  readonly version     = '3.1.0';
  readonly description = 'Smart Money Concepts：SFP + CHoCH + CVD + POI + FVG + 清算检测';
  readonly author      = 'Internal';

  private config: SMCConfig = { ...DEFAULTS };

  // ── 插件配置 schema（用于 UI 动态渲染） ────────────────────────────────────

  readonly configSchema: PluginConfigSchema[] = [
    { key: 'buyScoreHigh',      label: '买入高级阈值', type: 'number', default: 75, min: 50, max: 100, step: 5 },
    { key: 'buyScoreMed',       label: '买入中级阈值', type: 'number', default: 55, min: 30, max: 80,  step: 5 },
    { key: 'sellScoreHigh',     label: '卖出高级阈值', type: 'number', default: 75, min: 50, max: 100, step: 5 },
    { key: 'sellScoreMed',      label: '卖出中级阈值', type: 'number', default: 55, min: 30, max: 80,  step: 5 },
    { key: 'predProbThreshold', label: '预测概率阈值', type: 'number', default: 0.65, min: 0.5, max: 0.95, step: 0.05 },
    { key: 'minDataLen',        label: '最少数据根数', type: 'number', default: 60, min: 30, max: 200, step: 10 },
  ];

  getConfig(): Record<string, unknown> {
    return { ...this.config };
  }

  setConfig(cfg: Record<string, unknown>): void {
    this.config = { ...this.config, ...cfg } as SMCConfig;
  }

  // ── 初始化（加载 POI 持久化状态） ──────────────────────────────────────────

  async init(symbol: string): Promise<void> {
    await initPredictionSystem(symbol);
  }

  // ── 核心分析 ────────────────────────────────────────────────────────────────

  analyze(data: StockData[], symbol: string): StrategyResult {
    const { minDataLen } = this.config;

    if (!data.length || data.length < minDataLen) {
      const empty = this.emptyResult(symbol, data[data.length - 1]?.close ?? 0);
      return empty;
    }

    const indicators = calculateAllIndicators(data);

    // 买卖信号（使用当前配置的阈值）
    const rawBuy  = detectBuySignal(data);
    const rawSell = detectSellSignal(data);

    const buySignal  = this.applyThresholds(rawBuy,  this.config.buyScoreHigh,  this.config.buyScoreMed);
    const sellSignal = this.applyThresholds(rawSell, this.config.sellScoreHigh, this.config.sellScoreMed);

    // 顶底预测
    setPredictionSymbol(symbol);
    const prediction = predictTopBottom(data);

    return {
      symbol,
      price:      data[data.length - 1].price,
      indicators,
      buySignal,
      sellSignal,
      prediction,
      pluginId:   this.id,
      computedAt: Date.now(),
      metadata: {
        dataLen:   data.length,
        smcConfig: { ...this.config },
      },
    };
  }

  // ─── 用配置阈值重新判断等级 ─────────────────────────────────────────────────
  private applyThresholds(
    raw: { signal: boolean; level: 'high' | 'medium' | 'low' | null; score: number; reasons: string[] },
    highThreshold: number,
    medThreshold:  number,
  ): typeof raw {
    const { score, reasons } = raw;
    let level: 'high' | 'medium' | 'low' | null = null;
    let signal = false;

    if (score >= highThreshold && reasons.length >= 4) { level = 'high';   signal = true; }
    else if (score >= medThreshold  && reasons.length >= 3) { level = 'medium'; signal = true; }
    else if (score >= 35            && reasons.length >= 2) { level = 'low';    signal = true; }

    return { signal, level, score, reasons };
  }

  private emptyResult(symbol: string, price: number): StrategyResult {
    const emptyInd = {} as any;
    return {
      symbol,
      price,
      indicators:  emptyInd,
      buySignal:   { signal: false, level: null, score: 0, reasons: [] },
      sellSignal:  { signal: false, level: null, score: 0, reasons: [] },
      prediction:  { type: 'neutral', probability: 0, signals: [], recommendation: '数据不足' },
      pluginId:    this.id,
      computedAt:  Date.now(),
      metadata:    {},
    };
  }
}
