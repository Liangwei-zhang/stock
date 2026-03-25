import React from 'react';
import { Table, Tag, Typography, Tooltip } from 'antd';
import { Trade } from '../services/tradingSimulator';

const { Text } = Typography;

const EXIT_REASON_TAG: Record<string, { label: string; color: string }> = {
  signal:      { label: '信號', color: 'blue'    },
  stop_loss:   { label: '止損', color: 'red'     },
  take_profit: { label: '止盈', color: 'green'   },
  manual:      { label: '手動', color: 'default' },
  timeout:     { label: '超時', color: 'orange'  },
};

const tradeColumns = [
  { title: '時間', dataIndex: 'date',       key: 'date',       width: 100, render: (t: number) => new Date(t).toLocaleTimeString() },
  { title: '標的', dataIndex: 'symbol',     key: 'symbol',     width: 70,  render: (s: string) => <Tag style={{ margin: 0 }}>{s}</Tag> },
  { title: '方向', dataIndex: 'side',       key: 'side',       width: 60,  render: (s: string) => <Tag color={s === 'buy' ? 'green' : 'red'} style={{ margin: 0 }}>{s === 'buy' ? '買入' : '賣出'}</Tag> },
  { title: '數量', dataIndex: 'quantity',   key: 'quantity',   width: 80,  render: (v: number) => v.toFixed(4) },
  { title: '均價', dataIndex: 'price',      key: 'price',      width: 90,  render: (v: number) => `$${v.toFixed(2)}` },
  { title: '退出', dataIndex: 'exitReason', key: 'exitReason', width: 60,  render: (r: string | undefined) => {
      const { label, color } = EXIT_REASON_TAG[r ?? 'signal'] ?? { label: r, color: 'default' };
      return <Tag color={color} style={{ margin: 0, fontSize: 11 }}>{label}</Tag>;
  }},
  { title: '盈虧', dataIndex: 'pnl',        key: 'pnl',        width: 100, render: (p: number | undefined) => {
      if (p == null) return <Text type="secondary">-</Text>;
      return <Text style={{ color: p >= 0 ? '#52c41a' : '#ff4d4f' }}>{p >= 0 ? '+' : ''}${p.toFixed(2)}</Text>;
  }},
];

interface TradeHistoryProps {
  trades: Trade[];
  limit?: number;
}

export const TradeHistory: React.FC<TradeHistoryProps> = React.memo(({ trades, limit = 15 }) => (
  <Table
    dataSource={trades.slice(0, limit)}
    columns={tradeColumns}
    rowKey="id"
    size="small"
    pagination={false}
    locale={{ emptyText: '無交易記錄' }}
    scroll={{ x: 600 }}
  />
));

TradeHistory.displayName = 'TradeHistory';
