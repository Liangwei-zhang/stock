import React from 'react';
import { Layout, Typography, Tooltip, Button, Badge } from 'antd';
import { BellOutlined, PlusOutlined, WifiOutlined, DisconnectOutlined } from '@ant-design/icons';
import { autoTradeService } from '../services/autoTradeService';
import { PluginSelector }   from './PluginSelector';
import { DataSourceConfig } from './DataSourceConfig';
import { ExportButton }     from './ExportButton';
import { DataSource }       from '../types';

const { Header } = Layout;
const { Title, Text } = Typography;

interface Props {
  currentTime:   Date;
  stocks:        { source: DataSource }[];
  unreadCount:   number;
  selectedStock: string;
  onAddClick:    () => void;
  onAlertClick:  () => void;
  onRefresh:     () => void;
}

export const AppHeader: React.FC<Props> = ({
  currentTime, stocks, unreadCount, selectedStock,
  onAddClick, onAlertClick, onRefresh,
}) => {
  const atCfg    = autoTradeService.getConfig();
  const atActive = atCfg.enabled && Object.values(atCfg.symbolsEnabled).some(Boolean);
  const atCount  = Object.values(atCfg.symbolsEnabled).filter(Boolean).length;
  const isLive   = stocks.some(s => s.source === 'real');
  const focusLabel = selectedStock ? `Focus ${selectedStock}` : 'No Symbol Selected';

  return (
    <Header className="header">
      <div className="header-left">
        <div className="header-logo">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#77d7a2"/>
            <path d="M8 20L12 14L16 18L20 10L24 16" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="12" cy="14" r="2" fill="white"/>
            <circle cx="20" cy="10" r="2" fill="white"/>
          </svg>
        </div>
        <div className="header-brand">
          <Title level={5} className="header-title">Stock Signal</Title>
          <Text className="header-subtitle">Quant Monitoring and Trading Workspace</Text>
        </div>
      </div>

      <div className="header-center">
        <Text className="time-display">
          {currentTime.toLocaleString('en-US', {
            timeZone: 'America/Edmonton',
            month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
          })}
        </Text>
        <Tooltip title={isLive ? 'Connected to live market data' : 'Using simulated market data'}>
          <span className={`header-status-pill ${isLive ? 'live' : 'delayed'}`}>
            {isLive ? <WifiOutlined/> : <DisconnectOutlined/>}
            {isLive ? 'Live Feed' : 'Simulated'}
          </span>
        </Tooltip>
        <span className="header-focus-pill">{focusLabel}</span>
      </div>

      <div className="header-right">
        <div className="header-actions-shell">
        <PluginSelector currentSymbol={selectedStock} onSwitch={onRefresh}/>
        <DataSourceConfig onUpdate={onRefresh}/>
        <ExportButton symbol={selectedStock} disabled={!selectedStock}/>
        <Tooltip title={atActive ? `Auto-trading active on ${atCount} symbols` : 'Auto-trading is paused'}>
          <Button
            size="small"
            onClick={() => { autoTradeService.setEnabled(!atCfg.enabled); onRefresh(); }}
            className={atActive ? 'auto-trade-active' : ''}
            style={{
              fontSize: 11,
              height: 22,
              paddingBlock: 0,
              paddingInline: 8,
              background: atActive ? 'rgba(103, 201, 138, 0.16)' : '#f4faf6',
              borderColor: atActive ? 'rgba(103, 201, 138, 0.35)' : 'rgba(93, 187, 123, 0.18)',
              color: atActive ? '#2f7d4b' : '#6b8576',
            }}
            icon={<span style={{ fontSize: 12, color: atActive ? '#2f7d4b' : '#6b8576' }}>⚡</span>}
          >
            {atActive ? `Auto ${atCount}` : 'Auto'}
          </Button>
        </Tooltip>

        <Tooltip title="Search and add symbols">
          <Button icon={<PlusOutlined/>} size="small" onClick={onAddClick}>Add</Button>
        </Tooltip>

        <Badge count={unreadCount} size="small" offset={[-2, 2]}>
          <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }}/>}
            className={`alert-button${unreadCount > 0 ? ' alert-badge-bounce' : ''}`}
            onClick={onAlertClick}/>
        </Badge>
        </div>
      </div>
    </Header>
  );
};
