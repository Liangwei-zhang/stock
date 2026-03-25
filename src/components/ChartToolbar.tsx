import React from 'react';
import { Tag } from 'antd';
import { assetTypeLabel, assetTypeColor } from '../services/searchService';
import { fmtPrice } from '../utils/format';
import { SOURCE_CONFIG } from '../utils/constants';
import { StockData, WatchlistItem } from '../types';

interface ChartToolbarProps {
  price:        number;
  changePercent: number;
  selectedItem:  WatchlistItem | undefined;
  source:        'real' | 'database' | 'simulated' | undefined;
}

export const ChartToolbar: React.FC<ChartToolbarProps> = React.memo(({
  price, changePercent, selectedItem, source,
}) => (
  <div className="chart-toolbar">
    <div className="chart-title-group">
      <div>
        <span className="chart-price-display">${fmtPrice(price)}</span>
        <span style={{ marginLeft: 8, fontSize: 13, color: changePercent >= 0 ? '#3fb950' : '#f85149', fontWeight: 500 }}>
          {changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {selectedItem && (
          <Tag color={assetTypeColor(selectedItem.assetType)} style={{ margin: 0 }}>
            {assetTypeLabel(selectedItem.assetType)}
          </Tag>
        )}
        {source && (
          <Tag
            color={source === 'real' ? 'success' : source === 'database' ? 'warning' : 'default'}
            style={{ margin: 0 }}
          >
            {SOURCE_CONFIG[source].dot} {SOURCE_CONFIG[source].label}
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
));

ChartToolbar.displayName = 'ChartToolbar';
