import React from 'react';
import { Typography, Card, Tag, Badge, Button, Space } from 'antd';
import { CloseOutlined, CheckOutlined, DeleteOutlined } from '@ant-design/icons';
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

export const AlertPanel: React.FC<Props> = ({ alerts, unreadCount, onClose }) => (
  <div className="alert-overlay" onClick={onClose}>
    <div className="alert-panel" onClick={e => e.stopPropagation()}>

      <div className="alert-header">
        <Text strong style={{ color: '#e6edf3' }}>
          预警通知
          {unreadCount > 0 && <Badge count={unreadCount} style={{ marginLeft: 6 }}/>}
        </Text>
        <Space>
          <Button type="text" size="small" icon={<CheckOutlined/>}
            onClick={() => alertService.markAllAsRead()}>全部已读</Button>
          <Button type="text" size="small" icon={<DeleteOutlined/>}
            onClick={() => alertService.clearAlerts()}>清空</Button>
          <Button type="text" size="small" icon={<CloseOutlined/>} onClick={onClose}/>
        </Space>
      </div>

      <div className="alert-list">
        {alerts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔔</div>
            <Text style={{ color: '#484f58', fontSize: 12 }}>暂无预警通知</Text>
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
                {alert.level === 'high' ? '高' : alert.level === 'medium' ? '中' : '低'}
              </Tag>
              <span className="alert-time">{fmtTime(alert.timestamp)}</span>
            </div>
            <div className="alert-type">
              {alert.type === 'buy' ? '买入' : alert.type === 'sell' ? '卖出' : alert.type === 'top' ? '顶部' : '底部'}信号
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
