export interface StockData {
  symbol: string;
  name: string;
  price: number;
  close: number;
  change: number;
  changePercent: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  timestamp: number;
}

export interface TechnicalIndicators {
  // ── 原有均线（保留兼容性）──
  ma5: number;
  ma10: number;
  ma20: number;
  ma60: number;

  // ── EMA 快慢线（替代 SMA 作为主要趋势工具）──
  ema9: number;
  ema21: number;

  // ── MACD (12/26/9) ──
  macdDif: number;
  macdDea: number;
  macdHistogram: number;

  // ── KDJ ──
  kdjK: number;
  kdjD: number;
  kdjJ: number;

  // ── RSI 多周期 ──
  rsi9: number;   // 短周期，捕捉日内转折
  rsi14: number;  // 标准周期，主要决策依据
  rsi6: number;   // 极短，用于超买超卖过滤
  rsi12: number;
  rsi24: number;

  // ── RSI 背离信号（先行指标）──
  rsiBullDiv: boolean;   // 底背离：价格新低但 RSI 未新低 → 看涨
  rsiBearDiv: boolean;   // 顶背离：价格新高但 RSI 未新高 → 看跌

  // ── 布林带 ──
  bollUp: number;
  bollMb: number;
  bollDn: number;
  bollWidth: number;       // (upper-lower)/middle，衡量波动率
  bollSqueezing: boolean;  // 带宽处于近期低点 → 即将爆发

  // ── 成交量分布 (Volume Profile) ──
  poc: number;           // Point of Control：近期成交量最集中的价格
  valueAreaHigh: number; // VAH：70% 成交量的上边界
  valueAreaLow: number;  // VAL：70% 成交量的下边界

  // ── ADX 趋势强度 ──
  adx: number;           // >25 强趋势，<20 弱趋势/盘整
  diPlus: number;
  diMinus: number;

  // ── 止盈止損核心字段（供 calcTPSL 專用）──
  atr14: number;         // 14 期威爾德 ATR：真實波動度，止損緩衝基準
  swingHigh: number;     // 最近一個確認波段頂（3 根高點）
  swingLow: number;      // 最近一個確認波段底（3 根低點）
  prevSwingHigh: number; // 前一個波段頂（斐波那契擴展起點）
  prevSwingLow: number;  // 前一個波段底（斐波那契擴展起點）
}

export interface SignalResult {
  signal: boolean;
  level: 'high' | 'medium' | 'low' | null;
  score: number;
  reasons: string[];
}

export interface PredictionResult {
  type: 'top' | 'bottom' | 'neutral';
  probability: number;
  signals: string[];
  recommendation: string;
}

export interface Alert {
  id: string;
  symbol: string;
  type: 'buy' | 'sell' | 'top' | 'bottom';
  level: 'high' | 'medium' | 'low';
  price: number;
  score: number;
  reasons: string[];
  timestamp: number;
  read: boolean;
  message: string;
  takeProfit?: number;  // 止盈價位
  stopLoss?:   number;  // 止損價位
}

export interface KLineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockAnalysis {
  symbol: string;
  price: number;
  indicators: TechnicalIndicators;
  buySignal: SignalResult;
  sellSignal: SignalResult;
  prediction: PredictionResult;
}

// ─── 自选股 & 搜索 ────────────────────────────────────────────────────────────

export type AssetType = 'equity' | 'etf' | 'futures' | 'index' | 'crypto' | 'other';

export interface WatchlistItem {
  symbol:    string;
  name:      string;
  addedAt:   number;
  assetType: AssetType;
  exchange?: string;
}

export interface SearchResult {
  symbol:    string;
  name:      string;
  assetType: AssetType;
  exchange:  string;
}

export type DataSource = 'real' | 'database' | 'simulated';

export interface SymbolMeta {
  source:      DataSource;
  lastUpdated: number;
}
