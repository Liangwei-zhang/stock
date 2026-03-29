import React, { useState } from 'react';
import { Typography, Tag, Button, Table, Row, Col, Select, Space, App, Modal, Form, Switch, Slider, Segmented } from 'antd';
import { ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { EXIT_MODE_LABELS } from '../services/autoTradeService';
import { autoTradeService }  from '../services/autoTradeService';
import { tradingSimulator }  from '../services/tradingSimulator';
import { calcTradeStats }    from '../services/backtestStats';
import { SimulatedUsersPanel } from './SimulatedUsersPanel';
import { StockData, WatchlistItem } from '../types';

const { Text } = Typography;

type TabKey = 'autotrade' | 'positions' | 'history' | 'performance' | 'bots';

const fmtPrice = (p: number) =>
  p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p >= 0.01 ? p.toFixed(6) : p.toFixed(8);
const fmtPnl = (n: number) => `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`;
const fmtTime = (ts: number) =>
  new Date(ts).toLocaleString('en-US', {
    timeZone: 'America/Edmonton',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });

interface Props {
  stocks:         { stock: StockData }[];
  watchlistItems: WatchlistItem[];
  refreshKey:     number;
  onRefresh:      () => void;
}

export const TradingSection: React.FC<Props> = ({ stocks, watchlistItems, refreshKey: _, onRefresh }) => {
  const [activeTab,   setActiveTab]   = useState<TabKey>('autotrade');
  const [settingOpen, setSettingOpen] = useState(false);
  const { message } = App.useApp();

  const atCfg       = autoTradeService.getConfig();
  const priceMap    = new Map(stocks.map(s => [s.stock.symbol, s.stock.price]));
  const simAccount  = tradingSimulator.getAccount(priceMap);
  const simPositions = tradingSimulator.getPositions();
  const simTrades   = tradingSimulator.getTrades();
  const simStats    = calcTradeStats ? calcTradeStats(simTrades) : null;
  const executions  = autoTradeService.getExecutions();

  const tabs: { key: TabKey; label: string; badge?: number; green?: boolean }[] = [
    { key: 'autotrade',   label: 'Auto Trade', badge: executions.filter(e => e.result === 'success').length, green: true },
    { key: 'positions',   label: 'Positions',  badge: simPositions.length },
    { key: 'history',     label: 'History' },
    { key: 'performance', label: 'Performance' },
    { key: 'bots',        label: 'Sim Users' },
  ];

  return (
    <div className="trading-section">

      {/* ── Account stats bar ─────────────────────────────────────────── */}
      <div className="account-stats-bar">
        {[
          { l: 'Cash',          v: `$${simAccount.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,    c: 'white' },
          { l: 'Equity',        v: `$${simAccount.totalValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, c: 'white' },
          { l: 'Total PnL',     v: fmtPnl(simAccount.totalPnL),                                                          c: simAccount.totalPnL >= 0 ? 'pos' : 'neg' },
          { l: 'Return',        v: `${simAccount.totalPnLPercent >= 0 ? '+' : ''}${simAccount.totalPnLPercent.toFixed(2)}%`, c: simAccount.totalPnLPercent >= 0 ? 'pos' : 'neg' },
          { l: 'Open Positions',v: `${simPositions.length}`,                                                              c: 'white' },
          { l: 'Auto Fills',    v: `${executions.filter(e => e.result === 'success').length} fills`,                     c: 'white' },
        ].map(m => (
          <div key={m.l} className="stat-item">
            <div className="stat-label">{m.l}</div>
            <div className={`stat-value ${m.c}`}>{m.v}</div>
          </div>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <Button size="small" danger icon={<ReloadOutlined/>} onClick={async () => {
            await tradingSimulator.reset(100000);
            autoTradeService.clearExecutions();
            onRefresh();
            message.success('Account reset');
          }}>Reset Account</Button>
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────── */}
      <div className="trading-tab-bar">
        {tabs.map(tab => (
          <div key={tab.key}
            className={`trading-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {(tab.badge ?? 0) > 0 && (
              <span className={`trading-tab-badge ${tab.green ? 'green' : ''}`}>{tab.badge}</span>
            )}
          </div>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      <div className="trading-tab-content">

        {/* ── Auto trade settings modal ───────────────────────────────── */}
        <AutoTradeSettingModal
          open={settingOpen}
          onClose={() => { setSettingOpen(false); onRefresh(); }}
        />

        {/* Auto Trade */}
        {activeTab === 'autotrade' && (
          <div>
            <Row gutter={16} align="middle" style={{ marginBottom: 12 }}>
              <Col>
                <Text strong style={{ fontSize: 13 }}>Global Controls</Text>
                <Text style={{ fontSize: 11, color: '#7b9586', marginLeft: 8 }}>
                  Level:[{({ high: 'Advanced >=75', medium: 'Standard >=55', any: 'Any' } as Record<string, string>)[atCfg.minLevel]}]&nbsp;
                  Size:{(atCfg.positionPct * 100).toFixed(0)}%&nbsp;
                  Cooldown:{(atCfg.cooldownMs / 60000).toFixed(0)}m
                </Text>
              </Col>
              <Col>
                <Tag
                  color={({ v1:'default', v2:'green', v3:'lime', v4:'green', v5:'green', v6:'green', v7:'lime' } as Record<string,string>)[atCfg.exitMode] ?? 'default'}
                  style={{ cursor: 'pointer', fontSize: 11 }}
                  onClick={() => setSettingOpen(true)}
                >
                  🎯 {EXIT_MODE_LABELS[atCfg.exitMode as keyof typeof EXIT_MODE_LABELS] ?? atCfg.exitMode}
                </Tag>
              </Col>
              <Col flex={1}/>
              <Col>
                <Space size={6}>
                  <Button size="small" icon={<SettingOutlined />} onClick={() => setSettingOpen(true)}>Exit Rules</Button>
                  <Button size="small" onClick={() => { autoTradeService.setAllSymbols(watchlistItems.map(w => w.symbol), true); onRefresh(); }}>Enable All</Button>
                  <Button size="small" danger onClick={() => { autoTradeService.setAllSymbols(watchlistItems.map(w => w.symbol), false); onRefresh(); }}>Disable All</Button>
                  {executions.length > 0 && <Button size="small" onClick={() => { autoTradeService.clearExecutions(); onRefresh(); }}>Clear Log</Button>}
                </Space>
              </Col>
            </Row>

            <div className="at-symbol-grid" style={{ marginBottom: 12 }}>
              {watchlistItems.map(w => {
                const on = atCfg.symbolsEnabled[w.symbol] ?? false;
                return (
                  <div key={w.symbol}
                    className={`at-symbol-chip ${atCfg.enabled && on ? 'active' : ''}`}
                    onClick={() => { autoTradeService.setSymbolEnabled(w.symbol, !on); onRefresh(); }}
                  >
                    <span className="chip-dot"/>
                    {w.symbol}
                    <span style={{ fontSize: 10, color: '#7b9586' }}>
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
                    <Tag color={e.action === 'buy' ? 'green' : 'red'} style={{ margin: 0, fontSize: 10 }}>{e.action === 'buy' ? 'Buy' : 'Sell'}</Tag>
                    <span className="exec-sym">{e.symbol}</span>
                    <span className="exec-price">${fmtPrice(e.price)}</span>
                    <Tag style={{ margin: 0, fontSize: 10 }}>{e.score}</Tag>
                    <span className="exec-reason">{e.result === 'success' ? e.reason : e.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#7b9586', fontSize: 12 }}>
                Enable symbols to show execution activity here when signals fire.
              </div>
            )}
          </div>
        )}

        {/* Positions */}
        {activeTab === 'positions' && (
          <div>
            <Row gutter={10} align="middle" style={{ marginBottom: 12 }}>
              <Col span={5}>
                <Select<string> size="small" style={{ width: '100%' }} placeholder="Select symbol" value={undefined}
                  options={watchlistItems.map(w => ({
                    label: `${w.symbol} $${fmtPrice(stocks.find(s => s.stock.symbol === w.symbol)?.stock.price ?? 0)}`,
                    value: w.symbol,
                  }))}
                  onChange={async (sym) => {
                    if (!sym) return;
                    const price = stocks.find(s => s.stock.symbol === sym)?.stock.price ?? 0;
                    if (!price) return message.error('Price unavailable');
                    const res = await tradingSimulator.executeTrade({ symbol: sym, type: 'buy', price, reason: 'Manual buy', confidence: 100 }, 0, 'manual');
                    if (res.success) { message.success(res.message); onRefresh(); } else message.error(res.message);
                  }}
                />
              </Col>
              <Col><Text style={{ fontSize: 11, color: '#7b9586' }}>Quick buy (10% size)</Text></Col>
              <Col flex={1}/>
              {simPositions.length > 0 && (
                <Col><Text style={{ fontSize: 11, color: '#7b9586' }}>{simPositions.length} open positions</Text></Col>
              )}
            </Row>
            <Table
              className="compact-table"
              dataSource={simPositions}
              rowKey="symbol"
              size="small"
              pagination={false}
              locale={{ emptyText: 'No positions' }}
              columns={[
                { title: 'Symbol',   dataIndex: 'symbol',   width: 80,  render: (s: string) => <Tag color="green" style={{ margin: 0 }}>{s}</Tag> },
                { title: 'Shares',   dataIndex: 'quantity', width: 90,  render: (v: number) => v.toFixed(4) },
                { title: 'Avg Cost', dataIndex: 'avgPrice', width: 90,  render: (v: number) => `$${fmtPrice(v)}` },
                { title: 'Last', key: 'cur', render: (_: unknown, r: any) => {
                  const p   = stocks.find(s => s.stock.symbol === r.symbol)?.stock.price ?? r.avgPrice;
                  const chg = ((p - r.avgPrice) / r.avgPrice) * 100;
                  return <span>${fmtPrice(p)} <span style={{ fontSize: 10, color: chg >= 0 ? '#3fb950' : '#f85149' }}>({chg >= 0 ? '+' : ''}{chg.toFixed(2)}%)</span></span>;
                }},
                { title: 'SL / TP', key: 'sltp', render: (_: unknown, r: any) => (
                  <Space size={3}>
                    <Tag color="red"   style={{ margin: 0, fontSize: 10 }}>SL${fmtPrice(r.stopLoss ?? 0)}</Tag>
                    <Tag color="green" style={{ margin: 0, fontSize: 10 }}>TP${fmtPrice(r.takeProfit ?? 0)}</Tag>
                  </Space>
                )},
                { title: 'Unrealized PnL', key: 'pnl', render: (_: unknown, r: any) => {
                  const p    = stocks.find(s => s.stock.symbol === r.symbol)?.stock.price ?? r.avgPrice;
                  const pnl  = (p - r.avgPrice) * r.quantity;
                  const pct  = ((p - r.avgPrice) / r.avgPrice) * 100;
                  const barW = Math.min(Math.abs(pct) * 4, 100);
                  return (
                    <div>
                      <Text style={{ color: pnl >= 0 ? '#4ade80' : '#f85149', fontSize: 12 }}>{fmtPnl(pnl)}</Text>
                      <div
                        className={`position-profit-bar${pnl < 0 ? ' negative' : ''}`}
                        style={{ width: `${barW}%` }}
                      />
                    </div>
                  );
                }},
                { title: 'Action', key: 'act', width: 70, render: (_: unknown, r: any) => (
                  <Button size="small" danger onClick={async () => {
                    const price = stocks.find(s => s.stock.symbol === r.symbol)?.stock.price ?? r.avgPrice;
                    const res   = await tradingSimulator.executeTrade({ symbol: r.symbol, type: 'sell', price, reason: 'Manual sell', confidence: 100 }, r.quantity, 'manual');
                    if (res.success) { message.success(res.message); onRefresh(); } else message.error(res.message);
                  }}>Close</Button>
                )},
              ]}
            />
          </div>
        )}

        {/* History */}
        {activeTab === 'history' && (
          <Table
            className="compact-table"
            dataSource={simTrades.slice(0, 20)}
            rowKey="id"
            size="small"
            pagination={false}
            locale={{ emptyText: 'No trade history' }}
            columns={[
              { title: 'Time',   dataIndex: 'date',       width: 90, render: (t: number) => fmtTime(t) },
              { title: 'Symbol', dataIndex: 'symbol',     width: 70, render: (s: string) => <Tag style={{ margin: 0 }}>{s}</Tag> },
              { title: 'Side',   dataIndex: 'side',       width: 60, render: (s: string) => <Tag color={s === 'buy' ? 'green' : 'red'} style={{ margin: 0 }}>{s === 'buy' ? 'Buy' : 'Sell'}</Tag> },
              { title: 'Shares', dataIndex: 'quantity',   width: 80, render: (v: number) => v.toFixed(4) },
              { title: 'Price',  dataIndex: 'price',      width: 90, render: (v: number) => `$${fmtPrice(v)}` },
              { title: 'Exit',   dataIndex: 'exitReason', width: 55, render: (r: string | undefined) => {
                const m: Record<string, [string, string]> = { signal: ['Signal', 'green'], stop_loss: ['Stop Loss', 'red'], take_profit: ['Take Profit', 'green'], manual: ['Manual', 'default'] };
                const [l, c] = m[r ?? 'signal'] ?? [r, 'default'];
                return <Tag color={c} style={{ margin: 0, fontSize: 10 }}>{l}</Tag>;
              }},
              { title: 'PnL',    dataIndex: 'pnl', width: 90, render: (p: number | undefined) =>
                p == null
                  ? <Text type="secondary">—</Text>
                  : <Text style={{ color: p >= 0 ? '#3fb950' : '#f85149', fontSize: 12 }}>{fmtPnl(p)}</Text>
              },
            ]}
          />
        )}

        {/* Performance */}
        {activeTab === 'performance' && (
          simStats ? (
            <div>
              <div className="perf-grid">
                {[
                  { l: 'Win Rate',    v: `${(simStats.winRate * 100).toFixed(1)}%`,            c: simStats.winRate >= 0.5 ? '#3fb950' : '#f85149' },
                  { l: 'Profit Factor', v: simStats.profitFactor.toFixed(2),                   c: simStats.profitFactor >= 1.5 ? '#3fb950' : '#d29922' },
                  { l: 'Expectancy',  v: fmtPnl(simStats.expectancy),                           c: simStats.expectancy >= 0 ? '#3fb950' : '#f85149' },
                  { l: 'Max Drawdown', v: `${(simStats.maxDrawdown * 100).toFixed(1)}%`,       c: simStats.maxDrawdown > 0.2 ? '#f85149' : '#d29922' },
                  { l: 'Sharpe', v: simStats.sharpeRatio.toFixed(2),                       c: simStats.sharpeRatio >= 1 ? '#3fb950' : '#7b9586' },
                  { l: 'Stop Losses', v: `${simStats.byExitReason.stop_loss.count}`,          c: '#f85149' },
                  { l: 'Take Profits', v: `${simStats.byExitReason.take_profit.count}`,       c: '#3fb950' },
                ].map(m => (
                  <div key={m.l} className="perf-cell">
                    <div className="perf-cell-label">{m.l}</div>
                    <div className="perf-cell-value" style={{ color: m.c }}>{m.v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(103, 201, 138, 0.08)', border: '1px solid rgba(93, 187, 123, 0.14)', borderRadius: 12, fontSize: 12, color: '#5f7a6a' }}>
                {simStats.totalTrades} trades · {simStats.winningTrades} wins · {simStats.losingTrades} losses · total PnL {fmtPnl(simStats.totalPnL)}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '30px', color: '#7b9586', fontSize: 12 }}>Performance metrics appear here after completed trades.</div>
          )
        )}

        {/* Bots */}
        {activeTab === 'bots' && (
          <SimulatedUsersPanel
            prices={new Map(stocks.map(s => [s.stock.symbol, s.stock.price]))}
            symbols={watchlistItems.map(w => w.symbol)}
            embedded
          />
        )}

      </div>
    </div>
  );
};

// ─── Auto trade settings modal ───────────────────────────────────────────────

const AutoTradeSettingModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const cfg = autoTradeService.getConfig();

  return (
    <Modal
      title={<><SettingOutlined /> Auto Trade Settings</>}
      open={open}
      onCancel={onClose}
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
        message.success('Settings saved');
        onClose();
      }}
      okText="Save" cancelText="Cancel" width={480}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ span: 10 }}
        style={{ marginTop: 16 }}
        initialValues={{
          minLevel:      cfg.minLevel,
          usePrediction: cfg.usePrediction,
          minPredProb:   Math.round(cfg.minPredProb * 100),
          positionPct:   Math.round(cfg.positionPct * 100),
          cooldownMin:   Math.round(cfg.cooldownMs / 60000),
          exitMode:      cfg.exitMode ?? 'v6',
        }}
      >
        <Form.Item
          label="Exit Profile"
          name="exitMode"
          help="V1-V5 use direct entries. V6/V7 require triple confirmation before entry."
        >
          <Select options={(Object.entries(EXIT_MODE_LABELS) as [string, string][]).map(([v, l]) => ({ value: v, label: l }))} />
        </Form.Item>
        <Form.Item label="Minimum Signal Level" name="minLevel">
          <Segmented options={[
            { label: 'Advanced (>=75)', value: 'high' },
            { label: 'Standard (>=55)', value: 'medium' },
            { label: 'Any Signal',      value: 'any'    },
          ]} />
        </Form.Item>
        <Form.Item label="Use Top/Bottom Prediction" name="usePrediction" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item label="Minimum Prediction %" name="minPredProb">
          <Slider min={50} max={95} marks={{ 65: '65%', 75: '75%', 85: '85%' }} />
        </Form.Item>
        <Form.Item label="Position Size %" name="positionPct" help="Share of available cash per trade">
          <Slider min={5} max={50} step={5} marks={{ 10: '10%', 20: '20%', 30: '30%' }} />
        </Form.Item>
        <Form.Item label="Cooldown (min)" name="cooldownMin" help="Minimum gap between two buys for the same symbol">
          <Slider min={1} max={60} marks={{ 5: '5m', 15: '15m', 30: '30m' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};
