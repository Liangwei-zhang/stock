import React from 'react';
import {
  Row, Col, Tag, Typography, Tabs, Table, Divider, Space,
} from 'antd';
import { SimUserState, SimTrade, DecisionLog } from '../services/simulatedUsers';

const { Text } = Typography;

const ACTION_COLOR: Record<string, string> = {
  buy:           '#52c41a', sell:          '#ff4d4f', hold:          '#8b949e',
  skip:          '#595959', close_sl:      '#ff7875', close_tp:      '#73d13d',
  close_timeout: '#ffa940', paused:        '#faad14',
};
const ACTION_LABEL: Record<string, string> = {
  buy: '買入', sell: '做空', hold: '持倉', skip: '觀望',
  close_sl: '止損', close_tp: '止盈', close_timeout: '超時', paused: '暫停',
};

const logColumns = [
  { title: '時間',  dataIndex: 'ts',     key: 'ts',     width: 80,  render: (t: number) => new Date(t).toLocaleTimeString() },
  { title: '標的',  dataIndex: 'symbol', key: 'symbol', width: 70,  render: (s: string) => <Tag style={{ margin: 0 }}>{s}</Tag> },
  { title: '動作',  dataIndex: 'action', key: 'action', width: 60,
    render: (a: string) => <Tag color={ACTION_COLOR[a]} style={{ margin: 0, fontSize: 11 }}>{ACTION_LABEL[a] ?? a}</Tag> },
  { title: '價格',  dataIndex: 'price',  key: 'price',  width: 80,  render: (p: number) => `$${p.toFixed(2)}` },
  { title: '原因',  dataIndex: 'reason', key: 'reason', ellipsis: true },
];

const tradeColumns = [
  { title: '時間',   dataIndex: 'exitAt',     key: 'exitAt',     width: 80,  render: (t: number) => new Date(t).toLocaleTimeString() },
  { title: '標的',   dataIndex: 'symbol',     key: 'symbol',     width: 65,  render: (s: string) => <Tag style={{ margin: 0 }}>{s}</Tag> },
  { title: '方向',   dataIndex: 'side',       key: 'side',       width: 55,
    render: (s: string) => <Tag color={s === 'buy' ? 'green' : 'red'} style={{ margin: 0, fontSize: 11 }}>{s === 'buy' ? '多' : '空'}</Tag> },
  { title: '退出',   dataIndex: 'exitReason', key: 'exitReason', width: 55,
    render: (r: string) => {
      const map: Record<string, [string, string]> = {
        signal: ['信號', 'blue'], stop_loss: ['止損', 'red'], take_profit: ['止盈', 'green'], timeout: ['超時', 'orange'],
      };
      const [label, color] = map[r] ?? [r, 'default'];
      return <Tag color={color} style={{ margin: 0, fontSize: 11 }}>{label}</Tag>;
    },
  },
  { title: '盈虧',   dataIndex: 'pnl',        key: 'pnl',        width: 90,
    render: (p: number, r: SimTrade) => (
      <Text style={{ color: p >= 0 ? '#52c41a' : '#ff4d4f', fontSize: 12 }}>
        {p >= 0 ? '+' : ''}${p.toFixed(2)}<br />
        <span style={{ fontSize: 10 }}>({r.pnlPct >= 0 ? '+' : ''}{r.pnlPct.toFixed(1)}%)</span>
      </Text>
    ),
  },
];

interface SimulatedUserDetailProps {
  state: SimUserState;
}

export const SimulatedUserDetail: React.FC<SimulatedUserDetailProps> = React.memo(({ state }) => (
  <>
    <Divider />
    <Row gutter={16} style={{ marginBottom: 12 }}>
      <Col>
        <Text style={{ fontSize: 16 }}>{state.user.emoji}</Text>
        <Text strong style={{ marginLeft: 6 }}>{state.user.name} — 詳細面板</Text>
      </Col>
      <Col flex={1} />
      <Col>
        <Space size={4}>
          {Array.from(state.positions.entries()).map(([sym, pos]) => (
            <Tag key={sym} color={pos.side === 'long' ? 'green' : 'red'}>
              {sym} {pos.side === 'long' ? '多' : '空'} {pos.qty.toFixed(3)} @ ${pos.entryPrice.toFixed(2)}
            </Tag>
          ))}
          {state.positions.size === 0 && <Text type="secondary">無持倉</Text>}
        </Space>
      </Col>
    </Row>

    {state.tradeStats && (
      <Row gutter={12} style={{ marginBottom: 16 }}>
        {[
          { label: '胜率',    val: `${(state.tradeStats.winRate * 100).toFixed(1)}%`,           color: state.tradeStats.winRate >= 0.5 ? '#52c41a' : '#ff4d4f' },
          { label: '盈虧比',  val: state.tradeStats.profitFactor.toFixed(2),                    color: undefined },
          { label: '期望值',  val: `$${state.tradeStats.expectancy.toFixed(2)}`,                color: state.tradeStats.expectancy >= 0 ? '#52c41a' : '#ff4d4f' },
          { label: '最大回撤', val: `${(state.tradeStats.maxDrawdown * 100).toFixed(1)}%`,      color: undefined },
          { label: 'Sharpe', val: state.tradeStats.sharpeRatio.toFixed(2),                       color: undefined },
          { label: '止損次數', val: `${state.tradeStats.byExitReason.stop_loss.count}`,         color: '#ff7875' },
          { label: '止盈次數', val: `${state.tradeStats.byExitReason.take_profit.count}`,        color: '#73d13d' },
        ].map(m => (
          <Col key={m.label}>
            <div style={{ fontSize: 10, color: '#8b949e' }}>{m.label}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: m.color }}>{m.val}</div>
          </Col>
        ))}
      </Row>
    )}

    <Tabs
      size="small"
      items={[
        {
          key: 'log',
          label: `決策日誌 (${state.log.length})`,
          children: (
            <Table
              dataSource={state.log}
              columns={logColumns}
              rowKey={(r: DecisionLog) => `${r.ts}-${r.symbol}`}
              size="small"
              pagination={{ pageSize: 10, showSizeChanger: false }}
              scroll={{ x: 400 }}
            />
          ),
        },
        {
          key: 'trades',
          label: `已完成交易 (${state.trades.length})`,
          children: (
            <Table
              dataSource={state.trades}
              columns={tradeColumns}
              rowKey={(r: SimTrade) => r.id}
              size="small"
              pagination={{ pageSize: 10, showSizeChanger: false }}
              scroll={{ x: 400 }}
            />
          ),
        },
        {
          key: 'rules',
          label: '策略規則',
          children: (
            <Row gutter={[16, 8]} style={{ padding: '8px 0' }}>
              {[
                ['買入最低分',   state.user.strategy.minBuyScore === 999  ? '不交易' : state.user.strategy.minBuyScore],
                ['賣出最低分',   state.user.strategy.minSellScore === 999 ? '不交易' : state.user.strategy.minSellScore],
                ['預測最低概率', `${(state.user.strategy.minPredProb * 100).toFixed(0)}%`],
                ['每筆倉位',     `${(state.user.strategy.positionPct * 100).toFixed(0)}%`],
                ['最大持倉數',   state.user.strategy.maxConcurrent],
                ['止損倍數',     `${state.user.strategy.stopMultiplier}x ATR`],
                ['止盈倍數',     `${state.user.strategy.profitMultiplier}x ATR`],
                ['最大持倉期',   state.user.strategy.maxHoldPeriods === 0 ? '無限制' : `${state.user.strategy.maxHoldPeriods} 個周期`],
                ['三重確認',     state.user.strategy.requireTriple ? '✅ 必須' : '❌ 不需'],
                ['順趨勢',       state.user.strategy.onlyWithTrend  ? '✅ 是'   : '❌ 否'],
                ['逆向交易',     state.user.strategy.contrarian     ? '✅ 是'   : '❌ 否'],
                ['回撤暫停線',   `${(state.user.strategy.pauseOnDrawdown * 100).toFixed(0)}%`],
              ].map(([label, val]) => (
                <Col key={label as string} span={8}>
                  <Text type="secondary" style={{ fontSize: 11 }}>{label}</Text>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{val}</div>
                </Col>
              ))}
            </Row>
          ),
        },
      ]}
    />
  </>
));

SimulatedUserDetail.displayName = 'SimulatedUserDetail';
