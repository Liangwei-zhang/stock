import React from 'react';
import { Typography, Tag, Switch } from 'antd';
import { autoTradeService } from '../services/autoTradeService';
import { StockAnalysis } from '../types';

const { Text } = Typography;

interface Props {
  analysis:      StockAnalysis;
  selectedStock: string;
  onRefresh:     () => void;
}

export const AnalysisGrid: React.FC<Props> = ({ analysis, selectedStock, onRefresh }) => {
  const atCfg = autoTradeService.getConfig();
  const ind    = analysis.indicators;
  const symbolAutoTradeOn = atCfg.enabled && (atCfg.symbolsEnabled[selectedStock] ?? false);

  return (
    <div className="analysis-grid">

      {/* ── Card 1: Technical Indicators ───────────────────────────────── */}
      <div className="analysis-card analysis-card--indicators">
        <div className="analysis-card-title-row">
          <div className="analysis-card-title">技術指標</div>
          <span className="analysis-card-chip">趨勢與動能</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          {[
            ['EMA9',  ind.ema9.toFixed(2),   ind.ema9 > ind.ema21 ? 'pos' : 'neg'],
            ['EMA21', ind.ema21.toFixed(2),  ''],
            ['MA20',  ind.ma20.toFixed(2),   ''],
            ['ADX',   ind.adx.toFixed(1),    ind.adx > 25 ? 'pos' : ''],
            ['RSI9',  ind.rsi9.toFixed(1),   ind.rsi9 > 70 ? 'neg' : ind.rsi9 < 30 ? 'pos' : ''],
            ['RSI14', ind.rsi14.toFixed(1),  ind.rsi14 > 70 ? 'neg' : ind.rsi14 < 30 ? 'pos' : ''],
          ].map(([l, v, c]) => (
            <div key={l} className="ind-row">
              <span className="ind-label">{l}</span>
              <span className={`ind-value ${c}`}>{v}</span>
            </div>
          ))}
          <div className="ind-separator" style={{ gridColumn: '1/-1' }}/>
          {[
            ['MACD',  ind.macdDif.toFixed(4),               ind.macdDif > 0 ? 'pos' : 'neg'],
            ['柱狀圖', ind.macdHistogram.toFixed(4),         ind.macdHistogram > 0 ? 'pos' : 'neg'],
            ['POC',   `$${ind.poc.toFixed(2)}`,             ''],
            ['布林帶寬', (ind.bollWidth * 100).toFixed(2) + '%', ind.bollSqueezing ? 'warn' : ''],
            ['多頭背離', ind.rsiBullDiv ? '✓' : '—',          ind.rsiBullDiv ? 'pos' : ''],
            ['空頭背離', ind.rsiBearDiv ? '✓' : '—',          ind.rsiBearDiv ? 'neg' : ''],
          ].map(([l, v, c]) => (
            <div key={l} className="ind-row">
              <span className="ind-label">{l}</span>
              <span className={`ind-value ${c}`}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Card 2: Buy / Sell Signals ──────────────────────────────────── */}
      <div className="analysis-card analysis-card--signals">
        <div className="analysis-card-title-row">
          <div className="analysis-card-title">買賣信號</div>
          <span className="analysis-card-chip">
            {analysis.buySignal.signal || analysis.sellSignal.signal ? '即時訊號' : '等待訊號'}
          </span>
        </div>
        <div className="signal-scorecard">
          {/* Buy */}
          <div className={`score-box ${analysis.buySignal.signal ? 'buy' : 'none'}`}>
            <div className={`score-label ${analysis.buySignal.signal ? 'buy' : ''}`}>買入</div>
            <div className={`score-number ${analysis.buySignal.signal ? 'buy' : 'none'}`}>
              {analysis.buySignal.signal ? analysis.buySignal.score : '—'}
            </div>
            {analysis.buySignal.signal && (
              <>
                <Tag color={analysis.buySignal.level === 'high' ? 'green' : 'lime'}
                  style={{ margin: '4px 0 0', fontSize: 10 }}>
                  {analysis.buySignal.level === 'high' ? '高' : '中'}
                </Tag>
                <div className="score-reasons">
                  {analysis.buySignal.reasons.slice(0, 3).map((r, i) =>
                    <span key={i} className="score-reason">• {r}</span>
                  )}
                </div>
              </>
            )}
          </div>
          {/* Sell */}
          <div className={`score-box ${analysis.sellSignal.signal ? 'sell' : 'none'}`}>
            <div className={`score-label ${analysis.sellSignal.signal ? 'sell' : ''}`}>賣出</div>
            <div className={`score-number ${analysis.sellSignal.signal ? 'sell' : 'none'}`}>
              {analysis.sellSignal.signal ? analysis.sellSignal.score : '—'}
            </div>
            {analysis.sellSignal.signal && (
              <>
                <Tag color={analysis.sellSignal.level === 'high' ? 'red' : 'volcano'}
                  style={{ margin: '4px 0 0', fontSize: 10 }}>
                  {analysis.sellSignal.level === 'high' ? '高' : '中'}
                </Tag>
                <div className="score-reasons">
                  {analysis.sellSignal.reasons.slice(0, 3).map((r, i) =>
                    <span key={i} className="score-reason">• {r}</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Auto-trade toggle for this symbol */}
        <div className="auto-trade-toggle-row">
          <div>
            <Text className={`auto-trade-status${symbolAutoTradeOn ? ' active' : ''}`}>
              {symbolAutoTradeOn ? '⚡ 自動交易已啟用' : '⏸ 自動交易已關閉'}
            </Text>
            <div className="auto-trade-caption">可針對目前標的開啟或關閉自動監控。</div>
          </div>
          <Switch
            size="small"
            checked={atCfg.symbolsEnabled[selectedStock] ?? false}
            onChange={v => { autoTradeService.setSymbolEnabled(selectedStock, v); onRefresh(); }}
          />
        </div>
      </div>

      {/* ── Card 3: Top / Bottom Prediction ─────────────────────────────── */}
      <div className="analysis-card analysis-card--prediction">
        <div className="analysis-card-title-row">
          <div className="analysis-card-title">頂底預測</div>
          <span className="analysis-card-chip">
            {analysis.prediction.type === 'neutral' ? '中性區間' : '機率模型'}
          </span>
        </div>
        <div className={`pred-type-badge ${analysis.prediction.type}`}>
          {analysis.prediction.type === 'top'
            ? '⬆ 可能形成頂部'
            : analysis.prediction.type === 'bottom'
              ? '⬇ 可能形成底部'
              : '◎ 暫無明確訊號'}
        </div>
        {analysis.prediction.type !== 'neutral' && (
          <div className="pred-prob">
            {(analysis.prediction.probability * 100).toFixed(0)}%
          </div>
        )}
        <div className="pred-signals">
          {analysis.prediction.signals.slice(0, 4).map((s, i) =>
            <span key={i} className="pred-signal-tag">{s}</span>
          )}
        </div>
        <div className="pred-reco">{analysis.prediction.recommendation}</div>
      </div>

    </div>
  );
};
