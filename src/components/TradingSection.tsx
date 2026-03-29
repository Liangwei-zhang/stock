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
  new Date(ts).toLocaleString('zh-TW', {
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
    { key: 'autotrade',   label: '自動交易', badge: executions.filter(e => e.result === 'success').length, green: true },
    { key: 'positions',   label: '持倉', badge: simPositions.length },
    { key: 'history',     label: '歷史' },
    { key: 'performance', label: '績效' },
    { key: 'bots',        label: '模擬交易員' },
  ];

  return (
    <div className="trading-section">

      {/* ── Account stats bar ─────────────────────────────────────────── */}
      <div className="account-stats-bar">
        {[
          { l: '現金',     v: `$${simAccount.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, c: 'white' },
          { l: '總資產',   v: `$${simAccount.totalValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, c: 'white' },
          { l: '總盈虧',   v: fmtPnl(simAccount.totalPnL), c: simAccount.totalPnL >= 0 ? 'pos' : 'neg' },
          { l: '報酬率',   v: `${simAccount.totalPnLPercent >= 0 ? '+' : ''}${simAccount.totalPnLPercent.toFixed(2)}%`, c: simAccount.totalPnLPercent >= 0 ? 'pos' : 'neg' },
          { l: '持倉數',   v: `${simPositions.length}`, c: 'white' },
          { l: '自動成交', v: `${executions.filter(e => e.result === 'success').length} 筆`, c: 'white' },
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
            message.success('模擬帳戶已重設');
          }}>重設帳戶</Button>
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
                <Text strong style={{ fontSize: 13 }}>全域控制</Text>
                <Text style={{ fontSize: 11, color: '#7b9586', marginLeft: 8 }}>
                  等級：[{({ high: '進階 >=75', medium: '標準 >=55', any: '不限' } as Record<string, string>)[atCfg.minLevel]}]&nbsp;
                  倉位：{(atCfg.positionPct * 100).toFixed(0)}%&nbsp;
                  冷卻：{(atCfg.cooldownMs / 60000).toFixed(0)} 分鐘
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
                  <Button size="small" icon={<SettingOutlined />} onClick={() => setSettingOpen(true)}>出場規則</Button>
                  <Button size="small" onClick={() => { autoTradeService.setAllSymbols(watchlistItems.map(w => w.symbol), true); onRefresh(); }}>全部開啟</Button>
                  <Button size="small" danger onClick={() => { autoTradeService.setAllSymbols(watchlistItems.map(w => w.symbol), false); onRefresh(); }}>全部關閉</Button>
                  {executions.length > 0 && <Button size="small" onClick={() => { autoTradeService.clearExecutions(); onRefresh(); }}>清空紀錄</Button>}
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
                    <Tag color={e.action === 'buy' ? 'green' : 'red'} style={{ margin: 0, fontSize: 10 }}>{e.action === 'buy' ? '買入' : '賣出'}</Tag>
                    <span className="exec-sym">{e.symbol}</span>
                    <span className="exec-price">${fmtPrice(e.price)}</span>
                    <Tag style={{ margin: 0, fontSize: 10 }}>{e.score}</Tag>
                    <span className="exec-reason">{e.result === 'success' ? e.reason : e.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#7b9586', fontSize: 12 }}>
                啟用標的後，當信號觸發就會在這裡顯示執行紀錄。
              </div>
            )}
          </div>
        )}

        {/* Positions */}
        {activeTab === 'positions' && (
          <div>
            <Row gutter={10} align="middle" style={{ marginBottom: 12 }}>
              <Col span={5}>
                <Select<string> size="small" style={{ width: '100%' }} placeholder="選擇標的" value={undefined}
                  options={watchlistItems.map(w => ({
                    label: `${w.symbol} $${fmtPrice(stocks.find(s => s.stock.symbol === w.symbol)?.stock.price ?? 0)}`,
                    value: w.symbol,
                  }))}
                  onChange={async (sym) => {
                    if (!sym) return;
                    const price = stocks.find(s => s.stock.symbol === sym)?.stock.price ?? 0;
                    if (!price) return message.error('目前無法取得價格');
                    const res = await tradingSimulator.executeTrade({ symbol: sym, type: 'buy', price, reason: '手動買入', confidence: 100 }, 0, 'manual');
                    if (res.success) { message.success(`已手動買入 ${sym}`); onRefresh(); } else message.error('手動買入失敗');
                  }}
                />
              </Col>
              <Col><Text style={{ fontSize: 11, color: '#7b9586' }}>快速買入（10% 倉位）</Text></Col>
              <Col flex={1}/>
              {simPositions.length > 0 && (
                <Col><Text style={{ fontSize: 11, color: '#7b9586' }}>目前共有 {simPositions.length} 筆持倉</Text></Col>
              )}
            </Row>
            <Table
              className="compact-table"
              dataSource={simPositions}
              rowKey="symbol"
              size="small"
              pagination={false}
              locale={{ emptyText: '目前沒有持倉' }}
              columns={[
                { title: '標的', dataIndex: 'symbol', width: 80, render: (s: string) => <Tag color="green" style={{ margin: 0 }}>{s}</Tag> },
                { title: '股數', dataIndex: 'quantity', width: 90, render: (v: number) => v.toFixed(4) },
                { title: '均價', dataIndex: 'avgPrice', width: 90, render: (v: number) => `$${fmtPrice(v)}` },
                { title: '現價', key: 'cur', render: (_: unknown, r: any) => {
                  const p   = stocks.find(s => s.stock.symbol === r.symbol)?.stock.price ?? r.avgPrice;
                  const chg = ((p - r.avgPrice) / r.avgPrice) * 100;
                  return <span>${fmtPrice(p)} <span style={{ fontSize: 10, color: chg >= 0 ? '#3fb950' : '#f85149' }}>({chg >= 0 ? '+' : ''}{chg.toFixed(2)}%)</span></span>;
                }},
                { title: '停損 / 止盈', key: 'sltp', render: (_: unknown, r: any) => (
                  <Space size={3}>
                    <Tag color="red" style={{ margin: 0, fontSize: 10 }}>停損 ${fmtPrice(r.stopLoss ?? 0)}</Tag>
                    <Tag color="green" style={{ margin: 0, fontSize: 10 }}>止盈 ${fmtPrice(r.takeProfit ?? 0)}</Tag>
                  </Space>
                )},
                { title: '浮動盈虧', key: 'pnl', render: (_: unknown, r: any) => {
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
                { title: '操作', key: 'act', width: 70, render: (_: unknown, r: any) => (
                  <Button size="small" danger onClick={async () => {
                    const price = stocks.find(s => s.stock.symbol === r.symbol)?.stock.price ?? r.avgPrice;
                    const res   = await tradingSimulator.executeTrade({ symbol: r.symbol, type: 'sell', price, reason: '手動賣出', confidence: 100 }, r.quantity, 'manual');
                    if (res.success) { message.success(`已手動平倉 ${r.symbol}`); onRefresh(); } else message.error('手動平倉失敗');
                  }}>平倉</Button>
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
            locale={{ emptyText: '目前沒有交易紀錄' }}
            columns={[
              { title: '時間', dataIndex: 'date', width: 90, render: (t: number) => fmtTime(t) },
              { title: '標的', dataIndex: 'symbol', width: 70, render: (s: string) => <Tag style={{ margin: 0 }}>{s}</Tag> },
              { title: '方向', dataIndex: 'side', width: 60, render: (s: string) => <Tag color={s === 'buy' ? 'green' : 'red'} style={{ margin: 0 }}>{s === 'buy' ? '買入' : '賣出'}</Tag> },
              { title: '股數', dataIndex: 'quantity', width: 80, render: (v: number) => v.toFixed(4) },
              { title: '價格', dataIndex: 'price', width: 90, render: (v: number) => `$${fmtPrice(v)}` },
              { title: '出場', dataIndex: 'exitReason', width: 70, render: (r: string | undefined) => {
                const m: Record<string, [string, string]> = { signal: ['信號', 'green'], stop_loss: ['停損', 'red'], take_profit: ['止盈', 'green'], manual: ['手動', 'default'] };
                const [l, c] = m[r ?? 'signal'] ?? [r, 'default'];
                return <Tag color={c} style={{ margin: 0, fontSize: 10 }}>{l}</Tag>;
              }},
              { title: '盈虧', dataIndex: 'pnl', width: 90, render: (p: number | undefined) =>
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
                  { l: '勝率', v: `${(simStats.winRate * 100).toFixed(1)}%`, c: simStats.winRate >= 0.5 ? '#3fb950' : '#f85149' },
                  { l: '獲利因子', v: simStats.profitFactor.toFixed(2), c: simStats.profitFactor >= 1.5 ? '#3fb950' : '#d29922' },
                  { l: '期望值', v: fmtPnl(simStats.expectancy), c: simStats.expectancy >= 0 ? '#3fb950' : '#f85149' },
                  { l: '最大回撤', v: `${(simStats.maxDrawdown * 100).toFixed(1)}%`, c: simStats.maxDrawdown > 0.2 ? '#f85149' : '#d29922' },
                  { l: '夏普值', v: simStats.sharpeRatio.toFixed(2), c: simStats.sharpeRatio >= 1 ? '#3fb950' : '#7b9586' },
                  { l: '停損次數', v: `${simStats.byExitReason.stop_loss.count}`, c: '#f85149' },
                  { l: '止盈次數', v: `${simStats.byExitReason.take_profit.count}`, c: '#3fb950' },
                ].map(m => (
                  <div key={m.l} className="perf-cell">
                    <div className="perf-cell-label">{m.l}</div>
                    <div className="perf-cell-value" style={{ color: m.c }}>{m.v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(103, 201, 138, 0.08)', border: '1px solid rgba(93, 187, 123, 0.14)', borderRadius: 12, fontSize: 12, color: '#5f7a6a' }}>
                共 {simStats.totalTrades} 筆交易 · 勝 {simStats.winningTrades} 筆 · 負 {simStats.losingTrades} 筆 · 總盈虧 {fmtPnl(simStats.totalPnL)}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '30px', color: '#7b9586', fontSize: 12 }}>完成交易後，這裡會顯示模擬績效統計。</div>
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
      title={<><SettingOutlined /> 自動交易設定</>}
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
        message.success('設定已儲存');
        onClose();
      }}
      okText="儲存" cancelText="取消" width={480}
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
          label="出場配置"
          name="exitMode"
          help="V1-V5 為直接進場模式；V6/V7 需三重確認後才會進場。"
        >
          <Select options={(Object.entries(EXIT_MODE_LABELS) as [string, string][]).map(([v, l]) => ({ value: v, label: l }))} />
        </Form.Item>
        <Form.Item label="最低信號等級" name="minLevel">
          <Segmented options={[
            { label: '進階 (>=75)', value: 'high' },
            { label: '標準 (>=55)', value: 'medium' },
            { label: '任何信號', value: 'any' },
          ]} />
        </Form.Item>
        <Form.Item label="使用頂底預測" name="usePrediction" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item label="最低預測機率 %" name="minPredProb">
          <Slider min={50} max={95} marks={{ 65: '65%', 75: '75%', 85: '85%' }} />
        </Form.Item>
        <Form.Item label="單筆倉位 %" name="positionPct" help="每筆交易可使用的可用現金比例">
          <Slider min={5} max={50} step={5} marks={{ 10: '10%', 20: '20%', 30: '30%' }} />
        </Form.Item>
        <Form.Item label="冷卻時間（分鐘）" name="cooldownMin" help="同一標的兩次買入之間的最短間隔">
          <Slider min={1} max={60} marks={{ 5: '5m', 15: '15m', 30: '30m' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};
