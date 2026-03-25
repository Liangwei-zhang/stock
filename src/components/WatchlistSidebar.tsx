import React, { useEffect, useRef, useMemo } from 'react';
import { Typography, Tag, Tooltip, Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { autoTradeService } from '../services/autoTradeService';
import { stockService } from '../services/stockService';
import { StockData, SignalResult, WatchlistItem, DataSource } from '../types';

const { Text } = Typography;

interface StockRow {
  stock:  StockData;
  buy?:   SignalResult;
  sell?:  SignalResult;
  source: DataSource;
}

interface Props {
  stocks:         StockRow[];
  watchlistItems: WatchlistItem[];
  selectedStock:  string;
  onSelect:       (symbol: string) => void;
  onRemove:       (symbol: string, e: React.MouseEvent) => void;
  onAddClick:     () => void;
}

const fmtPrice = (p: number) =>
  p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p >= 0.01 ? p.toFixed(6) : p.toFixed(8);

/** Draws a mini sparkline on a canvas element */
const Sparkline: React.FC<{ symbol: string }> = ({ symbol }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const prices = useMemo(() => {
    const history = stockService.getStockHistory(symbol);
    return history.slice(-20).map(d => d.close ?? d.price);
  }, [symbol]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || prices.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const isUp = prices[prices.length - 1] >= prices[0];

    ctx.beginPath();
    ctx.strokeStyle = isUp ? '#4ade80' : '#f85149';
    ctx.lineWidth   = 1.2;
    prices.forEach((p, i) => {
      const x = (i / (prices.length - 1)) * w;
      const y = h - ((p - min) / range) * (h - 2) - 1;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [prices]);

  if (prices.length < 2) return null;
  return <canvas ref={canvasRef} width={60} height={20} className="wi-sparkline" />;
};

/** Watchlist item with price flash animation */
const WatchlistItemRow: React.FC<{
  stockRow: StockRow;
  selectedStock: string;
  onSelect: (symbol: string) => void;
  onRemove: (symbol: string, e: React.MouseEvent) => void;
}> = ({ stockRow: { stock: s, buy, sell }, selectedStock, onSelect, onRemove }) => {
  const prevPriceRef = useRef(s.price);
  const priceRef     = useRef<HTMLSpanElement>(null);
  const atCfg        = autoTradeService.getConfig();
  const symOn        = atCfg.symbolsEnabled[s.symbol] ?? false;
  const active       = atCfg.enabled && symOn;

  useEffect(() => {
    const el = priceRef.current;
    if (!el || s.price === prevPriceRef.current) return;
    const cls = s.price > prevPriceRef.current ? 'flash-up' : 'flash-down';
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth; // reflow to restart animation
    el.classList.add(cls);
    const t = setTimeout(() => el.classList.remove(cls), 500);
    prevPriceRef.current = s.price;
    return () => clearTimeout(t);
  }, [s.price]);

  return (
    <div
      key={s.symbol}
      className={`watchlist-item ${selectedStock === s.symbol ? 'active' : ''}`}
      onClick={() => onSelect(s.symbol)}
    >
      <div className="wi-top">
        <span className="wi-symbol">{s.symbol}</span>
        <span ref={priceRef} className="wi-price">${fmtPrice(s.price)}</span>
      </div>
      <div className="wi-bottom">
        <span className="wi-name">{s.name}</span>
        <span className={`wi-change ${s.changePercent >= 0 ? 'pos' : 'neg'}`}>
          {s.changePercent >= 0 ? '+' : ''}{s.changePercent.toFixed(2)}%
        </span>
      </div>
      <Sparkline symbol={s.symbol} />
      <div className="wi-signals">
        {buy?.signal && (
          <Tag color={buy.level === 'high' ? 'green' : 'lime'}
            style={{ margin: 0, fontSize: 9, padding: '0 4px', lineHeight: '16px' }}>
            買{buy.score}
          </Tag>
        )}
        {sell?.signal && (
          <Tag color={sell.level === 'high' ? 'red' : 'volcano'}
            style={{ margin: 0, fontSize: 9, padding: '0 4px', lineHeight: '16px' }}>
            賣{sell.score}
          </Tag>
        )}
        {active && <span className="wi-at-badge">⚡</span>}
        <Tooltip title="移除">
          <span
            style={{ marginLeft: 'auto', cursor: 'pointer', color: '#484f58', fontSize: 10 }}
            onClick={e => onRemove(s.symbol, e)}
          >✕</span>
        </Tooltip>
      </div>
    </div>
  );
};

export const WatchlistSidebar: React.FC<Props> = ({
  stocks, selectedStock, onSelect, onRemove, onAddClick,
}) => {
  return (
    <div className="watchlist-sidebar">
      <div className="sidebar-header">
        <Text className="sidebar-header-title">
          自選股 {stocks.length > 0 && `· ${stocks.length}`}
        </Text>
        <Button
          type="text" size="small" icon={<PlusOutlined/>}
          onClick={onAddClick}
          style={{ color: '#484f58', padding: 0 }}
        />
      </div>

      <div className="watchlist-items">
        {stocks.length === 0 ? (
          <div style={{ padding: '30px 10px', textAlign: 'center', color: '#484f58', fontSize: 12 }}>
            <div style={{ marginBottom: 8, fontSize: 20 }}>📋</div>
            點擊 + 添加資產
          </div>
        ) : stocks.map(row => (
          <WatchlistItemRow
            key={row.stock.symbol}
            stockRow={row}
            selectedStock={selectedStock}
            onSelect={onSelect}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
};

