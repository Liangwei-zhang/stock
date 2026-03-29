import React, { useState } from 'react';
import { Typography, Card, Tag, Badge, Button, Space } from 'antd';
import { CloseOutlined, CheckOutlined, DeleteOutlined } from '@ant-design/icons';
import { alertService } from '../services/alertService';
import { Alert } from '../types';

const { Text } = Typography;

/** Relative timestamp display */
function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)  return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const TYPE_ICON:  Record<string, string> = { buy: '🟢', sell: '🔴', top: '🔺', bottom: '🔻' };
const TYPE_LABEL: Record<string, string> = { buy: 'Buy', sell: 'Sell', top: 'Top', bottom: 'Bottom' };
const LV_LABEL:   Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const LV_COLOR:   Record<string, string> = { high: 'red', medium: 'orange', low: 'green' };

type LevelFilter = 'all' | 'high' | 'medium' | 'low';

interface Props {
  alerts:      Alert[];
  unreadCount: number;
  onClose:     () => void;
}

export const AlertPanel: React.FC<Props> = ({ alerts, unreadCount, onClose }) => {
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');

  const visible = levelFilter === 'all'
    ? alerts
    : alerts.filter(a => a.level === levelFilter);

  return (
    <div className="alert-overlay" onClick={onClose}>
      <div className="alert-panel alert-panel-enter" onClick={e => e.stopPropagation()}>

        <div className="alert-header">
          <Text strong style={{ color: '#183024' }}>
            Alerts
            {unreadCount > 0 && <Badge count={unreadCount} style={{ marginLeft: 6 }}/>}
          </Text>
          <Space>
            <Button type="text" size="small" icon={<CheckOutlined/>}
              onClick={() => alertService.markAllAsRead()}>Mark All Read</Button>
            <Button type="text" size="small" icon={<DeleteOutlined/>}
              onClick={() => alertService.clearAlerts()}>Clear</Button>
            <Button type="text" size="small" icon={<CloseOutlined/>} onClick={onClose}/>
          </Space>
        </div>

        {/* Level filter */}
        <div style={{ display: 'flex', gap: 6, padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>
          {(['all', 'high', 'medium', 'low'] as LevelFilter[]).map(lv => (
            <Button
              key={lv}
              size="small"
              type={levelFilter === lv ? 'primary' : 'text'}
              onClick={() => setLevelFilter(lv)}
              style={{ fontSize: 11, padding: '0 8px' }}
            >
              {lv === 'all' ? 'All' : LV_LABEL[lv]}
            </Button>
          ))}
        </div>

        <div className="alert-list">
          {visible.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔔</div>
              <Text style={{ color: '#7b9586', fontSize: 12 }}>No alerts yet</Text>
            </div>
          ) : visible.map(alert => (
            <Card
              key={alert.id}
              className={`alert-item ${alert.read ? 'read' : 'unread'}`}
              onClick={() => alertService.markAsRead(alert.id)}
            >
              <div className="alert-header-row">
                <span>{TYPE_ICON[alert.type]}</span>
                <span className="alert-symbol">{alert.symbol}</span>
                <Tag
                  color={LV_COLOR[alert.level]}
                  style={{ margin: 0, fontSize: 10 }}
                >
                  {LV_LABEL[alert.level]}
                </Tag>
                <span className="alert-time" title={new Date(alert.timestamp).toLocaleString()}>
                  {fmtRelative(alert.timestamp)}
                </span>
              </div>
              <div className="alert-type">
                {TYPE_LABEL[alert.type]} signal
                · ${alert.price.toFixed(alert.price >= 100 ? 2 : 4)} · {alert.score} pts
              </div>
              {(alert.takeProfit || alert.stopLoss) && (() => {
                const isLong = alert.type === 'buy' || alert.type === 'bottom';
                const upperVal = isLong ? alert.takeProfit : alert.stopLoss;
                const lowerVal = isLong ? alert.stopLoss   : alert.takeProfit;
                const upperLabel = isLong ? 'Target' : 'Risk';
                const lowerLabel = isLong ? 'Stop' : 'Target';
                const fmt = (v: number) => `$${v.toFixed(v >= 100 ? 2 : 4)}`;
                return (
                  <div style={{ display: 'flex', gap: 8, margin: '3px 0', fontSize: 11 }}>
                    {upperVal != null && upperVal > 0 && (
                      <span style={{ color: '#3fb950', fontWeight: 600 }}>
                        {upperLabel} {fmt(upperVal)}
                      </span>
                    )}
                    {lowerVal != null && lowerVal > 0 && (
                      <span style={{ color: '#f85149', fontWeight: 600 }}>
                        {lowerLabel} {fmt(lowerVal)}
                      </span>
                    )}
                    {alert.takeProfit && alert.stopLoss && (
                      <span style={{ color: '#7b9586', fontSize: 10 }}>
                        R:R {(Math.abs(alert.takeProfit - alert.price) / Math.abs(alert.stopLoss - alert.price)).toFixed(1)}:1
                      </span>
                    )}
                  </div>
                );
              })()}
              <div className="alert-reasons">
                {alert.reasons.slice(0, 3).map((r, i) =>
                  <span key={i} className="reason-tag ant-tag">{r}</span>
                )}
              </div>
            </Card>
          ))}
        </div>

      </div>
    </div>
  );
};

