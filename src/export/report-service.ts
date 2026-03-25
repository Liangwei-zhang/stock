/**
 * export/report-service.ts — 报表构建服务
 *
 * 从当前运行时状态（stockService + pluginRegistry + marketDB）
 * 组装出完整的 AnalysisReport，交给 report-exporter 导出。
 */

import type { AnalysisReport, OHLCVRecord } from '../core/types';
import { pluginRegistry }  from '../core/plugin-registry';
import { stockService }    from '../services/stockService';
import { marketDB }        from '../db/market-db';
import { exportReport }    from './report-exporter';

/**
 * 为指定 symbol 生成分析报表并触发下载。
 *
 * @param symbol   标的代码
 * @param format   'csv' | 'json' | 'html'
 */
export async function generateAndExport(
  symbol:  string,
  format:  'csv' | 'json' | 'html',
): Promise<void> {
  const plugin = pluginRegistry.getActive();
  if (!plugin) throw new Error('No active strategy plugin');

  const history = stockService.getStockHistory(symbol);
  if (!history.length) throw new Error(`No data for ${symbol}`);

  const item   = stockService.getWatchlist().find(w => w.symbol === symbol);
  const name   = item?.name ?? symbol;
  const result = pluginRegistry.analyze(history, symbol);
  if (!result) throw new Error(`Analysis failed for ${symbol}`);

  // 从 DB 取完整历史（比内存的 120 根更完整）
  let dbRows: OHLCVRecord[] = [];
  try {
    dbRows = await marketDB.queryOHLCV(symbol);
  } catch { /* 降级到内存历史 */ }

  // 如果 DB 数据不够，使用内存数据转换
  if (dbRows.length < history.length) {
    dbRows = history.map(d => ({
      symbol:    d.symbol,
      timestamp: d.timestamp,
      open:      d.open,
      high:      d.high,
      low:       d.low,
      close:     d.close,
      volume:    d.volume,
      source:    stockService.getSymbolMeta(symbol).source,
    }));
  }

  const latest     = history[history.length - 1];
  const prevClose  = history.length > 1 ? history[history.length - 2].close : latest.close;

  const report: AnalysisReport = {
    generatedAt:  Date.now(),
    symbol,
    name,
    pluginId:     plugin.id,
    pluginName:   plugin.name,
    price:        latest.price,
    priceChange:  latest.price - prevClose,
    indicators:   result.indicators,
    buySignal:    result.buySignal,
    sellSignal:   result.sellSignal,
    prediction:   result.prediction,
    history:      dbRows,
    metadata:     result.metadata,
  };

  exportReport(report, format);
}
