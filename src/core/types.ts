/**
 * core/types.ts — 框架级接口定义
 *
 * 三大扩展点：
 *   IStrategyPlugin   — 算法插件（热插拔）
 *   IDataSourceAdapter — 数据源适配器（可配置）
 *   IMarketDB         — 数据库抽象层（IndexedDB/SQLite 统一接口）
 */

import type { StockData, SignalResult, PredictionResult, TechnicalIndicators, AssetType } from '../types';

// ─── 通用结果类型 ────────────────────────────────────────────────────────────

export interface StrategyResult {
  symbol:      string;
  price:       number;
  indicators:  TechnicalIndicators;
  buySignal:   SignalResult;
  sellSignal:  SignalResult;
  prediction:  PredictionResult;
  pluginId:    string;           // 哪个插件产生的结果
  computedAt:  number;           // 计算时间戳
  metadata:    Record<string, unknown>;  // 插件自定义附加数据
}

// ─── 算法插件接口 ────────────────────────────────────────────────────────────

export interface IStrategyPlugin {
  readonly id:          string;     // 全局唯一 e.g. 'smc-gen3'
  readonly name:        string;     // 显示名称
  readonly version:     string;     // semver
  readonly description: string;
  readonly author:      string;

  /**
   * 初始化（可选）。例如加载持久化 POI 状态、预热计算等。
   * 在插件被激活时由 PluginRegistry 调用一次。
   */
  init?(symbol: string): Promise<void>;

  /**
   * 核心分析方法。纯函数：给定 K 线历史，返回完整分析结果。
   * 不允许有副作用（不操作 DOM / localStorage / IndexedDB）。
   */
  analyze(data: StockData[], symbol: string): StrategyResult;

  /**
   * （可选）插件级配置 schema，用于 UI 动态渲染配置面板。
   */
  configSchema?: PluginConfigSchema[];
  getConfig?(): Record<string, unknown>;
  setConfig?(config: Record<string, unknown>): void;
}

export interface PluginConfigSchema {
  key:     string;
  label:   string;
  type:    'number' | 'boolean' | 'select' | 'string';
  default: unknown;
  options?: { label: string; value: unknown }[];  // 仅 select 类型
  min?:    number;
  max?:    number;
  step?:   number;
}

// ─── 数据源适配器接口 ────────────────────────────────────────────────────────

export interface QuoteData {
  symbol:        string;
  price:         number;
  change:        number;
  changePercent: number;
  volume:        number;
  timestamp:     number;
}

export interface IDataSourceAdapter {
  readonly id:                  string;     // e.g. 'binance', 'polygon', 'yahoo'
  readonly name:                string;
  readonly priority:            number;     // 数字越小优先级越高
  readonly supportedAssetTypes: AssetType[];

  /** 当前适配器是否可用（检查 API key、网络等） */
  isAvailable(): Promise<boolean>;

  /** 拉取历史 K 线（6个月日线） */
  fetchHistory(symbol: string): Promise<StockData[]>;

  /** 拉取最新报价（实时/延迟） */
  fetchQuote(symbol: string): Promise<QuoteData | null>;
}

// ─── 数据库抽象层 ────────────────────────────────────────────────────────────

export interface OHLCVRecord {
  symbol:    string;
  timestamp: number;
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume:    number;
  source:    string;
}

export interface IMarketDB {
  /** 批量写入 OHLCV，已存在的 (symbol, timestamp) 忽略（幂等） */
  saveOHLCV(records: OHLCVRecord[]): Promise<void>;

  /** 查询指定标的的历史，按时间升序 */
  queryOHLCV(symbol: string, fromTs?: number): Promise<OHLCVRecord[]>;

  /** 删除指定标的的历史 */
  deleteOHLCV(symbol: string): Promise<void>;

  /** 删除超过 maxAge 毫秒的旧数据（剪枝） */
  pruneOHLCV(symbol: string, maxAgeMs: number): Promise<void>;
}

// ─── 实时报价缓存条目 ────────────────────────────────────────────────────────

export interface CacheEntry<T> {
  value:     T;
  expiresAt: number;   // Date.now() + TTL
}

// ─── 插件注册表公开类型 ──────────────────────────────────────────────────────

export interface PluginRegistrySnapshot {
  active:     string;                                     // 当前激活插件 id
  plugins:    { id: string; name: string; version: string; description: string }[];
}

// ─── 数据源注册表公开类型 ────────────────────────────────────────────────────

export interface DataSourceConfig {
  /** 各资产类型手动指定优先使用的适配器 id（空 = 自动按 priority 选） */
  overrides: Partial<Record<AssetType, string>>;
  /** 全局禁用的适配器 id 列表 */
  disabled:  string[];
}

// ─── 报表类型 ─────────────────────────────────────────────────────────────────

export interface AnalysisReport {
  generatedAt:  number;
  symbol:       string;
  name:         string;
  pluginId:     string;
  pluginName:   string;
  price:        number;
  priceChange:  number;
  indicators:   TechnicalIndicators;
  buySignal:    SignalResult;
  sellSignal:   SignalResult;
  prediction:   PredictionResult;
  history:      OHLCVRecord[];         // 原始 K 线（用于导出 CSV）
  metadata:     Record<string, unknown>;
}
