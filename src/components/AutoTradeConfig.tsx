import React from 'react';
import { Row, Col, Typography, Button, Tag, Space } from 'antd';
import { autoTradeService, AutoTradeExecution } from '../services/autoTradeService';
import { fmtPrice } from '../utils/format';
import { StockData, WatchlistItem } from '../types';

const { Text } = Typography;

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleString('en-US', {
    timeZone: 'America/Edmonton',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });

interface AutoTradeConfigProps {
  atCfg:         ReturnType<typeof autoTradeService.getConfig>;
  watchlistItems: WatchlistItem[];
  stocks:         { stock: StockData }[];
  executions:    AutoTradeExecution[];
  onRefresh:     () => void;
}

export const AutoTradeConfig: React.FC<AutoTradeConfigProps> = React.memo(({
  atCfg, watchlistItems, stocks, executions, onRefresh,
}) => (
  <div>
    <Row gutter={16} align="middle" style={{ marginBottom: 12 }}>
      <Col>
        <Text strong style={{ fontSize: 13 }}>全局开关</Text>
        <Text style={{ fontSize: 11, color: '#484f58', marginLeft: 8 }}>
          等级:[{({ high: '高级≥75', medium: '中级≥55', any: '任意' } as Record<string, string>)[atCfg.minLevel]}]&nbsp;
          仓位:{(atCfg.positionPct * 100).toFixed(0)}%&nbsp;
          预测:{atCfg.usePrediction ? `✓≥${(atCfg.minPredProb * 100).toFixed(0)}%` : '✗'}&nbsp;
          冷却:{(atCfg.cooldownMs / 60000).toFixed(0)}分
        </Text>
      </Col>
      <Col flex={1} />
      <Col>
        <Space size={6}>
          <Button size="small" onClick={() => { autoTradeService.setAllSymbols(watchlistItems.map(w => w.symbol), true); onRefresh(); }}>全部开启</Button>
          <Button size="small" danger onClick={() => { autoTradeService.setAllSymbols(watchlistItems.map(w => w.symbol), false); onRefresh(); }}>全部关闭</Button>
          {executions.length > 0 && <Button size="small" onClick={() => { autoTradeService.clearExecutions(); onRefresh(); }}>清空记录</Button>}
        </Space>
      </Col>
    </Row>

    <div className="at-symbol-grid" style={{ marginBottom: 12 }}>
      {watchlistItems.map(w => {
        const on = atCfg.symbolsEnabled[w.symbol] ?? false;
        return (
          <div
            key={w.symbol}
            className={`at-symbol-chip ${atCfg.enabled && on ? 'active' : ''}`}
            onClick={() => { autoTradeService.setSymbolEnabled(w.symbol, !on); onRefresh(); }}
          >
            <span className="chip-dot" />
            {w.symbol}
            <span style={{ fontSize: 10, color: '#484f58' }}>
              ${fmtPrice(stocks.find(s => s.stock.symbol === w.symbol)?.stock.price ?? 0)}
            </span>
          </div>
        );
      })}
    </div>

    {executions.length > 0 ? (
      <div className="exec-feed">
        {executions.slice(0, 15).map(e => (
          <div key={e.id} className={`exec-row ${e.result}`}>
            <span className="exec-time">{fmtTime(e.ts)}</span>
            <Tag color={e.action === 'buy' ? 'green' : 'red'} style={{ margin: 0, fontSize: 10 }}>{e.action === 'buy' ? '买入' : '卖出'}</Tag>
            <span className="exec-sym">{e.symbol}</span>
            <span className="exec-price">${fmtPrice(e.price)}</span>
            <Tag style={{ margin: 0, fontSize: 10 }}>{e.score}</Tag>
            <span className="exec-reason">{e.result === 'success' ? e.reason : e.message}</span>
          </div>
        ))}
      </div>
    ) : (
      <div style={{ textAlign: 'center', padding: '20px 0', color: '#484f58', fontSize: 12 }}>
        开启标的开关后，信号触发时将在此显示执行记录
      </div>
    )}
  </div>
));

AutoTradeConfig.displayName = 'AutoTradeConfig';
