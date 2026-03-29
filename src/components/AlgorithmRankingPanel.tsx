import React, { useEffect, useMemo, useState } from 'react';
import { Typography, Segmented, Tag, Empty, Tooltip, Button, InputNumber, Switch, Dropdown, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { pluginRegistry } from '../core/plugin-registry';
import { stockService } from '../services/stockService';
import {
  rankPluginsByBacktest,
  rankPluginsByTradeBacktest,
} from '../services/backtestStats';

const { Text } = Typography;

interface Props {
  selectedStock: string;
  refreshKey: number;
  onRefresh?: () => void;
}

type RankingMode = 'trade' | 'signal';

interface TradePanelOptions {
  lookbackBars: number;
  positionPct: number;
  stopMultiplier: number;
  profitMultiplier: number;
  minBuyScore: number;
  minSellScore: number;
  minPredProb: number;
  allowShort: boolean;
  includePredictions: boolean;
}

interface SignalPanelOptions {
  lookbackBars: number;
  holdBars: number;
  minSignalScore: number;
  minConfidence: number;
  includePredictions: boolean;
}

const DEFAULT_TRADE_OPTIONS: TradePanelOptions = {
  lookbackBars: 80,
  positionPct: 10,
  stopMultiplier: 2,
  profitMultiplier: 3,
  minBuyScore: 55,
  minSellScore: 55,
  minPredProb: 65,
  allowShort: true,
  includePredictions: true,
};

const DEFAULT_SIGNAL_OPTIONS: SignalPanelOptions = {
  lookbackBars: 80,
  holdBars: 5,
  minSignalScore: 55,
  minConfidence: 65,
  includePredictions: true,
};

function downloadText(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
}

export const AlgorithmRankingPanel: React.FC<Props> = ({ selectedStock, refreshKey, onRefresh }) => {
  const [mode, setMode] = useState<RankingMode>('trade');
  const [showSettings, setShowSettings] = useState(false);
  const [tradeOptions, setTradeOptions] = useState<TradePanelOptions>(DEFAULT_TRADE_OPTIONS);
  const [signalOptions, setSignalOptions] = useState<SignalPanelOptions>(DEFAULT_SIGNAL_OPTIONS);
  const [activePluginId, setActivePluginId] = useState(() => pluginRegistry.getActiveId());
  const [activatingBest, setActivatingBest] = useState(false);

  useEffect(() => {
    setActivePluginId(pluginRegistry.getActiveId());
  }, [refreshKey, selectedStock]);

  const history = useMemo(
    () => selectedStock ? stockService.getStockHistory(selectedStock) : [],
    [selectedStock, refreshKey],
  );

  const tradeRanking = useMemo(
    () => history.length ? rankPluginsByTradeBacktest(selectedStock, history, {
      lookbackBars: tradeOptions.lookbackBars,
      initialBalance: 100_000,
      positionPct: tradeOptions.positionPct / 100,
      stopMultiplier: tradeOptions.stopMultiplier,
      profitMultiplier: tradeOptions.profitMultiplier,
      minBuyScore: tradeOptions.minBuyScore,
      minSellScore: tradeOptions.minSellScore,
      minPredProb: tradeOptions.minPredProb / 100,
      allowShort: tradeOptions.allowShort,
      includePredictions: tradeOptions.includePredictions,
    }) : [],
    [selectedStock, history, tradeOptions],
  );

  const signalRanking = useMemo(
    () => history.length ? rankPluginsByBacktest(selectedStock, history, {
      lookbackBars: signalOptions.lookbackBars,
      holdBars: signalOptions.holdBars,
      minSignalScore: signalOptions.minSignalScore,
      minConfidence: signalOptions.minConfidence / 100,
      includeSignals: true,
      includePredictions: signalOptions.includePredictions,
    }) : [],
    [selectedStock, history, signalOptions],
  );

  const rows = mode === 'trade' ? tradeRanking : signalRanking;
  const tradeTop = mode === 'trade' ? tradeRanking[0] ?? null : null;
  const signalTop = mode === 'signal' ? signalRanking[0] ?? null : null;
  const top = tradeTop ?? signalTop;

  const handleActivateBest = async () => {
    if (!top || top.pluginId === activePluginId) return;

    setActivatingBest(true);
    try {
      await pluginRegistry.setActive(top.pluginId, selectedStock);
      setActivePluginId(top.pluginId);
      message.success(`已切換為最佳策略：${top.pluginName}`);
      onRefresh?.();
    } catch (error) {
      const reason = error instanceof Error ? error.message : '未知錯誤';
      message.error(`切換策略失敗：${reason}`);
    } finally {
      setActivatingBest(false);
    }
  };

  const exportItems = [
    { key: 'csv', label: '匯出 CSV' },
    { key: 'json', label: '匯出 JSON' },
  ];

  const handleExport = (format: 'csv' | 'json') => {
    const filenameBase = `${selectedStock}_${mode === 'trade' ? 'trade_ranking' : 'signal_ranking'}_${stamp()}`;

    if (format === 'json') {
      const payload = {
        symbol: selectedStock,
        mode,
        exportedAt: new Date().toISOString(),
        historyBars: history.length,
        parameters: mode === 'trade' ? tradeOptions : signalOptions,
        ranking: mode === 'trade'
          ? tradeRanking.map((row, index) => ({
              rank: index + 1,
              pluginId: row.pluginId,
              pluginName: row.pluginName,
              totalTrades: row.tradeStats?.totalTrades ?? 0,
              winRate: row.tradeStats?.winRate ?? 0,
              totalPnL: row.tradeStats?.totalPnL ?? 0,
              profitFactor: row.tradeStats?.profitFactor ?? 0,
              sharpeRatio: row.tradeStats?.sharpeRatio ?? 0,
              maxDrawdown: row.tradeStats?.maxDrawdown ?? 0,
              totalReturnPct: row.totalReturnPct,
              summary: row.summary,
            }))
          : signalRanking.map((row, index) => ({
              rank: index + 1,
              pluginId: row.pluginId,
              pluginName: row.pluginName,
              totalSignals: row.stats.totalSignals,
              winRate: row.stats.winRate,
              avgReturn: row.stats.avgReturn,
              highConfidence: row.stats.highConfidence,
              buyWinRate: row.stats.byType.buy.winRate,
              sellWinRate: row.stats.byType.sell.winRate,
              topWinRate: row.stats.byType.top.winRate,
              bottomWinRate: row.stats.byType.bottom.winRate,
              summary: row.summary,
            })),
      };

      downloadText(JSON.stringify(payload, null, 2), `${filenameBase}.json`, 'application/json');
      return;
    }

    const csv = mode === 'trade'
      ? [
          ['Rank', 'Plugin', 'TotalTrades', 'WinRate', 'TotalPnL', 'ProfitFactor', 'Sharpe', 'MaxDrawdown', 'TotalReturnPct'].join(','),
          ...tradeRanking.map((row, index) => [
            index + 1,
            `"${row.pluginName}"`,
            row.tradeStats?.totalTrades ?? 0,
            row.tradeStats ? (row.tradeStats.winRate * 100).toFixed(2) : '0.00',
            row.tradeStats?.totalPnL.toFixed(2) ?? '0.00',
            row.tradeStats?.profitFactor.toFixed(4) ?? '0.0000',
            row.tradeStats?.sharpeRatio.toFixed(4) ?? '0.0000',
            row.tradeStats ? (row.tradeStats.maxDrawdown * 100).toFixed(2) : '0.00',
            row.totalReturnPct.toFixed(2),
          ].join(',')),
        ].join('\n')
      : [
          ['Rank', 'Plugin', 'TotalSignals', 'WinRate', 'AvgReturn', 'HighConfidence', 'BuyWinRate', 'SellWinRate', 'TopWinRate', 'BottomWinRate'].join(','),
          ...signalRanking.map((row, index) => [
            index + 1,
            `"${row.pluginName}"`,
            row.stats.totalSignals,
            (row.stats.winRate * 100).toFixed(2),
            (row.stats.avgReturn * 100).toFixed(4),
            row.stats.highConfidence,
            (row.stats.byType.buy.winRate * 100).toFixed(2),
            (row.stats.byType.sell.winRate * 100).toFixed(2),
            (row.stats.byType.top.winRate * 100).toFixed(2),
            (row.stats.byType.bottom.winRate * 100).toFixed(2),
          ].join(',')),
        ].join('\n');

    downloadText(csv, `${filenameBase}.csv`, 'text/csv;charset=utf-8;');
  };

  if (!selectedStock) return null;

  return (
    <div className="ranking-panel">
      <div className="ranking-header">
        <div>
          <div className="ranking-title">策略回測排行</div>
          <div className="ranking-subtitle">
            {selectedStock} · {history.length} 根 K 線
          </div>
        </div>
        <Segmented
          size="small"
          value={mode}
          onChange={(value) => setMode(value as RankingMode)}
          options={[
            { label: '交易回測', value: 'trade' },
            { label: '信號回測', value: 'signal' },
          ]}
        />
      </div>

      <div className="ranking-toolbar">
        <div className="ranking-toolbar-actions">
          <Button size="small" onClick={() => setShowSettings(v => !v)}>
            {showSettings ? '收起設定' : '調整設定'}
          </Button>
          <Button
            size="small"
            onClick={() => {
              if (mode === 'trade') setTradeOptions(DEFAULT_TRADE_OPTIONS);
              else setSignalOptions(DEFAULT_SIGNAL_OPTIONS);
            }}
          >
            還原預設
          </Button>
          <Dropdown
            menu={{
              items: exportItems,
              onClick: ({ key }) => handleExport(key as 'csv' | 'json'),
            }}
            trigger={['click']}
          >
            <Button size="small" icon={<DownloadOutlined />}>
              匯出排行
            </Button>
          </Dropdown>
        </div>
        <Text className="ranking-toolbar-note">
          {mode === 'trade'
            ? `回看 ${tradeOptions.lookbackBars} 根 / 倉位 ${tradeOptions.positionPct}% / 止損 ${tradeOptions.stopMultiplier} 倍 ATR / 目標 ${tradeOptions.profitMultiplier} 倍 ATR`
            : `回看 ${signalOptions.lookbackBars} 根 / 持有 ${signalOptions.holdBars} 根 / 信號門檻 ${signalOptions.minSignalScore} / 信心門檻 ${signalOptions.minConfidence}%`}
        </Text>
      </div>

      {showSettings && (
        <div className="ranking-settings-card">
          {mode === 'trade' ? (
            <div className="ranking-settings-grid">
              <label className="ranking-setting-item">
                <span>回看 K 線數</span>
                <InputNumber size="small" min={40} max={240} step={10} value={tradeOptions.lookbackBars} onChange={(value) => setTradeOptions(v => ({ ...v, lookbackBars: value ?? v.lookbackBars }))} />
              </label>
              <label className="ranking-setting-item">
                <span>單筆倉位 %</span>
                <InputNumber size="small" min={5} max={50} step={5} value={tradeOptions.positionPct} onChange={(value) => setTradeOptions(v => ({ ...v, positionPct: value ?? v.positionPct }))} />
              </label>
              <label className="ranking-setting-item">
                <span>止損 ATR</span>
                <InputNumber size="small" min={0.5} max={5} step={0.5} value={tradeOptions.stopMultiplier} onChange={(value) => setTradeOptions(v => ({ ...v, stopMultiplier: value ?? v.stopMultiplier }))} />
              </label>
              <label className="ranking-setting-item">
                <span>目標 ATR</span>
                <InputNumber size="small" min={1} max={8} step={0.5} value={tradeOptions.profitMultiplier} onChange={(value) => setTradeOptions(v => ({ ...v, profitMultiplier: value ?? v.profitMultiplier }))} />
              </label>
              <label className="ranking-setting-item">
                <span>買入門檻</span>
                <InputNumber size="small" min={35} max={95} step={5} value={tradeOptions.minBuyScore} onChange={(value) => setTradeOptions(v => ({ ...v, minBuyScore: value ?? v.minBuyScore }))} />
              </label>
              <label className="ranking-setting-item">
                <span>賣出門檻</span>
                <InputNumber size="small" min={35} max={95} step={5} value={tradeOptions.minSellScore} onChange={(value) => setTradeOptions(v => ({ ...v, minSellScore: value ?? v.minSellScore }))} />
              </label>
              <label className="ranking-setting-item">
                <span>預測門檻 %</span>
                <InputNumber size="small" min={50} max={95} step={5} value={tradeOptions.minPredProb} onChange={(value) => setTradeOptions(v => ({ ...v, minPredProb: value ?? v.minPredProb }))} />
              </label>
              <label className="ranking-setting-item switch">
                <span>允許放空</span>
                <Switch size="small" checked={tradeOptions.allowShort} onChange={(checked) => setTradeOptions(v => ({ ...v, allowShort: checked }))} />
              </label>
              <label className="ranking-setting-item switch">
                <span>納入頂底預測</span>
                <Switch size="small" checked={tradeOptions.includePredictions} onChange={(checked) => setTradeOptions(v => ({ ...v, includePredictions: checked }))} />
              </label>
            </div>
          ) : (
            <div className="ranking-settings-grid compact">
              <label className="ranking-setting-item">
                <span>回看 K 線數</span>
                <InputNumber size="small" min={40} max={240} step={10} value={signalOptions.lookbackBars} onChange={(value) => setSignalOptions(v => ({ ...v, lookbackBars: value ?? v.lookbackBars }))} />
              </label>
              <label className="ranking-setting-item">
                <span>持有根數</span>
                <InputNumber size="small" min={1} max={20} step={1} value={signalOptions.holdBars} onChange={(value) => setSignalOptions(v => ({ ...v, holdBars: value ?? v.holdBars }))} />
              </label>
              <label className="ranking-setting-item">
                <span>信號門檻</span>
                <InputNumber size="small" min={35} max={95} step={5} value={signalOptions.minSignalScore} onChange={(value) => setSignalOptions(v => ({ ...v, minSignalScore: value ?? v.minSignalScore }))} />
              </label>
              <label className="ranking-setting-item">
                <span>信心門檻 %</span>
                <InputNumber size="small" min={50} max={95} step={5} value={signalOptions.minConfidence} onChange={(value) => setSignalOptions(v => ({ ...v, minConfidence: value ?? v.minConfidence }))} />
              </label>
              <label className="ranking-setting-item switch">
                <span>納入頂底預測</span>
                <Switch size="small" checked={signalOptions.includePredictions} onChange={(checked) => setSignalOptions(v => ({ ...v, includePredictions: checked }))} />
              </label>
            </div>
          )}
        </div>
      )}

      {history.length < 90 ? (
        <div className="ranking-empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="歷史資料不足，建議至少累積 90 根 K 線後再比較排行。"
          />
        </div>
      ) : (
        <>
          {top && (
            <div className="ranking-summary-card">
              <div className="ranking-summary-top">
                <div>
                  <div className="ranking-summary-label">目前最佳</div>
                  <div className="ranking-summary-name">{top.pluginName}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Tag color={mode === 'trade' ? 'gold' : 'green'} style={{ margin: 0 }}>
                    {mode === 'trade' ? '交易表現最佳' : '信號命中率最佳'}
                  </Tag>
                  {top.pluginId === activePluginId ? (
                    <Tag color="green" style={{ margin: 0 }}>目前啟用</Tag>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      loading={activatingBest}
                      onClick={handleActivateBest}
                    >
                      套用最佳策略
                    </Button>
                  )}
                </div>
              </div>
              <div className="ranking-metrics-grid">
                {tradeTop
                  ? [
                      ['勝率', tradeTop.tradeStats ? `${(tradeTop.tradeStats.winRate * 100).toFixed(1)}%` : '-'],
                      ['總盈虧', tradeTop.tradeStats ? `${tradeTop.tradeStats.totalPnL >= 0 ? '+' : ''}$${tradeTop.tradeStats.totalPnL.toFixed(2)}` : '-'],
                      ['夏普值', tradeTop.tradeStats ? tradeTop.tradeStats.sharpeRatio.toFixed(2) : '-'],
                      ['回撤', tradeTop.tradeStats ? `${(tradeTop.tradeStats.maxDrawdown * 100).toFixed(1)}%` : '-'],
                    ].map(([label, value]) => (
                      <div key={label} className="ranking-metric-cell">
                        <div className="ranking-metric-label">{label}</div>
                        <div className="ranking-metric-value">{value}</div>
                      </div>
                    ))
                  : [
                      ['勝率', `${((signalTop?.stats.winRate ?? 0) * 100).toFixed(1)}%`],
                      ['平均報酬', `${((signalTop?.stats.avgReturn ?? 0) * 100).toFixed(2)}%`],
                      ['總信號數', `${signalTop?.stats.totalSignals ?? 0}`],
                      ['高信心次數', `${signalTop?.stats.highConfidence ?? 0}`],
                    ].map(([label, value]) => (
                      <div key={label} className="ranking-metric-cell">
                        <div className="ranking-metric-label">{label}</div>
                        <div className="ranking-metric-value">{value}</div>
                      </div>
                    ))}
              </div>
            </div>
          )}

          <div className="ranking-table">
            <div className="ranking-table-head">
              <span>排名</span>
              <span>策略</span>
              <span>{mode === 'trade' ? '勝率' : '信號勝率'}</span>
              <span>{mode === 'trade' ? '總盈虧' : '平均報酬'}</span>
              <span>{mode === 'trade' ? '夏普值' : '總信號數'}</span>
              <span>{mode === 'trade' ? '回撤' : '高信心次數'}</span>
            </div>

            {mode === 'trade'
              ? tradeRanking.map((row, index) => (
                  <div key={row.pluginId} className={`ranking-row ${index === 0 ? 'top' : ''}`}>
                    <span className="ranking-rank">#{index + 1}</span>
                    <span className="ranking-plugin-name">
                      {row.pluginName}
                      {row.pluginId === activePluginId && (
                        <Tag color="green" style={{ marginLeft: 8 }}>啟用中</Tag>
                      )}
                    </span>
                    <span>{row.tradeStats ? `${(row.tradeStats.winRate * 100).toFixed(1)}%` : '-'}</span>
                    <span className={(row.tradeStats?.totalPnL ?? 0) >= 0 ? 'pos' : 'neg'}>
                      {row.tradeStats ? `${row.tradeStats.totalPnL >= 0 ? '+' : ''}$${row.tradeStats.totalPnL.toFixed(2)}` : '-'}
                    </span>
                    <span>{row.tradeStats ? row.tradeStats.sharpeRatio.toFixed(2) : '-'}</span>
                    <Tooltip title={row.summary}>
                      <span>{row.tradeStats ? `${(row.tradeStats.maxDrawdown * 100).toFixed(1)}%` : '-'}</span>
                    </Tooltip>
                  </div>
                ))
              : signalRanking.map((row, index) => (
                  <div key={row.pluginId} className={`ranking-row ${index === 0 ? 'top' : ''}`}>
                    <span className="ranking-rank">#{index + 1}</span>
                    <span className="ranking-plugin-name">
                      {row.pluginName}
                      {row.pluginId === activePluginId && (
                        <Tag color="green" style={{ marginLeft: 8 }}>啟用中</Tag>
                      )}
                    </span>
                    <span>{`${(row.stats.winRate * 100).toFixed(1)}%`}</span>
                    <span className={row.stats.avgReturn >= 0 ? 'pos' : 'neg'}>{`${(row.stats.avgReturn * 100).toFixed(2)}%`}</span>
                    <span>{row.stats.totalSignals}</span>
                    <Tooltip title={row.summary}>
                      <span>{row.stats.highConfidence}</span>
                    </Tooltip>
                  </div>
                ))}
          </div>

          <Text className="ranking-footnote">
            {mode === 'trade'
              ? '交易排行依總盈虧、夏普值、勝率與獲利因子綜合排序。'
              : '信號排行依方向勝率、平均報酬與信號數量綜合排序。'}
          </Text>
        </>
      )}
    </div>
  );
};