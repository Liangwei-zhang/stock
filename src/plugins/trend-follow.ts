/**
 * plugins/trend-follow.ts — 趋势跟踪策略插件（示例）
 *
 * 演示如何接入新算法：只需实现 IStrategyPlugin 接口，
 * 在 plugins/index.ts 注册后即可在 UI 中选择，无需改动其他代码。
 *
 * 策略逻辑（简化版）：
 *   买入：EMA9 > EMA21 > EMA50 三线多头 + ADX > 20 + 收盘 > 前 20 日最高价
 *   卖出：EMA9 < EMA21 三线死叉 + 收盘 < 前 20 日最低价
 *   无顶底预测（此策略专注趋势延续）
 */

import type { IStrategyPlugin, StrategyResult, PluginConfigSchema } from '../core/types';
import type { StockData, TechnicalIndicators } from '../types';
import { calculateAllIndicators } from '../utils/indicators';

interface TFConfig {
  emaFast:     number;   // 默认 9
  emaSlow:     number;   // 默认 21
  adxMin:      number;   // 默认 20
  breakoutLen: number;   // 默认 20（看前 N 根高低价）
}

const DEFAULTS: TFConfig = { emaFast: 9, emaSlow: 21, adxMin: 20, breakoutLen: 20 };

export class TrendFollowPlugin implements IStrategyPlugin {
  readonly id          = 'trend-follow';
  readonly name        = '趋势跟踪';
  readonly version     = '1.0.0';
  readonly description = 'EMA多头排列 + ADX过滤 + N日突破确认';
  readonly author      = 'Custom';

  private config: TFConfig = { ...DEFAULTS };

  readonly configSchema: PluginConfigSchema[] = [
    { key: 'emaFast',     label: '快线 EMA',    type: 'number', default: 9,  min: 5,  max: 20, step: 1 },
    { key: 'emaSlow',     label: '慢线 EMA',    type: 'number', default: 21, min: 10, max: 50, step: 1 },
    { key: 'adxMin',      label: 'ADX 最低阈值',type: 'number', default: 20, min: 10, max: 40, step: 5 },
    { key: 'breakoutLen', label: '突破回看周期', type: 'number', default: 20, min: 10, max: 50, step: 5 },
  ];

  getConfig() { return { ...this.config }; }
  setConfig(cfg: Record<string, unknown>) { this.config = { ...this.config, ...cfg } as TFConfig; }

  analyze(data: StockData[], symbol: string): StrategyResult {
    const { emaFast, emaSlow, adxMin, breakoutLen } = this.config;

    if (data.length < Math.max(emaSlow, breakoutLen) + 5) {
      return this.empty(symbol, data[data.length - 1]?.price ?? 0);
    }

    const ind   = calculateAllIndicators(data);
    const cur   = data[data.length - 1];
    const price = cur.price;

    // N 日突破
    const window = data.slice(-breakoutLen - 1, -1);
    const highN  = Math.max(...window.map(d => d.high));
    const lowN   = Math.min(...window.map(d => d.low));

    // 买入条件
    const bullAlign  = ind.ema9 > ind.ema21;
    const breakoutUp = price > highN;
    const trendOk    = ind.adx >= adxMin;
    const volOk      = cur.volume > 0;   // 有成交量

    let buyScore  = 0;
    const buyReasons: string[] = [];

    if (bullAlign)  { buyScore += 35; buyReasons.push(`EMA${emaFast}/EMA${emaSlow} 多头排列`); }
    if (breakoutUp) { buyScore += 40; buyReasons.push(`突破近 ${breakoutLen} 日高点 $${highN.toFixed(2)}`); }
    if (trendOk)    { buyScore += 25; buyReasons.push(`ADX ${ind.adx.toFixed(0)} 趋势强劲`); }

    // 卖出条件
    const bearAlign    = ind.ema9 < ind.ema21;
    const breakoutDown = price < lowN;

    let sellScore  = 0;
    const sellReasons: string[] = [];

    if (bearAlign)    { sellScore += 40; sellReasons.push(`EMA${emaFast}/EMA${emaSlow} 死叉`); }
    if (breakoutDown) { sellScore += 45; sellReasons.push(`跌破近 ${breakoutLen} 日低点 $${lowN.toFixed(2)}`); }
    if (trendOk && bearAlign) { sellScore += 15; sellReasons.push(`趋势确认（ADX ${ind.adx.toFixed(0)}）`); }

    const mkSignal = (score: number, reasons: string[]) => {
      const signal = score >= 60 && reasons.length >= 2;
      const level  = score >= 80 ? 'high' as const : score >= 60 ? 'medium' as const : null;
      return { signal, level, score, reasons };
    };

    return {
      symbol,
      price,
      indicators: ind,
      buySignal:  mkSignal(buyScore,  buyReasons),
      sellSignal: mkSignal(sellScore, sellReasons),
      prediction: {
        type:           'neutral',
        probability:    0,
        signals:        [],
        recommendation: '趋势跟踪策略不做顶底预测，专注趋势延续方向。',
      },
      pluginId:   this.id,
      computedAt: Date.now(),
      metadata:   { emaFast, emaSlow, highN, lowN, adxMin },
    };
  }

  private empty(symbol: string, price: number): StrategyResult {
    return {
      symbol, price,
      indicators:  {} as TechnicalIndicators,
      buySignal:   { signal: false, level: null, score: 0, reasons: [] },
      sellSignal:  { signal: false, level: null, score: 0, reasons: [] },
      prediction:  { type: 'neutral', probability: 0, signals: [], recommendation: '数据不足' },
      pluginId:    this.id,
      computedAt:  Date.now(),
      metadata:    {},
    };
  }
}
