import React, { useState, useEffect } from 'react';
import { ConfigProvider, theme, Layout, Typography, Tag, Button, Spin } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { alertService }     from './services/alertService';
import { indicatorService } from './services/indicatorService';
import { stockService }     from './services/stockService';
import { assetTypeLabel, assetTypeColor } from './services/searchService';
import { useStockData }       from './hooks/useStockData';
import { useChart }           from './hooks/useChart';
import { AppHeader }          from './components/AppHeader';
import { WatchlistSidebar }   from './components/WatchlistSidebar';
import { AnalysisGrid }       from './components/AnalysisGrid';
import { TradingSection }     from './components/TradingSection';
import { AlertPanel }         from './components/AlertPanel';
import { SearchModal }        from './components/SearchModal';
import { Alert, WatchlistItem } from './types';
import './App.css';

const { Content } = Layout;
const { Text }    = Typography;

const SOURCE_CONFIG = {
  real:      { label: '实时', dot: '🟢' },
  database:  { label: '缓存', dot: '🟡' },
  simulated: { label: '模拟', dot: '⚪' },
} as const;

const App: React.FC = () => {
  // ── 全局 UI 状态 ────────────────────────────────────────────────────────────
  const [selectedStock,  setSelectedStock]  = useState('');
  const [alertVisible,   setAlertVisible]   = useState(false);
  const [searchVisible,  setSearchVisible]  = useState(false);
  const [currentTime,    setCurrentTime]    = useState(() => new Date());
  const [alerts,         setAlerts]         = useState<Alert[]>([]);
  const [unreadCount,    setUnreadCount]    = useState(0);

  // ── 时钟 ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── 预警回调 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const sync = () => {
      setAlerts([...alertService.getAlerts()]);
      setUnreadCount(alertService.getUnreadCount());
    };
    alertService.setOnChange(sync);
    return () => alertService.setOnChange(() => {});
  }, []);

  // ── 数据层 Hook ─────────────────────────────────────────────────────────────
  const {
    initialized, stocks, watchlistItems, refreshKey,
    handleAdd, handleRemove, updateUI,
  } = useStockData();

  // 初始化完成后选中第一支
  useEffect(() => {
    if (initialized && !selectedStock && watchlistItems.length > 0) {
      setSelectedStock(watchlistItems[0].symbol);
    }
  }, [initialized, watchlistItems]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── 图表 Hook ───────────────────────────────────────────────────────────────
  const { setChartContainer } = useChart({ selectedStock, refreshKey });

  // ── 衍生数据 ────────────────────────────────────────────────────────────────
  const analysis     = selectedStock ? indicatorService.analyzeStock(selectedStock) : null;
  const selectedMeta = selectedStock ? stockService.getSymbolMeta(selectedStock)   : null;
  const selectedItem = watchlistItems.find(w => w.symbol === selectedStock);

  const fmtPrice = (p: number) =>
    p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p >= 0.01 ? p.toFixed(6) : p.toFixed(8);

  const handleRemoveWithSelect = async (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await handleRemove(symbol);
    const wl = stockService.getWatchlist();
    if (selectedStock === symbol) setSelectedStock(wl[0]?.symbol ?? '');
  };

  // ── 加载态 ──────────────────────────────────────────────────────────────────
  if (!initialized) {
    return (
      <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1117' }}>
          <div style={{ textAlign: 'center' }}>
            <Spin size="large"/>
            <div style={{ color: '#8b949e', marginTop: 16, fontSize: 14 }}>正在加载数据…</div>
          </div>
        </div>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: {
      colorPrimary: '#1890ff', colorBgContainer: '#1c2333', colorBgElevated: '#1c2333',
      colorText: '#e6edf3', colorTextSecondary: '#8b949e', borderRadius: 8,
    }}}>
      <Layout className="app">

        <AppHeader
          currentTime={currentTime}
          stocks={stocks}
          unreadCount={unreadCount}
          selectedStock={selectedStock}
          onAddClick={() => setSearchVisible(true)}
          onAlertClick={() => setAlertVisible(true)}
          onRefresh={() => updateUI()}
        />

        <div className="main-layout">

          <WatchlistSidebar
            stocks={stocks}
            watchlistItems={watchlistItems}
            selectedStock={selectedStock}
            onSelect={setSelectedStock}
            onRemove={handleRemoveWithSelect}
            onAddClick={() => setSearchVisible(true)}
          />

          <div className="content-area">
            <div className="content-scroll">

              {!selectedStock || !analysis ? (
                <div className="empty-state">
                  <div className="empty-state-icon">📊</div>
                  <Text style={{ color: '#8b949e' }}>从左侧选择或添加资产以查看分析</Text>
                  <Button type="primary" icon={<PlusOutlined/>} onClick={() => setSearchVisible(true)}>添加资产</Button>
                </div>
              ) : (
                <>
                  {/* ── K 线图 ── */}
                  <div className="chart-wrapper">
                    <div className="chart-toolbar">
                      <div className="chart-title-group">
                        <div>
                          <span className="chart-price-display">${fmtPrice(analysis.price)}</span>
                          {(() => {
                            const chg = stocks.find(s => s.stock.symbol === selectedStock)?.stock.changePercent ?? 0;
                            return (
                              <span style={{ marginLeft: 8, fontSize: 13, color: chg >= 0 ? '#3fb950' : '#f85149', fontWeight: 500 }}>
                                {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
                              </span>
                            );
                          })()}
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {selectedItem && <Tag color={assetTypeColor(selectedItem.assetType)} style={{ margin: 0 }}>{assetTypeLabel(selectedItem.assetType)}</Tag>}
                          {selectedMeta && (
                            <Tag color={selectedMeta.source === 'real' ? 'success' : selectedMeta.source === 'database' ? 'warning' : 'default'} style={{ margin: 0 }}>
                              {SOURCE_CONFIG[selectedMeta.source].dot} {SOURCE_CONFIG[selectedMeta.source].label}
                            </Tag>
                          )}
                        </div>
                      </div>
                      <div className="chart-legend">
                        {[['MA5', '#1890ff'], ['MA10', '#faad14'], ['MA20', '#722ed1']].map(([l, c]) => (
                          <span key={l} className="legend-item">
                            <span className="legend-dot" style={{ background: c }}/>
                            {l}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="chart-container" ref={setChartContainer}/>
                  </div>

                  {/* ── 分析卡片 ── */}
                  <AnalysisGrid
                    analysis={analysis}
                    selectedStock={selectedStock}
                    onRefresh={updateUI}
                  />
                </>
              )}
            </div>

            {/* ── 交易面板 ── */}
            <TradingSection
              stocks={stocks}
              watchlistItems={watchlistItems}
              refreshKey={refreshKey}
              onRefresh={updateUI}
            />
          </div>
        </div>

        {/* ── 预警浮层 ── */}
        {alertVisible && (
          <AlertPanel
            alerts={alerts}
            unreadCount={unreadCount}
            onClose={() => setAlertVisible(false)}
          />
        )}

        <SearchModal
          visible={searchVisible}
          watchlist={watchlistItems.map(w => w.symbol)}
          onClose={() => setSearchVisible(false)}
          onAdd={async (item) => { await handleAdd(item); }}
        />

      </Layout>
    </ConfigProvider>
  );
};

export default App;
