import React from 'react';
import { Typography, Card, Tag, Badge, Button, Space } from 'antd';
import { CloseOutlined, CheckOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { alertService } from '../services/alertService';
import { Alert } from '../types';

const { Text } = Typography;

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleString('en-US', {
    timeZone: 'America/Edmonton',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });

interface Props {
  alerts:      Alert[];
  unreadCount: number;
  onClose:     () => void;
}

export const AlertPanel: React.FC<Props> = ({ alerts, unreadCount, onClose }) => {
  const { t } = useTranslation();
  return (
  <div className="alert-overlay" onClick={onClose}>
    <div className="alert-panel" onClick={e => e.stopPropagation()}>

      <div className="alert-header">
        <Text strong style={{ color: '#e6edf3' }}>
          {t('alerts.notifications')}
          {unreadCount > 0 && <Badge count={unreadCount} style={{ marginLeft: 6 }}/>}
        </Text>
        <Space>
          <Button type="text" size="small" icon={<CheckOutlined/>}
            onClick={() => alertService.markAllAsRead()}>{t('alerts.markAllRead')}</Button>
          <Button type="text" size="small" icon={<DeleteOutlined/>}
            onClick={() => alertService.clearAlerts()}>{t('alerts.clear')}</Button>
          <Button type="text" size="small" icon={<CloseOutlined/>} onClick={onClose}/>
        </Space>
      </div>

      <div className="alert-list">
        {alerts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔔</div>
            <Text style={{ color: '#484f58', fontSize: 12 }}>{t('alerts.noAlerts')}</Text>
          </div>
        ) : alerts.map(alert => (
          <Card
            key={alert.id}
            className={`alert-item ${alert.read ? 'read' : 'unread'}`}
            onClick={() => alertService.markAsRead(alert.id)}
          >
            <div className="alert-header-row">
              <span>
                {alert.type === 'buy' ? '🟢' : alert.type === 'sell' ? '🔴' : alert.type === 'top' ? '🔺' : '🔻'}
              </span>
              <span className="alert-symbol">{alert.symbol}</span>
              <Tag
                color={alert.level === 'high' ? 'red' : alert.level === 'medium' ? 'orange' : 'blue'}
                style={{ margin: 0, fontSize: 10 }}
              >
                {alert.level === 'high' ? t('alerts.high') : alert.level === 'medium' ? t('alerts.medium') : t('alerts.low')}
              </Tag>
              <span className="alert-time">{fmtTime(alert.timestamp)}</span>
            </div>
            <div className="alert-type">
              {alert.type === 'buy' ? t('alerts.buy') : alert.type === 'sell' ? t('alerts.sell') : alert.type === 'top' ? t('alerts.top') : t('alerts.bottom')}{t('alerts.signalSuffix')}
              · ${alert.price.toFixed(alert.price >= 100 ? 2 : 4)} · {t('alerts.scorePt', { score: alert.score })}
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
