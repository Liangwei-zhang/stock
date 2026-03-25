import React from 'react';
import { Row, Col, Progress } from 'antd';
import { TradeStats } from '../services/backtestStats';

interface StatCell {
  l: string;
  v: string;
  c: string;
  p?: number;
}

interface TradeStatsProps {
  stats: TradeStats;
}

export const TradeStatsPanel: React.FC<TradeStatsProps> = React.memo(({ stats }) => {
  const cells: StatCell[] = [
    { l: '胜率',    v: `${(stats.winRate * 100).toFixed(1)}%`,                           c: stats.winRate >= 0.5 ? '#52c41a' : '#ff4d4f', p: Math.round(stats.winRate * 100) },
    { l: '盈亏比',  v: stats.profitFactor.toFixed(2),                                    c: stats.profitFactor >= 1.5 ? '#52c41a' : '#faad14' },
    { l: '期望值',  v: `${stats.expectancy >= 0 ? '+' : ''}$${stats.expectancy.toFixed(2)}`, c: stats.expectancy >= 0 ? '#52c41a' : '#ff4d4f' },
    { l: '最大回撤', v: `${(stats.maxDrawdown * 100).toFixed(1)}%`,                      c: stats.maxDrawdown > 0.2 ? '#ff4d4f' : '#faad14' },
    { l: 'Sharpe',  v: stats.sharpeRatio.toFixed(2),                                     c: stats.sharpeRatio >= 1 ? '#52c41a' : '#8b949e' },
    { l: '止损',    v: `${stats.byExitReason.stop_loss.count}次`,                        c: '#ff7875' },
    { l: '止盈',    v: `${stats.byExitReason.take_profit.count}次`,                      c: '#73d13d' },
  ];

  return (
    <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
      {cells.map(m => (
        <Col key={m.l} span={3}>
          <div style={{ textAlign: 'center', padding: '6px 4px', background: 'var(--color-background-secondary,#f9f9f9)', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: '#8b949e' }}>{m.l}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: m.c }}>{m.v}</div>
            {m.p != null && <Progress percent={m.p} showInfo={false} size="small" strokeColor={m.c} style={{ marginTop: 2 }} />}
          </div>
        </Col>
      ))}
    </Row>
  );
});

TradeStatsPanel.displayName = 'TradeStatsPanel';
