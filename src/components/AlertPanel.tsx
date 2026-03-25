import React, { useState } from 'react';
import { Typography, Card, Tag, Badge, Button, Space } from 'antd';
import { CloseOutlined, CheckOutlined, DeleteOutlined } from '@ant-design/icons';
import { alertService } from '../services/alertService';
import { Alert } from '../types';

const { Text } = Typography;

/** Relative timestamp display */
function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)  return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

const TYPE_ICON:  Record<string, string> = { buy: '🟢', sell: '🔴', top: '🔺', bottom: '🔻' };
const TYPE_LABEL: Record<string, string> = { buy: '買入', sell: '賣出', top: '頂部', bottom: '底部' };
const LV_LABEL:   Record<string, string> = { high: '高', medium: '中', low: '低' };
const LV_COLOR:   Record<string, string> = { high: 'red', medium: 'orange', low: 'blue' };

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
          <Text strong style={{ color: '#e6edf3' }}>
            預警通知
            {unreadCount > 0 && <Badge count={unreadCount} style={{ marginLeft: 6 }}/>}
          </Text>
          <Space>
            <Button type="text" size="small" icon={<CheckOutlined/>}
              onClick={() => alertService.markAllAsRead()}>全部已讀</Button>
            <Button type="text" size="small" icon={<DeleteOutlined/>}
              onClick={() => alertService.clearAlerts()}>清空</Button>
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
              {lv === 'all' ? '全部' : LV_LABEL[lv]}
            </Button>
          ))}
        </div>

        <div className="alert-list">
          {visible.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔔</div>
              <Text style={{ color: '#484f58', fontSize: 12 }}>暫無預警通知</Text>
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
                {TYPE_LABEL[alert.type]}信號
                · ${alert.price.toFixed(alert.price >= 100 ? 2 : 4)} · {alert.score}分
              </div>
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

