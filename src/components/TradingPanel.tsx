/**
 * TradingPanel.tsx — 模拟账户 + 自动交易控制面板（完整重写）
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Tag, Button, Typography, Row, Col, Statistic,
  Switch, Space, Divider, Select, InputNumber, Modal, message,
  Progress, Tooltip, Badge, Segmented, Slider, Form,
} from 'antd';
import {
  ReloadOutlined, WalletOutlined, ArrowUpOutlined, ArrowDownOutlined,
  TrophyOutlined, ThunderboltOutlined, SettingOutlined, CloseCircleOutlined,
  CheckCircleOutlined, StopOutlined, RocketOutlined,
} from '@ant-design/icons';
import { tradingSimulator, Position, Trade }          from '../services/tradingSimulator';
import { calcTradeStats, TradeStats }                 from '../services/backtestStats';
import { autoTradeService, AutoTradeExecution, AutoTradeConfig } from '../services/autoTradeService';

const { Text, Title } = Typography;

interface TradingPanelProps {
  symbols:   string[];
  prices:    Map<string, number>;
  onRefresh: () => void;
}

const EXIT_REASON_TAG: Record<string, { label: string; color: string }> = {
  signal:      { label: '信號',   color: 'blue'    },
  stop_loss:   { label: '止損',   color: 'red'     },
  take_profit: { label: '止盈',   color: 'green'   },
  manual:      { label: '手動',   color: 'default' },
  timeout:     { label: '超時',   color: 'orange'  },
};

// ─── Config Modal ─────────────────────────────────────────────────────────────

const AutoTradeConfigModal: React.FC<{
  open:    boolean;
  config:  AutoTradeConfig;
  onClose: () => void;
}> = ({ open, config, onClose }) => {
  const [form] = Form.useForm();
  return (
    <Modal
      title={<><SettingOutlined /> 自動交易設置</>}
      open={open} onCancel={onClose}
      onOk={() => {
        const v = form.getFieldsValue();
        autoTradeService.updateConfig({
          minLevel:      v.minLevel,
          usePrediction: v.usePrediction,
          minPredProb:   v.minPredProb / 100,
          positionPct:   v.positionPct / 100,
          cooldownMs:    v.cooldownMin * 60 * 1000,
          exitMode:      v.exitMode,
        });
        message.success('設置已保存');
        onClose();
      }}
      okText="保存" cancelText="取消" width={480}
    >
      <Form form={form} layout="horizontal" labelCol={{ span: 10 }} style={{ marginTop: 16 }}
        initialValues={{
          minLevel:      config.minLevel,
          usePrediction: config.usePrediction,
          minPredProb:   Math.round(config.minPredProb * 100),
          positionPct:   Math.round(config.positionPct * 100),
          cooldownMin:   Math.round(config.cooldownMs / 60000),
          exitMode:      config.exitMode ?? 'v6',
        }}
      >
        <Form.Item label="最低觸發等級" name="minLevel">
          <Segmented options={[
            { label: '僅高級(≥75分)', value: 'high' },
            { label: '中級以上(≥55分)', value: 'medium' },
            { label: '任意信號', value: 'any' },
          ]} />
        </Form.Item>
        <Form.Item label="響應頂底預測" name="usePrediction" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item label="預測最低概率%" name="minPredProb">
          <Slider min={50} max={95} marks={{ 65: '65%', 75: '75%', 85: '85%' }} />
        </Form.Item>
        <Form.Item label="每筆倉位%" name="positionPct" help="佔可用餘額百分比">
          <Slider min={5} max={50} step={5} marks={{ 10: '10%', 20: '20%', 30: '30%' }} />
        </Form.Item>
        <Form.Item label="冷卻時間(分鐘)" name="cooldownMin" help="同一標的兩次買入最短間隔">
          <Slider min={1} max={60} marks={{ 5: '5m', 15: '15m', 30: '30m' }} />
        </Form.Item>
        <Form.Item
          label="出場模式"
          name="exitMode"
          help="V6：持候到止盈目標；V7：1.5R分批止盈＋移動止損至成本"
        >
          <Segmented options={[
            { label: 'V6 全倉持到止盈目標', value: 'v6' },
            { label: 'V7 分批止盈+移動止損', value: 'v7' },
          ]} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ─── Main Panel ───────────────────────────────────────────────────────────────

export const TradingPanel: React.FC<TradingPanelProps> = ({ symbols, prices, onRefresh }) => {
  const [account,          setAccount]          = useState(tradingSimulator.getAccount());
  const [positions,        setPositions]        = useState<Position[]>([]);
  const [trades,           setTrades]           = useState<Trade[]>([]);
  const [tradeStats,       setTradeStats]       = useState<TradeStats | null>(null);
  const [executions,       setExecutions]       = useState<AutoTradeExecution[]>([]);
  const [atConfig,         setAtConfig]         = useState<AutoTradeConfig>(autoTradeService.getConfig());
  const [configOpen,       setConfigOpen]       = useState(false);
  const [selectedSymbol,   setSelectedSymbol]   = useState('');
  const [tradeType,        setTradeType]        = useState<'buy' | 'sell'>('buy');
  const [tradeQuantity,    setTradeQuantity]     = useState<number>(0);
  const [tradeModalVisible,setTradeModalVisible] = useState(false);

  const refresh = useCallback(() => {
    const pm = new Map<string, number>(symbols.map(s => [s, prices.get(s) ?? 0]));
    setAccount(tradingSimulator.getAccount(pm));
    setPositions(tradingSimulator.getPositions());
    const t = tradingSimulator.getTrades();
    setTrades(t);
    setTradeStats(calcTradeStats(t));
    setExecutions(autoTradeService.getExecutions());
    setAtConfig({ ...autoTradeService.getConfig() });
  }, [symbols, prices]);

  useEffect(() => {
    autoTradeService.setOnChange(refresh);
    refresh();
    const id = setInterval(refresh, 2000);
    return () => { clearInterval(id); autoTradeService.setOnChange(() => {}); };
  }, [refresh]);

  const handleReset = async () => {
    await tradingSimulator.reset(100000);
    autoTradeService.clearExecutions();
    refresh();
    message.success('帳戶已重置為 $100,000');
  };

  const handleGlobalToggle = (v: boolean) => {
    autoTradeService.setEnabled(v);
    setAtConfig({ ...autoTradeService.getConfig() });
    message.info(v ? '🟢 自動交易已開啟' : '⏸ 自動交易已暫停');
  };

  const handleSymbolToggle = (sym: string, v: boolean) => {
    autoTradeService.setSymbolEnabled(sym, v);
    setAtConfig({ ...autoTradeService.getConfig() });
  };

  const handleManualTrade = async () => {
    if (!selectedSymbol) return message.warning('請選擇標的');
    if (tradeQuantity <= 0) return message.warning('請輸入數量');
    const price = prices.get(selectedSymbol);
    if (!price) return message.error('無法獲取價格');
    const result = await tradingSimulator.executeTrade(
      { symbol: selectedSymbol, type: tradeType, price, reason: '手動交易', confidence: 100 },
      tradeQuantity, 'manual',
    );
    if (result.success) { message.success(result.message); setTradeModalVisible(false); setTradeQuantity(0); refresh(); }
    else { message.error(result.message); }
  };

  // ── Columns ────────────────────────────────────────────────────────────────

  const positionColumns = [
    { title: '標的',   dataIndex: 'symbol',   key: 'symbol',   width: 70, render: (s: string) => <Tag color="blue">{s}</Tag> },
    { title: '數量',   dataIndex: 'quantity', key: 'quantity', width: 80, render: (v: number) => v.toFixed(4) },
    { title: '均價',   dataIndex: 'avgPrice', key: 'avgPrice', width: 90, render: (v: number) => `$${v.toFixed(2)}` },
    { title: '現價',   key: 'curPrice', render: (_: unknown, r: Position) => {
        const p = prices.get(r.symbol) ?? r.avgPrice;
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
        const p = prices.get(r.symbol) ?? r.avgPrice;
        const pnl = (p - r.avgPrice) * r.quantity;
        const pct = ((p - r.avgPrice) / r.avgPrice) * 100;
        return <Text style={{ color: pnl >= 0 ? '#52c41a' : '#ff4d4f' }}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pct.toFixed(2)}%)</Text>;
    }},
  ];

  const tradeColumns = [
    { title: '時間',   dataIndex: 'date',       key: 'date',       width: 100, render: (t: number) => new Date(t).toLocaleTimeString() },
    { title: '標的',   dataIndex: 'symbol',     key: 'symbol',     width: 70,  render: (s: string) => <Tag style={{ margin: 0 }}>{s}</Tag> },
    { title: '方向',   dataIndex: 'side',       key: 'side',       width: 60,  render: (s: string) => <Tag color={s === 'buy' ? 'green' : 'red'} style={{ margin: 0 }}>{s === 'buy' ? '買入' : '賣出'}</Tag> },
    { title: '數量',   dataIndex: 'quantity',   key: 'quantity',   width: 80,  render: (v: number) => v.toFixed(4) },
    { title: '均價',   dataIndex: 'price',      key: 'price',      width: 90,  render: (v: number) => `$${v.toFixed(2)}` },
    { title: '退出',   dataIndex: 'exitReason', key: 'exitReason', width: 60,  render: (r: string | undefined) => {
        const { label, color } = EXIT_REASON_TAG[r ?? 'signal'] ?? { label: r, color: 'default' };
        return <Tag color={color} style={{ margin: 0, fontSize: 11 }}>{label}</Tag>;
    }},
    { title: '盈虧',   dataIndex: 'pnl',        key: 'pnl',        width: 100, render: (p: number | undefined) => {
        if (p == null) return <Text type="secondary">-</Text>;
        return <Text style={{ color: p >= 0 ? '#52c41a' : '#ff4d4f' }}>{p >= 0 ? '+' : ''}${p.toFixed(2)}</Text>;
    }},
  ];

  const executionColumns = [
    { title: '時間',     dataIndex: 'ts',     key: 'ts',     width: 90, render: (t: number) => new Date(t).toLocaleTimeString() },
    { title: '標的',     dataIndex: 'symbol', key: 'symbol', width: 70, render: (s: string) => <Tag style={{ margin: 0 }}>{s}</Tag> },
    { title: '動作',     key: 'action', render: (_: unknown, r: AutoTradeExecution) => (
        <Space size={4}>
          <Tag color={r.action === 'buy' ? 'green' : 'red'} style={{ margin: 0 }}>{r.action === 'buy' ? '買入' : '賣出'}</Tag>
          {r.result === 'success' && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
          {r.result === 'failed'  && <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
          {r.result === 'skipped' && <StopOutlined        style={{ color: '#faad14' }} />}
        </Space>
    )},
    { title: '價格', dataIndex: 'price', key: 'price', width: 90, render: (p: number) => `$${p.toFixed(2)}` },
    { title: '分數', dataIndex: 'score', key: 'score', width: 55, render: (s: number) => <Tag style={{ margin: 0, fontSize: 11 }}>{s}</Tag> },
    { title: '原因 / 結果', key: 'info', ellipsis: true, render: (_: unknown, r: AutoTradeExecution) => (
        <Tooltip title={r.reason}>
          <Text style={{ fontSize: 11, color: r.result === 'failed' ? '#ff4d4f' : r.result === 'skipped' ? '#faad14' : undefined }}>
            {r.result === 'success' ? r.reason : r.message}
          </Text>
        </Tooltip>
    )},
  ];

  const globalOn      = atConfig.enabled;
  const pnlColor      = account.totalPnL >= 0 ? '#52c41a' : '#ff4d4f';
  const successExec   = executions.filter(e => e.result === 'success').length;
  const totalValue    = account.totalValue;

  return (
    <Card style={{ marginTop: 16 }}>
      {/* Header */}
      <Row align="middle" gutter={16} style={{ marginBottom: 12 }}>
        <Col><WalletOutlined style={{ fontSize: 22 }} /></Col>
        <Col><Title level={4} style={{ margin: 0 }}>模擬帳戶 & 自動交易</Title></Col>
        <Col flex={1} />
        <Col>
          <Space>
            <Button size="small" danger icon={<ReloadOutlined />} onClick={handleReset}>重置帳戶</Button>
            <Button size="small" icon={<SettingOutlined />} onClick={() => setConfigOpen(true)}>交易參數</Button>
          </Space>
        </Col>
      </Row>

      {/* Account Stats */}
      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        {[
          { t: '可用餘額',   v: account.balance,           p: '$',  c: undefined },
          { t: '持倉市值',   v: totalValue - account.balance, p: '$', c: undefined },
          { t: '總資產',     v: totalValue,                 p: '$',  c: undefined },
          { t: '總盈虧',     v: Math.abs(account.totalPnL), p: account.totalPnL >= 0 ? '+$' : '-$', c: pnlColor },
          { t: '收益率',     v: Math.abs(account.totalPnLPercent), p: account.totalPnLPercent >= 0 ? '+' : '-', s: '%', c: pnlColor },
        ].map(m => (
          <Col key={m.t} span={4}>
            <div style={{ background: 'var(--color-background-secondary,#f5f5f5)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, color: '#8b949e' }}>{m.t}</div>
              <div style={{ fontSize: 15, fontWeight: 500, color: m.c }}>
                {m.p}{(m.v ?? 0).toLocaleString('en', { maximumFractionDigits: 2 })}{m.s ?? ''}
              </div>
            </div>
          </Col>
        ))}
        <Col span={4}>
          <div style={{ background: globalOn ? 'rgba(82,196,26,0.1)' : 'var(--color-background-secondary,#f5f5f5)', borderRadius: 8, padding: '8px 12px', border: globalOn ? '1px solid rgba(82,196,26,0.4)' : undefined }}>
            <div style={{ fontSize: 11, color: '#8b949e' }}>自動交易</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <Switch checked={globalOn} onChange={handleGlobalToggle} size="small" />
              <Text style={{ fontSize: 13, color: globalOn ? '#52c41a' : '#8b949e' }}>
                {globalOn ? '運行中' : '已暫停'}
              </Text>
            </div>
          </div>
        </Col>
      </Row>

      {/* Symbol Switches */}
      <div style={{ background: 'var(--color-background-secondary,#f9f9f9)', borderRadius: 8, padding: '10px 16px', marginBottom: 12 }}>
        <Row align="middle" style={{ marginBottom: 8 }}>
          <Col flex={1}>
            <Text strong style={{ fontSize: 13 }}><RocketOutlined style={{ marginRight: 6 }} />自動交易標的</Text>
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>開啟後信號觸發時自動執行買賣</Text>
          </Col>
          <Col>
            <Button size="small" type="link" onClick={() => { autoTradeService.setAllSymbols(symbols, true); setAtConfig({ ...autoTradeService.getConfig() }); }}>全部開</Button>
            <Button size="small" type="link" danger onClick={() => { autoTradeService.setAllSymbols(symbols, false); setAtConfig({ ...autoTradeService.getConfig() }); }}>全部關</Button>
          </Col>
        </Row>
        <Row gutter={[8, 8]}>
          {symbols.length === 0
            ? <Col span={24}><Text type="secondary" style={{ fontSize: 12 }}>請先添加自選股</Text></Col>
            : symbols.map(sym => {
                const symOn = atConfig.symbolsEnabled[sym] ?? false;
                const active = globalOn && symOn;
                return (
                  <Col key={sym} span={4}>
                    <div style={{ border: `1px solid ${active ? 'rgba(82,196,26,0.5)' : 'var(--color-border-tertiary,#e8e8e8)'}`, borderRadius: 8, padding: '6px 10px', background: active ? 'rgba(82,196,26,0.06)' : undefined, transition: 'all 0.2s' }}>
                      <Row align="middle">
                        <Col flex={1}>
                          <Text strong style={{ fontSize: 12 }}>{sym}</Text><br />
                          <Text type="secondary" style={{ fontSize: 11 }}>${prices.get(sym)?.toFixed(2) ?? '-'}</Text>
                        </Col>
                        <Col><Switch size="small" checked={symOn} onChange={v => handleSymbolToggle(sym, v)} /></Col>
                      </Row>
                      {active && <Badge status="processing" text={<Text style={{ fontSize: 10, color: '#52c41a' }}>監控中</Text>} style={{ marginTop: 4, display: 'block' }} />}
                    </div>
                  </Col>
                );
              })
          }
        </Row>
        <div style={{ marginTop: 8, fontSize: 11, color: '#8b949e' }}>
          觸發等級: [{
            ({ high: '僅高級≥75分', medium: '中級以上≥55分', any: '任意信號' } as Record<string,string>)[atConfig.minLevel]
          }] | 每筆倉位: {(atConfig.positionPct * 100).toFixed(0)}% | 頂底預測: {atConfig.usePrediction ? `✓≥${(atConfig.minPredProb * 100).toFixed(0)}%` : '✗'} | 冷卻: {(atConfig.cooldownMs / 60000).toFixed(0)}分鐘
        </div>
      </div>

      {/* Execution Feed */}
      {executions.length > 0 && (
        <>
          <Row align="middle" style={{ marginBottom: 6 }}>
            <Col flex={1}>
              <Text strong style={{ fontSize: 13 }}>
                <ThunderboltOutlined style={{ marginRight: 6 }} />自動交易記錄
                <Tag color="blue" style={{ marginLeft: 8 }}>成功 {successExec}/{executions.length}</Tag>
              </Text>
            </Col>
            <Col><Button size="small" type="text" onClick={() => { autoTradeService.clearExecutions(); refresh(); }}>清空</Button></Col>
          </Row>
          <Table dataSource={executions.slice(0, 10)} columns={executionColumns} rowKey="id" size="small" pagination={false} />
          <Divider style={{ margin: '12px 0' }} />
        </>
      )}

      {/* Performance */}
      {tradeStats && (
        <>
          <Row align="middle" style={{ marginBottom: 8 }}>
            <TrophyOutlined style={{ marginRight: 6 }} />
            <Text strong>績效統計</Text>
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>共 {tradeStats.totalTrades} 筆已完成交易</Text>
          </Row>
          <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
            {[
              { l: '胜率',    v: `${(tradeStats.winRate*100).toFixed(1)}%`,            c: tradeStats.winRate>=0.5?'#52c41a':'#ff4d4f', p: Math.round(tradeStats.winRate*100) },
              { l: '盈亏比',  v: tradeStats.profitFactor.toFixed(2),                   c: tradeStats.profitFactor>=1.5?'#52c41a':'#faad14' },
              { l: '期望值',  v: `${tradeStats.expectancy>=0?'+':''}$${tradeStats.expectancy.toFixed(2)}`, c: tradeStats.expectancy>=0?'#52c41a':'#ff4d4f' },
              { l: '最大回撤',v: `${(tradeStats.maxDrawdown*100).toFixed(1)}%`,         c: tradeStats.maxDrawdown>0.2?'#ff4d4f':'#faad14' },
              { l: 'Sharpe',  v: tradeStats.sharpeRatio.toFixed(2),                    c: tradeStats.sharpeRatio>=1?'#52c41a':'#8b949e' },
              { l: '止损',    v: `${tradeStats.byExitReason.stop_loss.count}次`,        c: '#ff7875' },
              { l: '止盈',    v: `${tradeStats.byExitReason.take_profit.count}次`,      c: '#73d13d' },
            ].map(m => (
              <Col key={m.l} span={3}>
                <div style={{ textAlign: 'center', padding: '6px 4px', background: 'var(--color-background-secondary,#f9f9f9)', borderRadius: 6 }}>
                  <div style={{ fontSize: 10, color: '#8b949e' }}>{m.l}</div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: m.c }}>{m.v}</div>
                  {m.p != null && <Progress percent={m.p} showInfo={false} size="small" strokeColor={m.c} style={{ marginTop: 2 }} />}
                </div>
              </Col>
            ))}
          </Row>
        </>
      )}

      {/* Positions */}
      <Divider orientation="left" style={{ fontSize: 12 }}>持倉 ({positions.length})</Divider>
      <Table dataSource={positions} columns={positionColumns} rowKey="symbol" size="small" pagination={false} locale={{ emptyText: '目前無持倉' }} />

      {/* Manual Trade */}
      <Divider orientation="left" style={{ fontSize: 12 }}>手動交易</Divider>
      <Row gutter={12} align="middle">
        <Col span={6}>
          <Select style={{ width: '100%' }} placeholder="選擇標的" value={selectedSymbol || undefined} onChange={setSelectedSymbol}
            options={symbols.map(s => ({ label: `${s}  $${(prices.get(s)??0).toFixed(2)}`, value: s }))} />
        </Col>
        <Col span={5}>
          <InputNumber style={{ width: '100%' }} placeholder="數量" min={0} value={tradeQuantity || undefined} onChange={v => setTradeQuantity(v ?? 0)} />
        </Col>
        <Col>
          <Space>
            <Button type="primary" icon={<ArrowUpOutlined />} disabled={!selectedSymbol} onClick={() => { setTradeType('buy'); setTradeModalVisible(true); }}>買入</Button>
            <Button danger icon={<ArrowDownOutlined />} disabled={!selectedSymbol} onClick={() => { setTradeType('sell'); setTradeModalVisible(true); }}>賣出</Button>
          </Space>
        </Col>
      </Row>

      {/* Trade History */}
      <Divider orientation="left" style={{ fontSize: 12 }}>交易歷史 ({trades.length})</Divider>
      <Table dataSource={trades.slice(0, 15)} columns={tradeColumns} rowKey="id" size="small" pagination={false} locale={{ emptyText: '無交易記錄' }} scroll={{ x: 600 }} />

      {/* Modals */}
      <Modal title={`確認${tradeType==='buy'?'買入':'賣出'}`} open={tradeModalVisible} onOk={handleManualTrade} onCancel={() => setTradeModalVisible(false)} okText="確認" cancelText="取消">
        <Row gutter={[0, 10]} style={{ marginTop: 8 }}>
          <Col span={24}><Text strong>標的：</Text>{selectedSymbol}</Col>
          <Col span={24}><Text strong>現價：</Text>${(prices.get(selectedSymbol)??0).toFixed(2)}</Col>
          <Col span={24}><Text strong>數量：</Text>{tradeQuantity}</Col>
          <Col span={24}><Text strong>預估金額：</Text>${((prices.get(selectedSymbol)??0)*tradeQuantity).toFixed(2)}</Col>
        </Row>
      </Modal>
      <AutoTradeConfigModal open={configOpen} config={atConfig} onClose={() => setConfigOpen(false)} />
    </Card>
  );
};
