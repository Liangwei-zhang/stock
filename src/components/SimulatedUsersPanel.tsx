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
  hold:            '#8b949e',
  skip:            '#595959',
  close_sl:        '#ff7875',
  close_tp:        '#73d13d',
  close_timeout:   '#ffa940',
  paused:          '#faad14',
};
const ACTION_LABEL: Record<string, string> = {
  buy:           '買入',
  sell:          '做空',
  hold:          '持倉',
  skip:          '觀望',
  close_sl:      '止損',
  close_tp:      '止盈',
  close_timeout: '超時',
  paused:        '暫停',
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

  // ── 排行榜卡片 ─────────────────────────────────────────────────────────────
  const RankCard = ({ item, rank }: { item: typeof ranking[0]; rank: number }) => {
    const { state, totalValue, pnlPct } = item;
    const { user } = state;
    const isPos = pnlPct >= 0;
    const winRate = state.tradeStats?.winRate ?? null;
    const trades  = state.trades.length;

    return (
      <Card
        size="small"
        style={{
          cursor: 'pointer',
          border: activeUser === user.id ? '1.5px solid #1890ff' : '0.5px solid var(--color-border-tertiary, #e8e8e8)',
          transition: 'all 0.2s',
          background: activeUser === user.id ? 'rgba(24,144,255,0.06)' : undefined,
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
                {state.paused && <Tag color="orange" style={{ marginLeft: 4, fontSize: 10 }}>暫停</Tag>}
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
              <Text type="secondary" style={{ fontSize: 10 }}>交易所有標的</Text>
            )}
          </Col>
          <Col style={{ textAlign: 'right', minWidth: 100 }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: isPos ? '#52c41a' : '#ff4d4f' }}>
              {isPos ? '+' : ''}{pnlPct.toFixed(2)}%
            </div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              ${totalValue.toFixed(0)} | {trades} 筆
              {winRate !== null && ` | 勝${(winRate*100).toFixed(0)}%`}
            </Text>
          </Col>
          <Col>
            <Tooltip title="設置策略">
              <Button
                size="small"
                type="text"
                icon={<SettingOutlined />}
                onClick={e => { e.stopPropagation(); setSettingUser(state); }}
              />
            </Tooltip>
            <Tooltip title="重置此用戶">
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
            { label: '持倉', val: state.positions.size, color: state.positions.size > 0 ? '#1890ff' : '#8b949e' },
            { label: '盈虧比', val: state.tradeStats ? state.tradeStats.profitFactor.toFixed(1) : '-', color: undefined },
            { label: '最大回撤', val: state.tradeStats ? `${(state.tradeStats.maxDrawdown*100).toFixed(1)}%` : '-', color: undefined },
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
      title: '時間', dataIndex: 'ts', key: 'ts', width: 80,
      render: (t: number) => new Date(t).toLocaleTimeString(),
    },
    {
      title: '標的', dataIndex: 'symbol', key: 'symbol', width: 70,
      render: (s: string) => <Tag style={{ margin: 0 }}>{s}</Tag>,
    },
    {
      title: '動作', dataIndex: 'action', key: 'action', width: 60,
      render: (a: string) => (
        <Tag color={ACTION_COLOR[a]} style={{ margin: 0, fontSize: 11 }}>
          {ACTION_LABEL[a] ?? a}
        </Tag>
      ),
    },
    {
      title: '價格', dataIndex: 'price', key: 'price', width: 80,
      render: (p: number) => `$${p.toFixed(2)}`,
    },
    { title: '原因', dataIndex: 'reason', key: 'reason', ellipsis: true },
  ];

  const tradeColumns = [
    {
      title: '時間', dataIndex: 'exitAt', key: 'exitAt', width: 80,
      render: (t: number) => new Date(t).toLocaleTimeString(),
    },
    {
      title: '標的', dataIndex: 'symbol', key: 'symbol', width: 65,
      render: (s: string) => <Tag style={{ margin: 0 }}>{s}</Tag>,
    },
    {
      title: '方向', dataIndex: 'side', key: 'side', width: 55,
      render: (s: string) => (
        <Tag color={s === 'buy' ? 'green' : 'red'} style={{ margin: 0, fontSize: 11 }}>
          {s === 'buy' ? '多' : '空'}
        </Tag>
      ),
    },
    {
      title: '退出', dataIndex: 'exitReason', key: 'exitReason', width: 55,
      render: (r: string) => {
        const map: Record<string, [string, string]> = {
          signal:      ['信號', 'blue'],
          stop_loss:   ['止損', 'red'],
          take_profit: ['止盈', 'green'],
          timeout:     ['超時', 'orange'],
        };
        const [label, color] = map[r] ?? [r, 'default'];
        return <Tag color={color} style={{ margin: 0, fontSize: 11 }}>{label}</Tag>;
      },
    },
    {
      title: '盈虧', dataIndex: 'pnl', key: 'pnl', width: 90,
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
        title={`${settingUser.user.emoji} ${settingUser.user.name} — 設置`}
        open={!!settingUser}
        onCancel={() => setSettingUser(null)}
        width={560}
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
              title: '重置账户确认',
              content: `将把 ${settingUser.user.name} 的初始资金改为 $${newBal.toLocaleString()}，账户将被重置（持仓和交易记录清空）。确认吗？`,
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
          <Divider orientation="left" plain style={{ fontSize: 12 }}>賬戶設置</Divider>
          <Form.Item label="初始資金" name="initBalance" help="修改後點確定會提示重置賬戶">
            <InputNumber
              style={{ width: '100%' }}
              min={1000}
              step={10000}
              formatter={v => `$ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={v => Number(v?.replace(/\$\s?|(,*)/g, '') || 0)}
            />
          </Form.Item>
          <Form.Item label="自動交易標的" name="allowedSymbols" help="留空 = 所有自選股">
            <Select
              mode="multiple"
              placeholder="留空 = 交易所有自選股標的"
              style={{ width: '100%' }}
              allowClear
              options={symbols.map(sym => ({ label: sym, value: sym }))}
            />
          </Form.Item>
          <Divider orientation="left" plain style={{ fontSize: 12 }}>入場閾值</Divider>
          <Form.Item label="買入最低分" name="minBuyScore">
            <Slider min={30} max={100} marks={{ 55: '55', 75: '75' }} />
          </Form.Item>
          <Form.Item label="賣出最低分" name="minSellScore">
            <Slider min={30} max={100} marks={{ 55: '55', 75: '75' }} />
          </Form.Item>
          <Form.Item label="預測最低概率%" name="minPredProb">
            <Slider min={50} max={95} marks={{ 65: '65%', 80: '80%' }} />
          </Form.Item>
          <Divider orientation="left" plain style={{ fontSize: 12 }}>倉位 & 止損</Divider>
          <Form.Item label="每筆倉位%" name="positionPct">
            <Slider min={5} max={40} marks={{ 10: '10%', 20: '20%' }} />
          </Form.Item>
          <Form.Item label="止損 ATR 倍數" name="stopMultiplier">
            <Slider min={0.5} max={5} step={0.5} marks={{ 1: '1x', 2: '2x', 3: '3x' }} />
          </Form.Item>
          <Form.Item label="止盈 ATR 倍數" name="profitMultiplier">
            <Slider min={1} max={8} step={0.5} marks={{ 2: '2x', 4: '4x' }} />
          </Form.Item>
          <Divider orientation="left" plain style={{ fontSize: 12 }}>過濾條件</Divider>
          <Form.Item label="三重確認" name="requireTriple" valuePropName="checked">
            <Switch size="small" />
          </Form.Item>
          <Form.Item label="順趨勢交易" name="onlyWithTrend" valuePropName="checked">
            <Switch size="small" />
          </Form.Item>
          <Form.Item label="最大回撤暫停%" name="pauseOnDrawdown">
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
          <Title level={4} style={{ margin: 0, display: 'inline' }}>模拟用户竞技场</Title>
        </Col>
        <Col flex={1} />
        <Col>
          <Space>
            <Text>初始資金</Text>
            <InputNumber
              value={resetBal}
              onChange={v => setResetBal(v ?? 50000)}
              formatter={v => `$${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={v => Number(v?.replace(/\$|,/g, ''))}
              style={{ width: 120 }}
              size="small"
            />
            <Button size="small" danger icon={<ReloadOutlined />} onClick={handleResetAll}>
              重置全部
            </Button>
            <Text>模擬開關</Text>
            <Switch checked={enabled} onChange={handleEnable} />
          </Space>
        </Col>
      </Row>

      {!enabled && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#8b949e' }}>
          <PauseOutlined style={{ fontSize: 24, marginBottom: 8, display: 'block' }} />
          開啟模擬開關後，模擬用戶將在每次市場信號更新時自動交易
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
                  <Text strong style={{ marginLeft: 6 }}>{selectedState.user.name} — 詳細面板</Text>
                </Col>
                <Col flex={1} />
                <Col>
                  <Space size={4}>
                    {Array.from(selectedState.positions.entries()).map(([sym, pos]) => (
                      <Tag key={sym} color={pos.side === 'long' ? 'green' : 'red'}>
                        {sym} {pos.side === 'long' ? '多' : '空'} {pos.qty.toFixed(3)} @ ${pos.entryPrice.toFixed(2)}
                      </Tag>
                    ))}
                    {selectedState.positions.size === 0 && <Text type="secondary">無持倉</Text>}
                  </Space>
                </Col>
              </Row>

              {/* 统计指标行 */}
              {selectedState.tradeStats && (
                <Row gutter={12} style={{ marginBottom: 16 }}>
                  {[
                    { label: '胜率', val: `${(selectedState.tradeStats.winRate*100).toFixed(1)}%`, color: selectedState.tradeStats.winRate >= 0.5 ? '#52c41a' : '#ff4d4f' },
                    { label: '盈虧比', val: selectedState.tradeStats.profitFactor.toFixed(2), color: undefined },
                    { label: '期望值', val: `$${selectedState.tradeStats.expectancy.toFixed(2)}`, color: selectedState.tradeStats.expectancy >= 0 ? '#52c41a' : '#ff4d4f' },
                    { label: '最大回撤', val: `${(selectedState.tradeStats.maxDrawdown*100).toFixed(1)}%`, color: undefined },
                    { label: 'Sharpe', val: selectedState.tradeStats.sharpeRatio.toFixed(2), color: undefined },
                    { label: '止損次數', val: `${selectedState.tradeStats.byExitReason.stop_loss.count}`, color: '#ff7875' },
                    { label: '止盈次數', val: `${selectedState.tradeStats.byExitReason.take_profit.count}`, color: '#73d13d' },
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
                    label: `決策日誌 (${selectedState.log.length})`,
                    children: (
                      <Table
                        dataSource={selectedState.log}
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
                    label: `已完成交易 (${selectedState.trades.length})`,
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
                    label: '策略規則',
                    children: (
                      <Row gutter={[16, 8]} style={{ padding: '8px 0' }}>
                        {[
                          ['買入最低分', selectedState.user.strategy.minBuyScore === 999 ? '不交易' : selectedState.user.strategy.minBuyScore],
                          ['賣出最低分', selectedState.user.strategy.minSellScore === 999 ? '不交易' : selectedState.user.strategy.minSellScore],
                          ['預測最低概率', `${(selectedState.user.strategy.minPredProb * 100).toFixed(0)}%`],
                          ['每筆倉位', `${(selectedState.user.strategy.positionPct * 100).toFixed(0)}%`],
                          ['最大持倉數', selectedState.user.strategy.maxConcurrent],
                          ['止損倍數', `${selectedState.user.strategy.stopMultiplier}x ATR`],
                          ['止盈倍數', `${selectedState.user.strategy.profitMultiplier}x ATR`],
                          ['最大持倉期', selectedState.user.strategy.maxHoldPeriods === 0 ? '無限制' : `${selectedState.user.strategy.maxHoldPeriods} 個周期`],
                          ['三重確認', selectedState.user.strategy.requireTriple ? '✅ 必須' : '❌ 不需'],
                          ['順趨勢', selectedState.user.strategy.onlyWithTrend ? '✅ 是' : '❌ 否'],
                          ['逆向交易', selectedState.user.strategy.contrarian ? '✅ 是' : '❌ 否'],
                          ['回撤暫停線', `${(selectedState.user.strategy.pauseOnDrawdown * 100).toFixed(0)}%`],
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
