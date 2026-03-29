/**
 * SimulatedUsersPanel.tsx — 模拟用户排行榜 + 决策日志面板
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Switch, Button, Tag, Typography, Tooltip,
  Table, Tabs, Statistic, Badge, Space, Divider, InputNumber,
  Modal, Select, Slider, Form,
} from 'antd';
import {
  TrophyOutlined, ReloadOutlined, SettingOutlined,
  ArrowUpOutlined, ArrowDownOutlined, PauseOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import {
  simulatedUserService,
  SimUserState, SimTrade, DecisionLog, UserStrategy,
} from '../services/simulatedUsers';

const { Text, Title } = Typography;

interface Props {
  prices:   Map<string, number>;
  symbols:  string[];             // 可供选择的标的（来自自选股）
  embedded?: boolean;             // 嵌入在 tab 里时隐藏外层 Card
}

const ACTION_COLOR: Record<string, string> = {
  buy:             '#52c41a',
  sell:            '#ff4d4f',
  hold:            '#6f8578',
  skip:            '#7b9586',
  close_sl:        '#ff7875',
  close_tp:        '#73d13d',
  close_timeout:   '#ffa940',
  paused:          '#faad14',
};
const ACTION_LABEL: Record<string, string> = {
  buy:           'Buy',
  sell:          'Short',
  hold:          'Hold',
  skip:          'Skip',
  close_sl:      'Stop Loss',
  close_tp:      'Take Profit',
  close_timeout: 'Timeout',
  paused:        'Paused',
};

/** Mini profit curve canvas chart */
const MiniProfitChart: React.FC<{ points: number[]; width?: number; height?: number }> = ({
  points, width = 80, height = 18,
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const isUp  = points[points.length - 1] >= points[0];
    ctx.beginPath();
    ctx.strokeStyle = isUp ? '#4ade80' : '#f85149';
    ctx.lineWidth   = 1.2;
    points.forEach((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((p - min) / range) * (height - 2) - 1;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [points, width, height]);
  return <canvas ref={canvasRef} width={width} height={height} style={{ display: 'block', marginTop: 3 }} />;
};

export const SimulatedUsersPanel: React.FC<Props> = ({ prices, symbols, embedded }) => {
  const [enabled,   setEnabled]   = useState(simulatedUserService.isEnabled());
  const [states,    setStates]    = useState<SimUserState[]>([]);
  const [ranking,   setRanking]   = useState<{ state: SimUserState; totalValue: number; pnlPct: number }[]>([]);
  const [activeUser, setActiveUser] = useState<string | null>(null);
  const [settingUser, setSettingUser] = useState<SimUserState | null>(null);
  const [resetBal,  setResetBal]  = useState<number>(50000);
  const [tick,      setTick]      = useState(0);

  const refresh = useCallback(() => {
    setStates(simulatedUserService.getStates());
    setRanking(simulatedUserService.getRanking(prices));
    setTick(t => t + 1);
  }, [prices]);

  useEffect(() => {
    simulatedUserService.setOnUpdate(refresh);
    refresh();
    return () => simulatedUserService.setOnUpdate(() => {});
  }, [refresh]);

  const handleEnable = (v: boolean) => {
    simulatedUserService.setEnabled(v);
    setEnabled(v);
  };

  const handleResetAll = () => {
    simulatedUserService.resetAll(resetBal);
    refresh();
  };

  const handleResetUser = (userId: string) => {
    simulatedUserService.resetUser(userId);
    refresh();
  };

  const selectedState = activeUser ? states.find(s => s.user.id === activeUser) : null;
  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // ── 排行榜卡片 ─────────────────────────────────────────────────────────────
  const RankCard = ({ item, rank }: { item: typeof ranking[0]; rank: number }) => {
    const { state, totalValue, pnlPct } = item;
    const { user } = state;
    const isPos = pnlPct >= 0;
    const winRate = state.tradeStats?.winRate ?? null;
    const trades  = state.trades.length;

    // Mini profit curve from cumulative trade PnL
    const profitCurve = React.useMemo(() => {
      const points: number[] = [0];
      let cum = 0;
      // Iterate backwards (oldest first) without creating a reversed copy
      for (let i = state.trades.length - 1; i >= 0; i--) {
        cum += state.trades[i].pnl;
        points.push(cum);
      }
      return points.slice(-20);
    }, [state.trades]);

    const cardClass = [
      'sim-user-card',
      rank === 1 ? 'rank-1' : '',
      !isPos ? 'loss' : '',
    ].filter(Boolean).join(' ');

    return (
      <Card
        size="small"
        className={cardClass}
        style={{
          cursor: 'pointer',
          border: activeUser === user.id ? '1.5px solid #77d7a2' : undefined,
          transition: 'all 0.2s',
          background: activeUser === user.id ? 'rgba(119,215,162,0.06)' : undefined,
        }}
        onClick={() => setActiveUser(prev => prev === user.id ? null : user.id)}
      >
        <Row align="middle" gutter={8}>
          <Col>
            <Text style={{ fontSize: 22 }}>{rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : `#${rank}`}</Text>
          </Col>
          <Col flex={1}>
            <Row align="middle" gutter={4}>
              <Col>
                <Text style={{ fontSize: 16 }}>{user.emoji}</Text>
              </Col>
              <Col>
                <Text strong style={{ fontSize: 13 }}>{user.name}</Text>
                {state.paused && <Tag color="orange" style={{ marginLeft: 4, fontSize: 10 }}>Paused</Tag>}
              </Col>
            </Row>
            <Text type="secondary" style={{ fontSize: 11 }}>{user.description}</Text>
            {state.allowedSymbols.length > 0 && (
              <div style={{ marginTop: 2 }}>
                {state.allowedSymbols.slice(0, 4).map(sym => (
                  <Tag key={sym} style={{ margin: '1px 2px', fontSize: 10, padding: '0 4px' }}>{sym}</Tag>
                ))}
                {state.allowedSymbols.length > 4 && (
                  <Tag style={{ margin: '1px 2px', fontSize: 10, padding: '0 4px' }}>+{state.allowedSymbols.length - 4}</Tag>
                )}
              </div>
            )}
            {state.allowedSymbols.length === 0 && (
              <Text type="secondary" style={{ fontSize: 10 }}>All watchlist symbols</Text>
            )}
            {/* Mini profit sparkline */}
            {profitCurve.length >= 2 && (
              <MiniProfitChart points={profitCurve} width={80} height={18} />
            )}
          </Col>
          <Col style={{ textAlign: 'right', minWidth: 100 }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: isPos ? '#4ade80' : '#ff4d4f' }}>
              {isPos ? '+' : ''}{pnlPct.toFixed(2)}%
            </div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              ${totalValue.toFixed(0)} | {trades} trades
              {winRate !== null && ` | Win ${((winRate) * 100).toFixed(0)}%`}
            </Text>
          </Col>
          <Col>
            <Tooltip title="Edit strategy">
              <Button
                size="small"
                type="text"
                icon={<SettingOutlined />}
                onClick={e => { e.stopPropagation(); setSettingUser(state); }}
              />
            </Tooltip>
            <Tooltip title="Reset user">
              <Button
                size="small"
                type="text"
                danger
                icon={<ReloadOutlined />}
                onClick={e => { e.stopPropagation(); handleResetUser(user.id); }}
              />
            </Tooltip>
          </Col>
        </Row>

        {/* 迷你指标行 */}
        <Row gutter={8} style={{ marginTop: 8 }}>
          {[
            { label: 'Positions', val: state.positions.size, color: state.positions.size > 0 ? '#77d7a2' : '#7b9586' },
            { label: 'Profit Factor', val: state.tradeStats ? state.tradeStats.profitFactor.toFixed(1) : '-', color: undefined },
            { label: 'Max Drawdown', val: state.tradeStats ? `${(state.tradeStats.maxDrawdown*100).toFixed(1)}%` : '-', color: undefined },
            { label: 'Sharpe', val: state.tradeStats ? state.tradeStats.sharpeRatio.toFixed(2) : '-', color: undefined },
          ].map(m => (
            <Col key={m.label}>
              <Text type="secondary" style={{ fontSize: 10 }}>{m.label}</Text>
              <div style={{ fontSize: 12, fontWeight: 500, color: m.color }}>{m.val}</div>
            </Col>
          ))}
        </Row>
      </Card>
    );
  };

  // ── 用户详情：日志 + 交易 ───────────────────────────────────────────────────

  const logColumns = [
    {
      title: 'Time', dataIndex: 'ts', key: 'ts', width: 90,
      render: (t: number) => formatTime(t),
    },
    {
      title: 'Symbol', dataIndex: 'symbol', key: 'symbol', width: 70,
      render: (s: string) => <Tag style={{ margin: 0 }}>{s}</Tag>,
    },
    {
      title: 'Action', dataIndex: 'action', key: 'action', width: 90,
      render: (a: string) => (
        <Tag color={ACTION_COLOR[a]} style={{ margin: 0, fontSize: 11 }}>
          {ACTION_LABEL[a] ?? a}
        </Tag>
      ),
    },
    {
      title: 'Price', dataIndex: 'price', key: 'price', width: 80,
      render: (p: number) => `$${p.toFixed(2)}`,
    },
    { title: 'Reason', dataIndex: 'reason', key: 'reason', ellipsis: true },
  ];

  const tradeColumns = [
    {
      title: 'Time', dataIndex: 'exitAt', key: 'exitAt', width: 90,
      render: (t: number) => formatTime(t),
    },
    {
      title: 'Symbol', dataIndex: 'symbol', key: 'symbol', width: 65,
      render: (s: string) => <Tag style={{ margin: 0 }}>{s}</Tag>,
    },
    {
      title: 'Side', dataIndex: 'side', key: 'side', width: 65,
      render: (s: string) => (
        <Tag color={s === 'buy' ? 'green' : 'red'} style={{ margin: 0, fontSize: 11 }}>
          {s === 'buy' ? 'Long' : 'Short'}
        </Tag>
      ),
    },
    {
      title: 'Exit', dataIndex: 'exitReason', key: 'exitReason', width: 90,
      render: (r: string) => {
        const map: Record<string, [string, string]> = {
          signal:      ['Signal', 'green'],
          stop_loss:   ['Stop Loss', 'red'],
          take_profit: ['Take Profit', 'green'],
          timeout:     ['Timeout', 'orange'],
        };
        const [label, color] = map[r] ?? [r, 'default'];
        return <Tag color={color} style={{ margin: 0, fontSize: 11 }}>{label}</Tag>;
      },
    },
    {
      title: 'PnL', dataIndex: 'pnl', key: 'pnl', width: 90,
      render: (p: number, r: SimTrade) => (
        <Text style={{ color: p >= 0 ? '#52c41a' : '#ff4d4f', fontSize: 12 }}>
          {p >= 0 ? '+' : ''}${p.toFixed(2)}<br />
          <span style={{ fontSize: 10 }}>({r.pnlPct >= 0 ? '+' : ''}{r.pnlPct.toFixed(1)}%)</span>
        </Text>
      ),
    },
  ];

  // ── 策略设置 Modal ─────────────────────────────────────────────────────────

  const StrategyModal = () => {
    if (!settingUser) return null;
    const s = settingUser.user.strategy;
    const [form] = Form.useForm();

    return (
      <Modal
        title={`${settingUser.user.emoji} ${settingUser.user.name} Settings`}
        open={!!settingUser}
        onCancel={() => setSettingUser(null)}
        onOk={() => {
          const vals = form.getFieldsValue();
          // 先更新策略
          simulatedUserService.updateStrategy(settingUser.user.id, {
            minBuyScore:      vals.minBuyScore,
            minSellScore:     vals.minSellScore,
            minPredProb:      vals.minPredProb / 100,
            positionPct:      vals.positionPct / 100,
            stopMultiplier:   vals.stopMultiplier,
            profitMultiplier: vals.profitMultiplier,
            requireTriple:    vals.requireTriple,
            onlyWithTrend:    vals.onlyWithTrend,
            pauseOnDrawdown:  vals.pauseOnDrawdown / 100,
          });
          // 更新标的白名单
          simulatedUserService.setUserSymbols(settingUser.user.id, vals.allowedSymbols ?? []);
          // 如果余额变了，重置账户（保留策略）
          const newBal = vals.initBalance;
          if (newBal && newBal !== settingUser.initBalance) {
            Modal.confirm({
              title: 'Reset account?',
              content: `Change ${settingUser.user.name} to $${newBal.toLocaleString()} initial capital and reset the account? Positions and trade history will be cleared.`,
              onOk: () => {
                simulatedUserService.setUserInitBalance(settingUser.user.id, newBal);
                refresh();
              },
            });
          }
          setSettingUser(null);
          refresh();
        }}
        width={560}
      >
        <Form form={form} layout="horizontal" labelCol={{ span: 10 }} initialValues={{
          minBuyScore:      s.minBuyScore === 999 ? 75 : s.minBuyScore,
          minSellScore:     s.minSellScore === 999 ? 75 : s.minSellScore,
          minPredProb:      Math.round(s.minPredProb * 100),
          positionPct:      Math.round(s.positionPct * 100),
          stopMultiplier:   s.stopMultiplier,
          profitMultiplier: s.profitMultiplier,
          requireTriple:    s.requireTriple,
          onlyWithTrend:    s.onlyWithTrend,
          pauseOnDrawdown:  Math.round(s.pauseOnDrawdown * 100),
          initBalance:      settingUser.initBalance,
          allowedSymbols:   settingUser.allowedSymbols,
        }}>
          <Divider orientation="left" plain style={{ fontSize: 12 }}>Account</Divider>
          <Form.Item label="Initial Capital" name="initBalance" help="Changing this will prompt for an account reset">
            <InputNumber<number>
              style={{ width: '100%' }}
              min={1000}
              step={10000}
              formatter={v => `$ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={v => Number(v?.replace(/\$\s?|(,*)/g, '') || 0)}
            />
          </Form.Item>
          <Form.Item label="Tradable Symbols" name="allowedSymbols" help="Leave empty to trade all watchlist symbols">
            <Select
              mode="multiple"
              placeholder="Leave empty to trade all watchlist symbols"
              style={{ width: '100%' }}
              allowClear
              options={symbols.map(sym => ({ label: sym, value: sym }))}
            />
          </Form.Item>
          <Divider orientation="left" plain style={{ fontSize: 12 }}>Entry Thresholds</Divider>
          <Form.Item label="Min Buy Score" name="minBuyScore">
            <Slider min={30} max={100} marks={{ 55: '55', 75: '75' }} />
          </Form.Item>
          <Form.Item label="Min Sell Score" name="minSellScore">
            <Slider min={30} max={100} marks={{ 55: '55', 75: '75' }} />
          </Form.Item>
          <Form.Item label="Min Prediction %" name="minPredProb">
            <Slider min={50} max={95} marks={{ 65: '65%', 80: '80%' }} />
          </Form.Item>
          <Divider orientation="left" plain style={{ fontSize: 12 }}>Positioning & Risk</Divider>
          <Form.Item label="Position Size %" name="positionPct">
            <Slider min={5} max={40} marks={{ 10: '10%', 20: '20%' }} />
          </Form.Item>
          <Form.Item label="Stop ATR Multiplier" name="stopMultiplier">
            <Slider min={0.5} max={5} step={0.5} marks={{ 1: '1x', 2: '2x', 3: '3x' }} />
          </Form.Item>
          <Form.Item label="Target ATR Multiplier" name="profitMultiplier">
            <Slider min={1} max={8} step={0.5} marks={{ 2: '2x', 4: '4x' }} />
          </Form.Item>
          <Divider orientation="left" plain style={{ fontSize: 12 }}>Filters</Divider>
          <Form.Item label="Triple Confirmation" name="requireTriple" valuePropName="checked">
            <Switch size="small" />
          </Form.Item>
          <Form.Item label="Trend Only" name="onlyWithTrend" valuePropName="checked">
            <Switch size="small" />
          </Form.Item>
          <Form.Item label="Pause On Drawdown %" name="pauseOnDrawdown">
            <Slider min={5} max={50} marks={{ 10: '10%', 25: '25%' }} />
          </Form.Item>
        </Form>
      </Modal>
    );
  };

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  return (
    <Card style={{ marginTop: embedded ? 0 : 16, border: embedded ? 'none' : undefined, background: embedded ? 'transparent' : undefined }}>
      {/* 头部控制栏 */}
      <Row align="middle" gutter={16} style={{ marginBottom: 16 }}>
        <Col>
          <ThunderboltOutlined style={{ fontSize: 20, marginRight: 8 }} />
          <Title level={4} style={{ margin: 0, display: 'inline' }}>Simulated Traders Arena</Title>
        </Col>
        <Col flex={1} />
        <Col>
          <Space>
            <Text>Seed Capital</Text>
            <InputNumber
              value={resetBal}
              onChange={v => setResetBal(v ?? 50000)}
              formatter={v => `$${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={v => Number(v?.replace(/\$|,/g, ''))}
              style={{ width: 120 }}
              size="small"
            />
            <Button size="small" danger icon={<ReloadOutlined />} onClick={handleResetAll}>
              Reset All
            </Button>
            <Text>Simulation</Text>
            <Switch checked={enabled} onChange={handleEnable} />
          </Space>
        </Col>
      </Row>

      {!enabled && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#7b9586' }}>
          <PauseOutlined style={{ fontSize: 24, marginBottom: 8, display: 'block' }} />
          Turn on simulation and the traders will react to each market update automatically.
        </div>
      )}

      {enabled && (
        <>
          {/* 排行榜 */}
          <Row gutter={[12, 12]}>
            {ranking.map((item, i) => (
              <Col key={item.state.user.id} span={24}>
                <RankCard item={item} rank={i + 1} />
              </Col>
            ))}
          </Row>

          {/* 详情展开 */}
          {selectedState && (
            <>
              <Divider />
              <Row gutter={16} style={{ marginBottom: 12 }}>
                <Col>
                  <Text style={{ fontSize: 16 }}>{selectedState.user.emoji}</Text>
                  <Text strong style={{ marginLeft: 6 }}>{selectedState.user.name} - Details</Text>
                </Col>
                <Col flex={1} />
                <Col>
                  <Space size={4}>
                    {Array.from(selectedState.positions.entries()).map(([sym, pos]) => (
                      <Tag key={sym} color={pos.side === 'long' ? 'green' : 'red'}>
                        {sym} {pos.side === 'long' ? 'Long' : 'Short'} {pos.qty.toFixed(3)} @ ${pos.entryPrice.toFixed(2)}
                      </Tag>
                    ))}
                    {selectedState.positions.size === 0 && <Text type="secondary">No open positions</Text>}
                  </Space>
                </Col>
              </Row>

              {/* 统计指标行 */}
              {selectedState.tradeStats && (
                <Row gutter={12} style={{ marginBottom: 16 }}>
                  {[
                    { label: 'Win Rate', val: `${(selectedState.tradeStats.winRate*100).toFixed(1)}%`, color: selectedState.tradeStats.winRate >= 0.5 ? '#52c41a' : '#ff4d4f' },
                    { label: 'Profit Factor', val: selectedState.tradeStats.profitFactor.toFixed(2), color: undefined },
                    { label: 'Expectancy', val: `$${selectedState.tradeStats.expectancy.toFixed(2)}`, color: selectedState.tradeStats.expectancy >= 0 ? '#52c41a' : '#ff4d4f' },
                    { label: 'Max Drawdown', val: `${(selectedState.tradeStats.maxDrawdown*100).toFixed(1)}%`, color: undefined },
                    { label: 'Sharpe', val: selectedState.tradeStats.sharpeRatio.toFixed(2), color: undefined },
                    { label: 'Stop Losses', val: `${selectedState.tradeStats.byExitReason.stop_loss.count}`, color: '#ff7875' },
                    { label: 'Take Profits', val: `${selectedState.tradeStats.byExitReason.take_profit.count}`, color: '#73d13d' },
                  ].map(m => (
                    <Col key={m.label}>
                      <div style={{ fontSize: 10, color: '#7b9586' }}>{m.label}</div>
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
                    label: `Decision Log (${selectedState.log.length})`,
                    children: (
                      <Table
                        dataSource={selectedState.log}
                        columns={logColumns}
                        rowKey={(r: DecisionLog) => `${r.ts}-${r.symbol}`}
                        rowClassName={() => 'decision-log-entry'}
                        size="small"
                        pagination={{ pageSize: 10, showSizeChanger: false }}
                        scroll={{ x: 400 }}
                      />
                    ),
                  },
                  {
                    key: 'trades',
                    label: `Closed Trades (${selectedState.trades.length})`,
                    children: (
                      <Table
                        dataSource={selectedState.trades}
                        columns={tradeColumns}
                        rowKey={(r: SimTrade) => r.id}
                        size="small"
                        pagination={{ pageSize: 10, showSizeChanger: false }}
                        rowClassName={(r: SimTrade) => r.pnl >= 0 ? '' : ''}
                        scroll={{ x: 400 }}
                      />
                    ),
                  },
                  {
                    key: 'rules',
                    label: 'Strategy Rules',
                    children: (
                      <Row gutter={[16, 8]} style={{ padding: '8px 0' }}>
                        {[
                          ['Min Buy Score', selectedState.user.strategy.minBuyScore === 999 ? 'Disabled' : selectedState.user.strategy.minBuyScore],
                          ['Min Sell Score', selectedState.user.strategy.minSellScore === 999 ? 'Disabled' : selectedState.user.strategy.minSellScore],
                          ['Min Prediction', `${(selectedState.user.strategy.minPredProb * 100).toFixed(0)}%`],
                          ['Position Size', `${(selectedState.user.strategy.positionPct * 100).toFixed(0)}%`],
                          ['Max Concurrent', selectedState.user.strategy.maxConcurrent],
                          ['Stop Multiplier', `${selectedState.user.strategy.stopMultiplier}x ATR`],
                          ['Target Multiplier', `${selectedState.user.strategy.profitMultiplier}x ATR`],
                          ['Max Hold', selectedState.user.strategy.maxHoldPeriods === 0 ? 'Unlimited' : `${selectedState.user.strategy.maxHoldPeriods} cycles`],
                          ['Triple Confirmation', selectedState.user.strategy.requireTriple ? 'Required' : 'Optional'],
                          ['Trend Only', selectedState.user.strategy.onlyWithTrend ? 'Yes' : 'No'],
                          ['Contrarian', selectedState.user.strategy.contrarian ? 'Yes' : 'No'],
                          ['Pause Threshold', `${(selectedState.user.strategy.pauseOnDrawdown * 100).toFixed(0)}%`],
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
          )}
        </>
      )}

      <StrategyModal />
    </Card>
  );
};
