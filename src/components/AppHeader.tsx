import React from 'react';
import { Layout, Typography, Tooltip, Button, Badge, Space } from 'antd';
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

  return (
    <Header className="header">
      <div className="header-left">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="8" fill="#1890ff"/>
          <path d="M8 20L12 14L16 18L20 10L24 16" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="12" cy="14" r="2" fill="white"/>
          <circle cx="20" cy="10" r="2" fill="white"/>
        </svg>
        <Title level={5} className="header-title">股票智能預警</Title>
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
        <Tooltip title={isLive ? '已连接实时行情' : '使用模拟数据'}>
          <span style={{ fontSize: 12, color: isLive ? '#3fb950' : '#d29922' }}>
            {isLive ? <WifiOutlined/> : <DisconnectOutlined/>}
          </span>
        </Tooltip>
      </div>

      <div className="header-right">
        {/* 算法插件切换 */}
        <PluginSelector currentSymbol={selectedStock} onSwitch={onRefresh}/>

        {/* 数据源配置 */}
        <DataSourceConfig onUpdate={onRefresh}/>

        {/* 导出报表 */}
        <ExportButton symbol={selectedStock} disabled={!selectedStock}/>

        {/* 自动交易开关 */}
        <Tooltip title={atActive ? `自動交易：${atCount} 個標的監控中` : '自動交易已暫停'}>
          <Button
            size="small"
            onClick={() => { autoTradeService.setEnabled(!atCfg.enabled); onRefresh(); }}
            className={atActive ? 'auto-trade-active' : ''}
            style={{
              fontSize: 11,
              background: atActive ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.05)',
              borderColor: atActive ? 'rgba(74,222,128,0.35)' : 'rgba(255,255,255,0.1)',
              color: atActive ? '#4ade80' : '#8b949e',
            }}
            icon={<span style={{ fontSize: 12, color: atActive ? '#4ade80' : '#8b949e' }}>⚡</span>}
          >
            {atActive ? `自動 ${atCount}` : '自動'}
          </Button>
        </Tooltip>

        <Tooltip title="搜索並添加資產">
          <Button icon={<PlusOutlined/>} size="small" onClick={onAddClick}>添加</Button>
        </Tooltip>

        <Badge count={unreadCount} size="small" offset={[-2, 2]}>
          <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }}/>}
            className={`alert-button${unreadCount > 0 ? ' alert-badge-bounce' : ''}`}
            onClick={onAlertClick}/>
        </Badge>
      </div>
    </Header>
  );
};
