import React, { useState } from 'react';
import { Typography, Tag, Button, Table, Row, Col, Select, Space, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
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
  const [activeTab, setActiveTab] = useState<TabKey>('autotrade');

  const atCfg       = autoTradeService.getConfig();
  const priceMap    = new Map(stocks.map(s => [s.stock.symbol, s.stock.price]));
  const simAccount  = tradingSimulator.getAccount(priceMap);
  const simPositions = tradingSimulator.getPositions();
  const simTrades   = tradingSimulator.getTrades();
  const simStats    = calcTradeStats ? calcTradeStats(simTrades) : null;
  const executions  = autoTradeService.getExecutions();

  const tabs: { key: TabKey; label: string; badge?: number; green?: boolean }[] = [
    { key: 'autotrade',   label: '自动交易', badge: executions.filter(e => e.result === 'success').length, green: true },
    { key: 'positions',   label: '持仓',     badge: simPositions.length },
    { key: 'history',     label: '交易历史' },
    { key: 'performance', label: '绩效' },
    { key: 'bots',        label: '模拟用户' },
  ];

  return (
    <div className="trading-section">

      {/* ── Account stats bar ─────────────────────────────────────────── */}
      <div className="account-stats-bar">
        {[
          { l: '余额',   v: `$${simAccount.balance.toLocaleString('en', { maximumFractionDigits: 2 })}`,    c: 'white' },
          { l: '总资产', v: `$${simAccount.totalValue.toLocaleString('en', { maximumFractionDigits: 2 })}`, c: 'white' },
          { l: '总盈亏', v: fmtPnl(simAccount.totalPnL),                                                    c: simAccount.totalPnL >= 0 ? 'pos' : 'neg' },
          { l: '收益率', v: `${simAccount.totalPnLPercent >= 0 ? '+' : ''}${simAccount.totalPnLPercent.toFixed(2)}%`, c: simAccount.totalPnLPercent >= 0 ? 'pos' : 'neg' },
          { l: '持仓数', v: `${simPositions.length}`,                                                        c: 'white' },
          { l: '自动执行',v: `${executions.filter(e => e.result === 'success').length} 笔`,                   c: 'white' },
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
            message.success('已重置');
          }}>重置账户</Button>
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

        {/* Auto Trade */}
        {activeTab === 'autotrade' && (
          <div>
            <Row gutter={16} align="middle" style={{ marginBottom: 12 }}>
              <Col>
                <Text strong style={{ fontSize: 13 }}>全局开关</Text>
                <Text style={{ fontSize: 11, color: '#484f58', marginLeft: 8 }}>
                  等级:[{({ high: '高级≥75', medium: '中级≥55', any: '任意' } as Record<string, string>)[atCfg.minLevel]}]&nbsp;
                  仓位:{(atCfg.positionPct * 100).toFixed(0)}%&nbsp;
                  预测:{atCfg.usePrediction ? `✓≥${(atCfg.minPredProb * 100).toFixed(0)}%` : '✗'}&nbsp;
                  冷却:{(atCfg.cooldownMs / 60000).toFixed(0)}分
                </Text>
              </Col>
              <Col flex={1}/>
              <Col>
                <Space size={6}>
                  <Button size="small" onClick={() => { autoTradeService.setAllSymbols(watchlistItems.map(w => w.symbol), true); onRefresh(); }}>全部开启</Button>
                  <Button size="small" danger onClick={() => { autoTradeService.setAllSymbols(watchlistItems.map(w => w.symbol), false); onRefresh(); }}>全部关闭</Button>
                  {executions.length > 0 && <Button size="small" onClick={() => { autoTradeService.clearExecutions(); onRefresh(); }}>清空记录</Button>}
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
                    <span style={{ fontSize: 10, color: '#484f58' }}>
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
                    <Tag color={e.action === 'buy' ? 'green' : 'red'} style={{ margin: 0, fontSize: 10 }}>{e.action === 'buy' ? '买入' : '卖出'}</Tag>
                    <span className="exec-sym">{e.symbol}</span>
                    <span className="exec-price">${fmtPrice(e.price)}</span>
                    <Tag style={{ margin: 0, fontSize: 10 }}>{e.score}</Tag>
                    <span className="exec-reason">{e.result === 'success' ? e.reason : e.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#484f58', fontSize: 12 }}>
                开启标的开关后，信号触发时将在此显示执行记录
              </div>
            )}
          </div>
        )}

        {/* Positions */}
        {activeTab === 'positions' && (
          <div>
            <Row gutter={10} align="middle" style={{ marginBottom: 12 }}>
              <Col span={5}>
                <Select size="small" style={{ width: '100%' }} placeholder="选择标的" value={undefined}
                  options={watchlistItems.map(w => ({
                    label: `${w.symbol} $${fmtPrice(stocks.find(s => s.stock.symbol === w.symbol)?.stock.price ?? 0)}`,
                    value: w.symbol,
                  }))}
                  onChange={async (sym) => {
                    const price = stocks.find(s => s.stock.symbol === sym)?.stock.price ?? 0;
                    if (!price) return message.error('无法获取价格');
                    const res = await tradingSimulator.executeTrade({ symbol: sym, type: 'buy', price, reason: '手动买入', confidence: 100 }, 0, 'manual');
                    if (res.success) { message.success(res.message); onRefresh(); } else message.error(res.message);
                  }}
                />
              </Col>
              <Col><Text style={{ fontSize: 11, color: '#484f58' }}>快速买入（10%仓位）</Text></Col>
              <Col flex={1}/>
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
                    const res   = await tradingSimulator.executeTrade({ symbol: r.symbol, type: 'sell', price, reason: '手动卖出', confidence: 100 }, r.quantity, 'manual');
                    if (res.success) { message.success(res.message); onRefresh(); } else message.error(res.message);
                  }}>平仓</Button>
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
            locale={{ emptyText: '暂无交易记录' }}
            columns={[
              { title: '时间',   dataIndex: 'date',       width: 90, render: (t: number) => fmtTime(t) },
              { title: '标的',   dataIndex: 'symbol',     width: 70, render: (s: string) => <Tag style={{ margin: 0 }}>{s}</Tag> },
              { title: '方向',   dataIndex: 'side',       width: 60, render: (s: string) => <Tag color={s === 'buy' ? 'green' : 'red'} style={{ margin: 0 }}>{s === 'buy' ? '买入' : '卖出'}</Tag> },
              { title: '数量',   dataIndex: 'quantity',   width: 80, render: (v: number) => v.toFixed(4) },
              { title: '价格',   dataIndex: 'price',      width: 90, render: (v: number) => `$${fmtPrice(v)}` },
              { title: '退出',   dataIndex: 'exitReason', width: 55, render: (r: string | undefined) => {
                const m: Record<string, [string, string]> = { signal: ['信号', 'blue'], stop_loss: ['止损', 'red'], take_profit: ['止盈', 'green'], manual: ['手动', 'default'] };
                const [l, c] = m[r ?? 'signal'] ?? [r, 'default'];
                return <Tag color={c} style={{ margin: 0, fontSize: 10 }}>{l}</Tag>;
              }},
              { title: '盈亏',   dataIndex: 'pnl', width: 90, render: (p: number | undefined) =>
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
                  { l: '胜率',    v: `${(simStats.winRate * 100).toFixed(1)}%`,            c: simStats.winRate >= 0.5 ? '#3fb950' : '#f85149' },
                  { l: '盈亏比',  v: simStats.profitFactor.toFixed(2),                     c: simStats.profitFactor >= 1.5 ? '#3fb950' : '#d29922' },
                  { l: '期望值',  v: fmtPnl(simStats.expectancy),                          c: simStats.expectancy >= 0 ? '#3fb950' : '#f85149' },
                  { l: '最大回撤', v: `${(simStats.maxDrawdown * 100).toFixed(1)}%`,        c: simStats.maxDrawdown > 0.2 ? '#f85149' : '#d29922' },
                  { l: 'Sharpe', v: simStats.sharpeRatio.toFixed(2),                       c: simStats.sharpeRatio >= 1 ? '#3fb950' : '#8b949e' },
                  { l: '止损次数', v: `${simStats.byExitReason.stop_loss.count}`,            c: '#f85149' },
                  { l: '止盈次数', v: `${simStats.byExitReason.take_profit.count}`,          c: '#3fb950' },
                ].map(m => (
                  <div key={m.l} className="perf-cell">
                    <div className="perf-cell-label">{m.l}</div>
                    <div className="perf-cell-value" style={{ color: m.c }}>{m.v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 12, color: '#8b949e' }}>
                共 {simStats.totalTrades} 笔交易 · 胜 {simStats.winningTrades} 负 {simStats.losingTrades} · 总盈亏 {fmtPnl(simStats.totalPnL)}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '30px', color: '#484f58', fontSize: 12 }}>完成交易后此处显示绩效统计</div>
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
