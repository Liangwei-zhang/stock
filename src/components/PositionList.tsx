import React from 'react';
import { Table, Tag, Typography, Space } from 'antd';
import { Position } from '../services/tradingSimulator';

const { Text } = Typography;

interface PositionListProps {
  positions: Position[];
  prices:    Map<string, number>;
}

const positionColumns = (prices: Map<string, number>) => [
  { title: '標的', dataIndex: 'symbol',   key: 'symbol',   width: 70, render: (s: string) => <Tag color="blue">{s}</Tag> },
  { title: '數量', dataIndex: 'quantity', key: 'quantity', width: 80, render: (v: number) => v.toFixed(4) },
  { title: '均價', dataIndex: 'avgPrice', key: 'avgPrice', width: 90, render: (v: number) => `$${v.toFixed(2)}` },
  { title: '現價', key: 'curPrice', render: (_: unknown, r: Position) => {
      const p   = prices.get(r.symbol) ?? r.avgPrice;
      const chg = ((p - r.avgPrice) / r.avgPrice) * 100;
      return <span>${p.toFixed(2)} <span style={{ fontSize: 11, color: chg >= 0 ? '#52c41a' : '#ff4d4f' }}>({chg >= 0 ? '+' : ''}{chg.toFixed(2)}%)</span></span>;
  }},
  { title: '止損/止盈', key: 'sltp', render: (_: unknown, r: Position) => (
      <Space size={2}>
        <Tag color="red"   style={{ margin: 0, fontSize: 11 }}>SL ${(r.stopLoss   ?? 0).toFixed(2)}</Tag>
        <Tag color="green" style={{ margin: 0, fontSize: 11 }}>TP ${(r.takeProfit ?? 0).toFixed(2)}</Tag>
      </Space>
  )},
  { title: '未實現盈虧', key: 'pnl', render: (_: unknown, r: Position) => {
      const p   = prices.get(r.symbol) ?? r.avgPrice;
      const pnl = (p - r.avgPrice) * r.quantity;
      const pct = ((p - r.avgPrice) / r.avgPrice) * 100;
      return <Text style={{ color: pnl >= 0 ? '#52c41a' : '#ff4d4f' }}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pct.toFixed(2)}%)</Text>;
  }},
];

export const PositionList: React.FC<PositionListProps> = React.memo(({ positions, prices }) => (
  <Table
    dataSource={positions}
    columns={positionColumns(prices)}
    rowKey="symbol"
    size="small"
    pagination={false}
    locale={{ emptyText: '目前無持倉' }}
  />
));

PositionList.displayName = 'PositionList';
