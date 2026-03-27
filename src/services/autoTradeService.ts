/**
 * autoTradeService.ts — 自动交易引擎
 *
 * 核心设计原则：
 *  - 与预警(alertService)完全解耦，预警只负责通知，不负责交易
 *  - 每次价格更新都独立评估，不受预警去重限制
 *  - 每个标的独立开关，全局开关为总闸
 *  - 执行记录持久化，UI可实时查看
 */

import { StockAnalysis } from '../types';
import { tradingSimulator, TradeSignal } from './tradingSimulator';

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export type AutoTradeSignalLevel = 'high' | 'medium' | 'any';

export interface AutoTradeConfig {
  enabled:          boolean;              // 全局开关
  symbolsEnabled:   Record<string, boolean>; // 每个标的的开关，true=启用
  minLevel:         AutoTradeSignalLevel; // 最低触发等级
  usePrediction:    boolean;              // 是否响应顶底预测信号
  minPredProb:      number;               // 顶底预测最低概率（0-1）
  positionPct:      number;               // 每笔仓位占余额比例（0.05-0.5）
  cooldownMs:       number;               // 同一标的两次买入最小间隔（ms）
  exitMode:         'v6' | 'v7';          // v6=全倉持到目標, v7=1.5R分批止盈+移動止損
}

export interface AutoTradeExecution {
  id:        string;
  ts:        number;
  symbol:    string;
  action:    'buy' | 'sell';
  price:     number;
  qty:       number;
  reason:    string;
  score:     number;
  result:    'success' | 'failed' | 'skipped';
  message:   string;
}

// ─── 默认配置 ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AutoTradeConfig = {
  enabled:        false,
  symbolsEnabled: {},
  minLevel:       'medium',
  usePrediction:  true,
  minPredProb:    0.70,
  positionPct:    0.10,
  cooldownMs:     5 * 60 * 1000, // 5 分钟冷却
  exitMode:       'v6',
};

const LS_CONFIG_KEY   = 'auto_trade_config_v2';
const LS_COOLDOWN_KEY = 'auto_trade_cooldown_v1';
const MAX_EXECUTIONS  = 100;

// ─── 服务 ─────────────────────────────────────────────────────────────────────

class AutoTradeService {
  private config:     AutoTradeConfig;
  private executions: AutoTradeExecution[] = [];
  private lastBuyTs:  Map<string, number>  = new Map(); // symbol → 最后买入时间
  private onChange:   (() => void) | null  = null;
  private counter  = 0;
  private running  = false; // 防止并发执行

  constructor() {
    this.config = this.loadConfig();
    this.restoreCooldowns();
  }

  // ── 配置持久化 ────────────────────────────────────────────────────────────

  private loadConfig(): AutoTradeConfig {
    try {
      const raw = localStorage.getItem(LS_CONFIG_KEY);
      if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch (e) { console.warn('[autoTradeService] loadConfig 失敗:', e); }
    return { ...DEFAULT_CONFIG };
  }

  private saveConfig(): void {
    try {
      localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(this.config));
    } catch (e) { console.warn('[autoTradeService] saveConfig 失敗:', e); }
  }

  private restoreCooldowns(): void {
    try {
      const raw = localStorage.getItem(LS_COOLDOWN_KEY);
      if (!raw) return;
      const entries: [string, number][] = JSON.parse(raw);
      // 只恢復仍在冷却期内的条目
      const now = Date.now();
      for (const [sym, ts] of entries) {
        if (now - ts < this.config.cooldownMs) {
          this.lastBuyTs.set(sym, ts);
        }
      }
    } catch { /* 静默忘记 */ }
  }

  private saveCooldowns(): void {
    try {
      localStorage.setItem(LS_COOLDOWN_KEY, JSON.stringify(Array.from(this.lastBuyTs.entries())));
    } catch { /* 静默忘记 */ }
  }

  // ── 公开：配置修改 ────────────────────────────────────────────────────────

  setEnabled(v: boolean): void {
    this.config.enabled = v;
    this.saveConfig();
    this.notify();
  }

  setSymbolEnabled(symbol: string, v: boolean): void {
    this.config.symbolsEnabled[symbol] = v;
    this.saveConfig();
    this.notify();
  }

  setAllSymbols(symbols: string[], v: boolean): void {
    for (const s of symbols) this.config.symbolsEnabled[s] = v;
    this.saveConfig();
    this.notify();
  }

  updateConfig(patch: Partial<AutoTradeConfig>): void {
    this.config = { ...this.config, ...patch };
    this.saveConfig();
    this.notify();
  }

  getConfig(): AutoTradeConfig {
    return { ...this.config };
  }

  isSymbolEnabled(symbol: string): boolean {
    return this.config.enabled && (this.config.symbolsEnabled[symbol] ?? false);
  }

  // ── 核心：市场更新时调用 ──────────────────────────────────────────────────

  /**
   * 每次价格更新后由 App.tsx 调用
   * @param analyses 最新市场分析（所有自选股）
   */
  async onMarketUpdate(analyses: Map<string, StockAnalysis>): Promise<void> {
    if (!this.config.enabled) return;
    if (this.running) return; // 上一轮尚未完成，跳过本轮防止并发
    this.running = true;
    try {
      for (const [symbol, analysis] of analyses) {
        if (!this.config.symbolsEnabled[symbol]) continue;
        try {
          await this.evaluate(symbol, analysis);
        } catch (e) {
          // 单个标的评估失败不阻断其他标的
          console.warn(`[autoTradeService] evaluate(${symbol}) 失败:`, e);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async evaluate(symbol: string, analysis: StockAnalysis): Promise<void> {
    const { buySignal, sellSignal, prediction, price } = analysis;
    const positions = tradingSimulator.getPositions();
    const hasPosition = positions.some(p => p.symbol === symbol);
    const account = tradingSimulator.getAccount();

    // ── 卖出评估（优先于买入，有持仓才评估）──────────────────────────────

    if (hasPosition) {      // ── V7 模式：持倉達到 1.5R 經益即移動止損至成本 ────────────────
      if (this.config.exitMode === 'v7') {
        const pos = positions.find(p => p.symbol === symbol);
        if (pos && pos.stopLoss !== undefined && pos.avgPrice !== undefined) {
          const entry    = pos.avgPrice;
          const risk     = entry - pos.stopLoss;
          const target15 = entry + risk * 1.5;
          // 尚未移至成本（止損線小於入場價）且價格已超過 1.5R
          if (pos.stopLoss < entry && price >= target15) {
            tradingSimulator.updatePositionStop(symbol, entry);
            this.record({
              symbol, action: 'buy', price, qty: 0,
              reason: `V7: 成本防護 – 已達 1.5R，止損移至入場價 $${entry.toFixed(2)}`,
              score: 0, result: 'skipped', message: '止損已移至成本',
            });
          }
        }
      }
      let shouldSell = false;
      let sellReason = '';
      let sellScore  = 0;

      // 1. 卖出信号
      if (this.meetsLevel(sellSignal.level) && sellSignal.signal) {
        shouldSell = true;
        sellReason = `賣出信號 ${sellSignal.score}分 | ${sellSignal.reasons[0] ?? ''}`;
        sellScore  = sellSignal.score;
      }
      // 2. 顶部预测
      if (!shouldSell && this.config.usePrediction
          && prediction.type === 'top'
          && prediction.probability >= this.config.minPredProb) {
        shouldSell = true;
        sellReason = `頂部預測 ${(prediction.probability * 100).toFixed(0)}% | ${prediction.recommendation}`;
        sellScore  = Math.round(prediction.probability * 100);
      }

      if (shouldSell) {
        const pos = positions.find(p => p.symbol === symbol)!;
        await this.executeAndRecord(
          { symbol, type: 'sell', price, reason: sellReason, confidence: sellScore },
          pos.quantity,
          'sell',
          sellReason,
          sellScore,
        );
        return; // 卖出后本轮不再买入
      }
    }

    // ── 买入评估（无持仓才开新仓）────────────────────────────────────────

    if (!hasPosition) {
      // 冷却期检查
      const lastBuy = this.lastBuyTs.get(symbol) ?? 0;
      if (Date.now() - lastBuy < this.config.cooldownMs) return;

      let shouldBuy = false;
      let buyReason = '';
      let buyScore  = 0;

      // 1. 买入信号
      if (this.meetsLevel(buySignal.level) && buySignal.signal) {
        shouldBuy = true;
        buyReason = `買入信號 ${buySignal.score}分 | ${buySignal.reasons[0] ?? ''}`;
        buyScore  = buySignal.score;
      }
      // 2. 底部预测
      if (!shouldBuy && this.config.usePrediction
          && prediction.type === 'bottom'
          && prediction.probability >= this.config.minPredProb) {
        shouldBuy = true;
        buyReason = `底部預測 ${(prediction.probability * 100).toFixed(0)}% | ${prediction.recommendation}`;
        buyScore  = Math.round(prediction.probability * 100);
      }

      if (shouldBuy) {
        if (price <= 0) return; // 价格异常保护

        // ── V6 確認門檻：依確認強度調整倉位大小 ─────────────────────────
        const ind = analysis.indicators;
        const longConfirmed = (ind.sfpBull || ind.cvdBullDiv) && ind.chochBull;
        const longPartial   = ind.sfpBull || ind.cvdBullDiv || ind.chochBull;
        if (!longConfirmed && !longPartial) {
          this.record({
            symbol, action: 'buy', price, qty: 0, reason: buyReason, score: buyScore,
            result: 'skipped', message: 'V6：無三重確認信號，跳過',
          });
          return;
        }
        const effectivePct = longConfirmed ? this.config.positionPct : this.config.positionPct * 0.5;
        buyReason += longConfirmed ? ' | 🔒全確認' : ' | ⚡部分確認';

        // 計算倉位（全確認 = 100% positionPct，部分確認 = 50%）
        const qty = Math.floor(
          (account.balance * effectivePct) / price * 10_000
        ) / 10_000;

        if (qty > 0 && account.balance >= qty * price * 1.001) {
          const result = await this.executeAndRecord(
            { symbol, type: 'buy', price, reason: buyReason, confidence: buyScore },
            qty,
            'buy',
            buyReason,
            buyScore,
          );
          if (result === 'success') {
            this.lastBuyTs.set(symbol, Date.now());
            this.saveCooldowns();
          }
        } else {
          this.record({
            symbol, action: 'buy', price, qty: 0, reason: buyReason, score: buyScore,
            result: 'skipped', message: '餘額不足，跳過',
          });
        }
      }
    }
  }

  private meetsLevel(level: 'high' | 'medium' | 'low' | null): boolean {
    if (!level) return false;
    const order = { high: 3, medium: 2, low: 1 };
    const minOrder = { high: 3, medium: 2, any: 1 };
    return order[level] >= minOrder[this.config.minLevel];
  }

  private async executeAndRecord(
    signal: TradeSignal,
    qty: number,
    action: 'buy' | 'sell',
    reason: string,
    score: number,
  ): Promise<'success' | 'failed'> {
    const result = await tradingSimulator.executeTrade(signal, qty);
    const status = result.success ? 'success' : 'failed';
    this.record({
      symbol: signal.symbol, action, price: signal.price, qty,
      reason, score, result: status, message: result.message,
    });
    this.notify();
    return status;
  }

  private record(data: Omit<AutoTradeExecution, 'id' | 'ts'>): void {
    this.executions.unshift({
      id:  `at_${Date.now()}_${++this.counter}`,
      ts:  Date.now(),
      ...data,
    });
    if (this.executions.length > MAX_EXECUTIONS) {
      this.executions.length = MAX_EXECUTIONS;
    }
  }

  // ── 读取 ─────────────────────────────────────────────────────────────────

  getExecutions(): AutoTradeExecution[] {
    return [...this.executions];
  }

  clearExecutions(): void {
    this.executions = [];
    this.lastBuyTs.clear(); // 同时重置冷却计时器
    this.saveCooldowns();   // 同步清空持久化
    this.notify();
  }

  setOnChange(cb: () => void): void { this.onChange = cb; }
  private notify(): void { this.onChange?.(); }
}

export const autoTradeService = new AutoTradeService();
