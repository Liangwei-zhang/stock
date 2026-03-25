import React from 'react';
import { Typography, Tag, Tooltip, Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { autoTradeService } from '../services/autoTradeService';
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

export const WatchlistSidebar: React.FC<Props> = ({
  stocks, selectedStock, onSelect, onRemove, onAddClick,
}) => {
  const { t } = useTranslation();
  const atCfg = autoTradeService.getConfig();

  return (
    <div className="watchlist-sidebar">
      <div className="sidebar-header">
        <Text className="sidebar-header-title">
          {t('app.watchlist')} {stocks.length > 0 && `· ${stocks.length}`}
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
            {t('app.addAssetHint')}
          </div>
        ) : stocks.map(({ stock: s, buy, sell }) => {
          const symOn  = atCfg.symbolsEnabled[s.symbol] ?? false;
          const active = atCfg.enabled && symOn;

          return (
            <div
              key={s.symbol}
              className={`watchlist-item ${selectedStock === s.symbol ? 'active' : ''}`}
              onClick={() => onSelect(s.symbol)}
            >
              <div className="wi-top">
                <span className="wi-symbol">{s.symbol}</span>
                <span className="wi-price">${fmtPrice(s.price)}</span>
              </div>
              <div className="wi-bottom">
                <span className="wi-name">{s.name}</span>
                <span className={`wi-change ${s.changePercent >= 0 ? 'pos' : 'neg'}`}>
                  {s.changePercent >= 0 ? '+' : ''}{s.changePercent.toFixed(2)}%
                </span>
              </div>
              <div className="wi-signals">
                {buy?.signal && (
                  <Tag color={buy.level === 'high' ? 'green' : 'lime'}
                    style={{ margin: 0, fontSize: 9, padding: '0 4px', lineHeight: '16px' }}>
                    买{buy.score}
                  </Tag>
                )}
                {sell?.signal && (
                  <Tag color={sell.level === 'high' ? 'red' : 'volcano'}
                    style={{ margin: 0, fontSize: 9, padding: '0 4px', lineHeight: '16px' }}>
                    卖{sell.score}
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
        })}
      </div>
    </div>
  );
};
