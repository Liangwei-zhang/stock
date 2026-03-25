import React from 'react';
import { Row, Col, Typography, Button, Tag, Table, Select, message, Space } from 'antd';
import { tradingSimulator } from '../services/tradingSimulator';
import { fmtPrice } from '../utils/format';
import { StockData, WatchlistItem } from '../types';

const { Text } = Typography;

const fmtPnl = (n: number) => `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`;

interface ManualTradeFormProps {
  stocks:         { stock: StockData }[];
  watchlistItems: WatchlistItem[];
  onRefresh:      () => void;
}

export const ManualTradeForm: React.FC<ManualTradeFormProps> = React.memo(({
  stocks, watchlistItems, onRefresh,
}) => {
  const simPositions = tradingSimulator.getPositions();

  return (
    <div>
      <Row gutter={10} align="middle" style={{ marginBottom: 12 }}>
        <Col span={5}>
          <Select
            size="small"
            style={{ width: '100%' }}
            placeholder="选择标的"
            options={watchlistItems.map(w => ({
              label: `${w.symbol} $${fmtPrice(stocks.find(s => s.stock.symbol === w.symbol)?.stock.price ?? 0)}`,
              value: w.symbol,
            }))}
            onChange={async (sym: string) => {
              const price = stocks.find(s => s.stock.symbol === sym)?.stock.price ?? 0;
              if (!price) return message.error('无法获取价格');
              const res = await tradingSimulator.executeTrade(
                { symbol: sym, type: 'buy', price, reason: '手动买入', confidence: 100 }, 0, 'manual',
              );
              if (res.success) { message.success(res.message); onRefresh(); }
              else { message.error(res.message); }
            }}
          />
        </Col>
        <Col><Text style={{ fontSize: 11, color: '#484f58' }}>快速买入（10%仓位）</Text></Col>
        <Col flex={1} />
        {simPositions.length > 0 && (
          <Col><Text style={{ fontSize: 11, color: '#484f58' }}>持仓 {simPositions.length} 个</Text></Col>
        )}
      </Row>
      <Table
        className="compact-table"
        dataSource={simPositions}
        rowKey="symbol"
        size="small"
        pagination={false}
        locale={{ emptyText: '暂无持仓' }}
        columns={[
          { title: '标的',     dataIndex: 'symbol',   width: 80,  render: (s: string) => <Tag color="blue" style={{ margin: 0 }}>{s}</Tag> },
          { title: '数量',     dataIndex: 'quantity', width: 90,  render: (v: number) => v.toFixed(4) },
          { title: '均价',     dataIndex: 'avgPrice', width: 90,  render: (v: number) => `$${fmtPrice(v)}` },
          { title: '现价', key: 'cur', render: (_: unknown, r: any) => {
            const p   = stocks.find(s => s.stock.symbol === r.symbol)?.stock.price ?? r.avgPrice;
            const chg = ((p - r.avgPrice) / r.avgPrice) * 100;
            return <span>${fmtPrice(p)} <span style={{ fontSize: 10, color: chg >= 0 ? '#3fb950' : '#f85149' }}>({chg >= 0 ? '+' : ''}{chg.toFixed(2)}%)</span></span>;
          }},
          { title: '止损/止盈', key: 'sltp', render: (_: unknown, r: any) => (
            <Space size={3}>
              <Tag color="red"   style={{ margin: 0, fontSize: 10 }}>SL${fmtPrice(r.stopLoss ?? 0)}</Tag>
              <Tag color="green" style={{ margin: 0, fontSize: 10 }}>TP${fmtPrice(r.takeProfit ?? 0)}</Tag>
            </Space>
          )},
          { title: '浮动盈亏', key: 'pnl', render: (_: unknown, r: any) => {
            const p   = stocks.find(s => s.stock.symbol === r.symbol)?.stock.price ?? r.avgPrice;
            const pnl = (p - r.avgPrice) * r.quantity;
            return <Text style={{ color: pnl >= 0 ? '#3fb950' : '#f85149', fontSize: 12 }}>{fmtPnl(pnl)}</Text>;
          }},
          { title: '操作', key: 'act', width: 70, render: (_: unknown, r: any) => (
            <Button size="small" danger onClick={async () => {
              const price = stocks.find(s => s.stock.symbol === r.symbol)?.stock.price ?? r.avgPrice;
              const res   = await tradingSimulator.executeTrade(
                { symbol: r.symbol, type: 'sell', price, reason: '手动卖出', confidence: 100 }, r.quantity, 'manual',
              );
              if (res.success) { message.success(res.message); onRefresh(); }
              else { message.error(res.message); }
            }}>平仓</Button>
          )},
        ]}
      />
    </div>
  );
});

ManualTradeForm.displayName = 'ManualTradeForm';
