/**
 * export/report-exporter.ts — 分析报表导出
 *
 * 支持三种格式，无需额外依赖：
 *   CSV   — OHLCV 历史数据，Excel/数据科学友好
 *   JSON  — 完整分析结果（含信号、指标、预测），机器可读
 *   HTML  — 可打印的分析报表，浏览器 Ctrl+P 即可存 PDF
 */

import type { AnalysisReport } from '../core/types';

// ─── 工具 ────────────────────────────────────────────────────────────────────

function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function fmtDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN');
}

function fmtNum(n: number, dec = 4): string {
  if (!isFinite(n)) return '—';
  return n.toFixed(dec);
}

// ─── CSV 导出 ─────────────────────────────────────────────────────────────────

export function exportCSV(report: AnalysisReport): void {
  const rows = [
    ['Date', 'Open', 'High', 'Low', 'Close', 'Volume', 'Source'].join(','),
    ...report.history.map(r =>
      [fmtDate(r.timestamp), r.open, r.high, r.low, r.close, r.volume, r.source].join(',')
    ),
  ];

  downloadBlob(
    rows.join('\n'),
    `${report.symbol}_ohlcv_${fmtDate(report.generatedAt)}.csv`,
    'text/csv;charset=utf-8;',
  );
}

// ─── JSON 导出 ────────────────────────────────────────────────────────────────

export function exportJSON(report: AnalysisReport): void {
  const payload = {
    meta: {
      symbol:      report.symbol,
      name:        report.name,
      generatedAt: fmtTs(report.generatedAt),
      plugin:      `${report.pluginName} (${report.pluginId})`,
    },
    price: {
      current: report.price,
      change:  report.priceChange,
    },
    buySignal:  report.buySignal,
    sellSignal: report.sellSignal,
    prediction: report.prediction,
    indicators: report.indicators,
    metadata:   report.metadata,
    historyRows: report.history.length,
  };

  downloadBlob(
    JSON.stringify(payload, null, 2),
    `${report.symbol}_analysis_${fmtDate(report.generatedAt)}.json`,
    'application/json',
  );
}

// ─── HTML 报表 ────────────────────────────────────────────────────────────────

export function exportHTML(report: AnalysisReport): void {
  const ind = report.indicators;

  const signalColor = (s: boolean, level: string | null) =>
    !s ? '#666' : level === 'high' ? '#22c55e' : level === 'medium' ? '#f59e0b' : '#60a5fa';

  const predColor = report.prediction.type === 'bottom' ? '#22c55e'
    : report.prediction.type === 'top' ? '#ef4444' : '#94a3b8';

  const indRows = ind ? [
    ['EMA9',   fmtNum(ind.ema9,  2)],
    ['EMA21',  fmtNum(ind.ema21, 2)],
    ['MA20',   fmtNum(ind.ma20,  2)],
    ['RSI6',   fmtNum(ind.rsi6,  1)],
    ['RSI14',  fmtNum(ind.rsi14, 1)],
    ['ADX',    fmtNum(ind.adx,   1)],
    ['MACD',   fmtNum(ind.macdDif, 4)],
    ['Hist',   fmtNum(ind.macdHistogram, 4)],
    ['BB宽',   ind.bollWidth ? (ind.bollWidth * 100).toFixed(2) + '%' : '—'],
    ['POC',    fmtNum(ind.poc, 2)],
    ['底背离', ind.rsiBullDiv ? '✓' : '—'],
    ['顶背离', ind.rsiBearDiv ? '✓' : '—'],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('') : '';

  // 最近 30 根 K 线表格
  const klineRows = report.history.slice(-30).reverse().map(r => `
    <tr>
      <td>${fmtDate(r.timestamp)}</td>
      <td>${fmtNum(r.open, 2)}</td>
      <td>${fmtNum(r.high, 2)}</td>
      <td>${fmtNum(r.low,  2)}</td>
      <td style="font-weight:600;color:${r.close >= r.open ? '#22c55e' : '#ef4444'}">${fmtNum(r.close, 2)}</td>
      <td>${r.volume.toLocaleString()}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${report.symbol} 分析报表 — ${fmtDate(report.generatedAt)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'PingFang SC', sans-serif; background: #0d1117; color: #e6edf3; padding: 32px; }
  @media print { body { background: #fff; color: #000; padding: 16px; } .no-print { display: none; } }
  h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 14px; font-weight: 500; color: #8b949e; margin: 20px 0 10px; text-transform: uppercase; letter-spacing: .06em; }
  .meta { color: #8b949e; font-size: 13px; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 16px; }
  .card { background: #161b22; border: 1px solid #21262d; border-radius: 10px; padding: 16px; }
  .card-title { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 8px; }
  .price { font-size: 32px; font-weight: 700; }
  .change { font-size: 14px; margin-left: 8px; }
  .signal-score { font-size: 40px; font-weight: 800; }
  .reasons { margin-top: 8px; }
  .reason { font-size: 12px; color: #8b949e; padding: 2px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #161b22; color: #8b949e; font-weight: 500; padding: 8px 10px; text-align: left; border-bottom: 1px solid #21262d; }
  td { padding: 7px 10px; border-bottom: 1px solid #161b22; }
  tr:hover td { background: rgba(255,255,255,.03); }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .pred-badge { display: inline-block; padding: 6px 14px; border-radius: 8px; font-size: 14px; font-weight: 700; margin-bottom: 8px; }
  .print-btn { position: fixed; bottom: 24px; right: 24px; padding: 10px 20px; background: #1890ff; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>

<div class="no-print">
  <button class="print-btn" onclick="window.print()">🖨 打印 / 存 PDF</button>
</div>

<h1>${report.symbol} &nbsp;<span style="font-size:16px;color:#8b949e">${report.name}</span></h1>
<div class="meta">
  生成时间：${fmtTs(report.generatedAt)} &nbsp;·&nbsp;
  算法：${report.pluginName} &nbsp;·&nbsp;
  数据：${report.history.length} 根 K 线
</div>

<div class="grid">

  <!-- 价格 -->
  <div class="card">
    <div class="card-title">当前价格</div>
    <div class="price">$${fmtNum(report.price, 2)}</div>
    <div class="change" style="color:${report.priceChange >= 0 ? '#22c55e' : '#ef4444'}">
      ${report.priceChange >= 0 ? '+' : ''}${fmtNum(report.priceChange, 2)} 今日
    </div>
  </div>

  <!-- 买入信号 -->
  <div class="card" style="border-color:${signalColor(report.buySignal.signal, report.buySignal.level)}40">
    <div class="card-title">买入信号</div>
    <div class="signal-score" style="color:${signalColor(report.buySignal.signal, report.buySignal.level)}">
      ${report.buySignal.signal ? report.buySignal.score : '—'}
    </div>
    ${report.buySignal.signal ? `
      <span class="tag" style="background:${signalColor(true, report.buySignal.level)}22;color:${signalColor(true, report.buySignal.level)}">
        ${report.buySignal.level === 'high' ? '高级' : report.buySignal.level === 'medium' ? '中级' : '低级'}
      </span>
      <div class="reasons">
        ${report.buySignal.reasons.slice(0, 4).map(r => `<div class="reason">• ${r}</div>`).join('')}
      </div>
    ` : '<div style="color:#484f58;font-size:13px;margin-top:8px">无触发信号</div>'}
  </div>

  <!-- 卖出信号 -->
  <div class="card" style="border-color:${signalColor(report.sellSignal.signal, report.sellSignal.level)}40">
    <div class="card-title">卖出信号</div>
    <div class="signal-score" style="color:${signalColor(report.sellSignal.signal, report.sellSignal.level)}">
      ${report.sellSignal.signal ? report.sellSignal.score : '—'}
    </div>
    ${report.sellSignal.signal ? `
      <span class="tag" style="background:${signalColor(true, report.sellSignal.level)}22;color:${signalColor(true, report.sellSignal.level)}">
        ${report.sellSignal.level === 'high' ? '高级' : report.sellSignal.level === 'medium' ? '中级' : '低级'}
      </span>
      <div class="reasons">
        ${report.sellSignal.reasons.slice(0, 4).map(r => `<div class="reason">• ${r}</div>`).join('')}
      </div>
    ` : '<div style="color:#484f58;font-size:13px;margin-top:8px">无触发信号</div>'}
  </div>

  <!-- 顶底预测 -->
  <div class="card">
    <div class="card-title">顶底预测</div>
    <div class="pred-badge" style="background:${predColor}22;color:${predColor}">
      ${report.prediction.type === 'top' ? '⬆ 潜在顶部'
        : report.prediction.type === 'bottom' ? '⬇ 潜在底部'
        : '◎ 无明显信号'}
    </div>
    ${report.prediction.type !== 'neutral'
      ? `<div style="font-size:28px;font-weight:800;color:${predColor}">${(report.prediction.probability * 100).toFixed(0)}%</div>`
      : ''}
    <div style="font-size:12px;color:#8b949e;margin-top:8px">${report.prediction.recommendation}</div>
    <div style="margin-top:8px">
      ${report.prediction.signals.slice(0, 4).map(s => `<div class="reason">• ${s}</div>`).join('')}
    </div>
  </div>

</div>

<!-- 技术指标 -->
<h2>技术指标</h2>
<div class="card" style="margin-bottom:16px">
  <table>
    <thead><tr><th>指标</th><th>数值</th></tr></thead>
    <tbody>${indRows}</tbody>
  </table>
</div>

<!-- 近 30 日 K 线 -->
<h2>近 30 日 K 线</h2>
<div class="card">
  <table>
    <thead><tr><th>日期</th><th>开</th><th>高</th><th>低</th><th>收</th><th>成交量</th></tr></thead>
    <tbody>${klineRows}</tbody>
  </table>
</div>

</body>
</html>`;

  downloadBlob(
    html,
    `${report.symbol}_report_${fmtDate(report.generatedAt)}.html`,
    'text/html;charset=utf-8;',
  );
}

// ─── 统一入口 ─────────────────────────────────────────────────────────────────

export function exportReport(report: AnalysisReport, format: 'csv' | 'json' | 'html'): void {
  if (format === 'csv')  return exportCSV(report);
  if (format === 'json') return exportJSON(report);
  if (format === 'html') return exportHTML(report);
}
