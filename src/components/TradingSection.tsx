import React, { useState } from 'react';
import { Typography, Tag, Button, Table, Row, Col } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { autoTradeService }  from '../services/autoTradeService';
import { tradingSimulator }  from '../services/tradingSimulator';
import { calcTradeStats }    from '../services/backtestStats';
import { SimulatedUsersPanel } from './SimulatedUsersPanel';
import { AutoTradeConfig }   from './AutoTradeConfig';
import { ManualTradeForm }   from './ManualTradeForm';
import { fmtPrice }          from '../utils/format';
import { StockData, WatchlistItem } from '../types';
import { message } from 'antd';

const { Text } = Typography;

type TabKey = 'autotrade' | 'positions' | 'history' | 'performance' | 'bots';

const fmtPnl  = (n: number) => `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`;
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

  const atCfg        = autoTradeService.getConfig();
  const priceMap     = new Map(stocks.map(s => [s.stock.symbol, s.stock.price]));
  const simAccount   = tradingSimulator.getAccount(priceMap);
  const simPositions = tradingSimulator.getPositions();
  const simTrades    = tradingSimulator.getTrades();
  const simStats     = calcTradeStats ? calcTradeStats(simTrades) : null;
  const executions   = autoTradeService.getExecutions();

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

        {activeTab === 'autotrade' && (
          <AutoTradeConfig
            atCfg={atCfg}
            watchlistItems={watchlistItems}
            stocks={stocks}
            executions={executions}
            onRefresh={onRefresh}
          />
        )}

        {activeTab === 'positions' && (
          <ManualTradeForm
            stocks={stocks}
            watchlistItems={watchlistItems}
            onRefresh={onRefresh}
          />
        )}

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
