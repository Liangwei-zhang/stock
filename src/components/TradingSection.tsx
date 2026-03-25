import React, { useState } from 'react';
import { Typography, Tag, Button, Table, Row, Col, Select, Space, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>('autotrade');

  const atCfg       = autoTradeService.getConfig();
  const priceMap    = new Map(stocks.map(s => [s.stock.symbol, s.stock.price]));
  const simAccount  = tradingSimulator.getAccount(priceMap);
  const simPositions = tradingSimulator.getPositions();
  const simTrades   = tradingSimulator.getTrades();
  const simStats    = calcTradeStats ? calcTradeStats(simTrades) : null;
  const executions  = autoTradeService.getExecutions();

  const tabs: { key: TabKey; label: string; badge?: number; green?: boolean }[] = [
    { key: 'autotrade',   label: t('trading.autoTrade'),    badge: executions.filter(e => e.result === 'success').length, green: true },
    { key: 'positions',   label: t('trading.positions'),    badge: simPositions.length },
    { key: 'history',     label: t('trading.tradeHistory') },
    { key: 'performance', label: t('trading.performance') },
    { key: 'bots',        label: t('trading.bots') },
  ];

  return (
    <div className="trading-section">

      {/* ── Account stats bar ─────────────────────────────────────────── */}
      <div className="account-stats-bar">
        {[
          { l: t('trading.balance'),      v: `$${simAccount.balance.toLocaleString('en', { maximumFractionDigits: 2 })}`,    c: 'white' },
          { l: t('trading.totalAssets'),  v: `$${simAccount.totalValue.toLocaleString('en', { maximumFractionDigits: 2 })}`, c: 'white' },
          { l: t('trading.totalPnL'),     v: fmtPnl(simAccount.totalPnL),                                                    c: simAccount.totalPnL >= 0 ? 'pos' : 'neg' },
          { l: t('trading.returns'),      v: `${simAccount.totalPnLPercent >= 0 ? '+' : ''}${simAccount.totalPnLPercent.toFixed(2)}%`, c: simAccount.totalPnLPercent >= 0 ? 'pos' : 'neg' },
          { l: t('trading.positionCount'),v: `${simPositions.length}`,                                                        c: 'white' },
          { l: t('trading.autoExec'),     v: t('trading.execOrders', { count: executions.filter(e => e.result === 'success').length }), c: 'white' },
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
            message.success(t('trading.resetSuccess'));
          }}>{t('trading.resetAccount')}</Button>
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
                <Text strong style={{ fontSize: 13 }}>{t('trading.globalSwitch')}</Text>
                <Text style={{ fontSize: 11, color: '#484f58', marginLeft: 8 }}>
                  {t('trading.levelInfo', {
                    level: ({ high: t('trading.level_high'), medium: t('trading.level_medium'), any: t('trading.level_any') } as Record<string, string>)[atCfg.minLevel],
                    pos: (atCfg.positionPct * 100).toFixed(0),
                    pred: atCfg.usePrediction ? t('trading.withPrediction', { pct: (atCfg.minPredProb * 100).toFixed(0) }) : t('trading.noPrediction'),
                    cool: (atCfg.cooldownMs / 60000).toFixed(0),
                  })}
                </Text>
              </Col>
              <Col flex={1}/>
              <Col>
                <Space size={6}>
                  <Button size="small" onClick={() => { autoTradeService.setAllSymbols(watchlistItems.map(w => w.symbol), true); onRefresh(); }}>{t('trading.enableAll')}</Button>
                  <Button size="small" danger onClick={() => { autoTradeService.setAllSymbols(watchlistItems.map(w => w.symbol), false); onRefresh(); }}>{t('trading.disableAll')}</Button>
                  {executions.length > 0 && <Button size="small" onClick={() => { autoTradeService.clearExecutions(); onRefresh(); }}>{t('trading.clearRecords')}</Button>}
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
                    <Tag color={e.action === 'buy' ? 'green' : 'red'} style={{ margin: 0, fontSize: 10 }}>{e.action === 'buy' ? t('common.buy') : t('common.sell')}</Tag>
                    <span className="exec-sym">{e.symbol}</span>
                    <span className="exec-price">${fmtPrice(e.price)}</span>
                    <Tag style={{ margin: 0, fontSize: 10 }}>{e.score}</Tag>
                    <span className="exec-reason">{e.result === 'success' ? e.reason : e.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0', color: '#484f58', fontSize: 12 }}>
                {t('trading.noExecRecords')}
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
                    if (!price) return message.error('Price unavailable');
                    const res = await tradingSimulator.executeTrade({ symbol: sym, type: 'buy', price, reason: 'manual', confidence: 100 }, 0, 'manual');
                    if (res.success) { message.success(res.message); onRefresh(); } else message.error(res.message);
                  }}
                />
              </Col>
              <Col><Text style={{ fontSize: 11, color: '#484f58' }}>{t('trading.quickBuy')}</Text></Col>
              <Col flex={1}/>
              {simPositions.length > 0 && (
                <Col><Text style={{ fontSize: 11, color: '#484f58' }}>{t('trading.positionCountLabel', { count: simPositions.length })}</Text></Col>
              )}
            </Row>
            <Table
              className="compact-table"
              dataSource={simPositions}
              rowKey="symbol"
              size="small"
              pagination={false}
              locale={{ emptyText: t('trading.noPositions') }}
              columns={[
                { title: 'Symbol',   dataIndex: 'symbol',   width: 80,  render: (s: string) => <Tag color="blue" style={{ margin: 0 }}>{s}</Tag> },
                { title: 'Qty',      dataIndex: 'quantity', width: 90,  render: (v: number) => v.toFixed(4) },
                { title: 'Avg',      dataIndex: 'avgPrice', width: 90,  render: (v: number) => `$${fmtPrice(v)}` },
                { title: 'Price', key: 'cur', render: (_: unknown, r: any) => {
                  const p   = stocks.find(s => s.stock.symbol === r.symbol)?.stock.price ?? r.avgPrice;
                  const chg = ((p - r.avgPrice) / r.avgPrice) * 100;
                  return <span>${fmtPrice(p)} <span style={{ fontSize: 10, color: chg >= 0 ? '#3fb950' : '#f85149' }}>({chg >= 0 ? '+' : ''}{chg.toFixed(2)}%)</span></span>;
                }},
                { title: 'SL/TP', key: 'sltp', render: (_: unknown, r: any) => (
                  <Space size={3}>
                    <Tag color="red"   style={{ margin: 0, fontSize: 10 }}>SL${fmtPrice(r.stopLoss ?? 0)}</Tag>
                    <Tag color="green" style={{ margin: 0, fontSize: 10 }}>TP${fmtPrice(r.takeProfit ?? 0)}</Tag>
                  </Space>
                )},
                { title: 'P&L', key: 'pnl', render: (_: unknown, r: any) => {
                  const p   = stocks.find(s => s.stock.symbol === r.symbol)?.stock.price ?? r.avgPrice;
                  const pnl = (p - r.avgPrice) * r.quantity;
                  return <Text style={{ color: pnl >= 0 ? '#3fb950' : '#f85149', fontSize: 12 }}>{fmtPnl(pnl)}</Text>;
                }},
                { title: 'Act', key: 'act', width: 70, render: (_: unknown, r: any) => (
                  <Button size="small" danger onClick={async () => {
                    const price = stocks.find(s => s.stock.symbol === r.symbol)?.stock.price ?? r.avgPrice;
                    const res   = await tradingSimulator.executeTrade({ symbol: r.symbol, type: 'sell', price, reason: 'manual', confidence: 100 }, r.quantity, 'manual');
                    if (res.success) { message.success(res.message); onRefresh(); } else message.error(res.message);
                  }}>{t('trading.closePosition')}</Button>
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
            locale={{ emptyText: t('trading.noTrades') }}
            columns={[
              { title: 'Time',   dataIndex: 'date',       width: 90, render: (ts: number) => fmtTime(ts) },
              { title: 'Symbol', dataIndex: 'symbol',     width: 70, render: (s: string) => <Tag style={{ margin: 0 }}>{s}</Tag> },
              { title: 'Side',   dataIndex: 'side',       width: 60, render: (s: string) => <Tag color={s === 'buy' ? 'green' : 'red'} style={{ margin: 0 }}>{s === 'buy' ? t('common.buy') : t('common.sell')}</Tag> },
              { title: 'Qty',    dataIndex: 'quantity',   width: 80, render: (v: number) => v.toFixed(4) },
              { title: 'Price',  dataIndex: 'price',      width: 90, render: (v: number) => `$${fmtPrice(v)}` },
              { title: 'Exit',   dataIndex: 'exitReason', width: 55, render: (r: string | undefined) => {
                const m: Record<string, [string, string]> = {
                  signal:      [t('trading.exitSignal'),     'blue'],
                  stop_loss:   [t('trading.exitStopLoss'),   'red'],
                  take_profit: [t('trading.exitTakeProfit'), 'green'],
                  manual:      [t('trading.exitManual'),     'default'],
                };
                const [l, c] = m[r ?? 'signal'] ?? [r, 'default'];
                return <Tag color={c} style={{ margin: 0, fontSize: 10 }}>{l}</Tag>;
              }},
              { title: 'P&L',    dataIndex: 'pnl', width: 90, render: (p: number | undefined) =>
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
                  { l: t('trading.winRate'),        v: `${(simStats.winRate * 100).toFixed(1)}%`,            c: simStats.winRate >= 0.5 ? '#3fb950' : '#f85149' },
                  { l: t('trading.profitFactor'),   v: simStats.profitFactor.toFixed(2),                     c: simStats.profitFactor >= 1.5 ? '#3fb950' : '#d29922' },
                  { l: t('trading.expectancy'),     v: fmtPnl(simStats.expectancy),                          c: simStats.expectancy >= 0 ? '#3fb950' : '#f85149' },
                  { l: t('trading.maxDrawdown'),    v: `${(simStats.maxDrawdown * 100).toFixed(1)}%`,        c: simStats.maxDrawdown > 0.2 ? '#f85149' : '#d29922' },
                  { l: t('trading.sharpe'),         v: simStats.sharpeRatio.toFixed(2),                       c: simStats.sharpeRatio >= 1 ? '#3fb950' : '#8b949e' },
                  { l: t('trading.stopLossCount'),  v: `${simStats.byExitReason.stop_loss.count}`,            c: '#f85149' },
                  { l: t('trading.takeProfitCount'),v: `${simStats.byExitReason.take_profit.count}`,          c: '#3fb950' },
                ].map(m => (
                  <div key={m.l} className="perf-cell">
                    <div className="perf-cell-label">{m.l}</div>
                    <div className="perf-cell-value" style={{ color: m.c }}>{m.v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 12, color: '#8b949e' }}>
                {t('trading.tradeSummary', { total: simStats.totalTrades, wins: simStats.winningTrades, losses: simStats.losingTrades, pnl: fmtPnl(simStats.totalPnL) })}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '30px', color: '#484f58', fontSize: 12 }}>{t('trading.afterTradeStats')}</div>
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
