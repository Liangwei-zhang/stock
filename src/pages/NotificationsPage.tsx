import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, List, Button, Spin, Empty, Badge, message } from 'antd';
import { BellOutlined, CheckOutlined, InboxOutlined } from '@ant-design/icons';
import { useAuth, useApi } from '../hooks/useAuth';
import { BottomNav } from '../components/BottomNav';
import { useI18n } from '../i18n';

const { Title, Text } = Typography;

interface NotifItem {
  id: string;
  type: string;
  title: string;
  body?: string;
  is_read: boolean;
  created_at: string;
}

interface PagedResponse {
  items: NotifItem[];
  total: number;
  page: number;
  limit: number;
}

const TYPE_ICON: Record<string, string> = {
  buy: '📈',
  sell: '🔔',
  stop_loss: '⚠️',
  system: '🔔',
};

export const NotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const apiFetch = useApi();
  const { t, formatDate } = useI18n();

  const [items, setItems] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);
  const LIMIT = 20;

  const load = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const res = await apiFetch<PagedResponse>(`/api/notifications?page=${pg}&limit=${LIMIT}`);
      const nextItems = Array.isArray(res.items) ? res.items : [];
      if (pg === 1) {
        setItems(nextItems);
      } else {
        setItems(prev => [...prev, ...nextItems]);
      }
      setTotal(res.total);
      setPage(pg);
    } catch {
      message.error(t('notifications.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    load(1);
  }, [user]);

  const markRead = async (id: string) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'PUT' });
      setItems(prev => prev.map(i => i.id === id ? { ...i, is_read: true } : i));
    } catch { /* silent */ }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await apiFetch('/api/notifications/read-all', { method: 'PUT' });
      setItems(prev => prev.map(i => ({ ...i, is_read: true })));
      message.success(t('notifications.markAllSuccess'));
    } catch {
      message.error(t('notifications.actionFailed'));
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = items.filter(i => !i.is_read).length;
  const readCount = items.length - unreadCount;
  const typeLabels: Record<string, string> = {
    buy: t('notifications.type.buy'),
    sell: t('notifications.type.sell'),
    stop_loss: t('notifications.type.stop_loss'),
    system: t('notifications.type.system'),
  };

  const fmtTime = (s: string) => {
    return formatDate(s, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="mobile-shell">
      <div className="mobile-shell__inner">
        <div className="mobile-premium-hero">
          <div className="mobile-premium-hero__top">
            <div className="mobile-premium-hero__copy">
              <div className="mobile-eyebrow">{t('notifications.eyebrow')}</div>
              <Title level={2} className="mobile-page-title" style={{ fontSize: 32, margin: 0 }}>
                {t('notifications.title')}
              </Title>
              <Text className="mobile-page-subtitle" style={{ display: 'block' }}>
                {t('notifications.subtitle')}
              </Text>
            </div>
            <div className="mobile-premium-hero__actions">
              {unreadCount > 0 ? (
                <Button className="mobile-ghost-action" icon={<CheckOutlined />} loading={markingAll} onClick={markAllRead}>
                  {t('notifications.markAll')}
                </Button>
              ) : null}
              <Button className="mobile-ghost-action" icon={<BellOutlined />} onClick={() => navigate('/watchlist')}>
                {t('notifications.watchlist')}
              </Button>
            </div>
          </div>
          <div className="mobile-inline-metrics">
            <span className="mobile-inline-metric">{t('notifications.metric.loaded')} <strong>{items.length}</strong></span>
            <span className="mobile-inline-metric">{t('notifications.metric.unread')} <strong>{unreadCount}</strong></span>
            <span className="mobile-inline-metric">{t('notifications.metric.read')} <strong>{readCount}</strong></span>
          </div>
        </div>

        <div className="mobile-summary-grid">
          <div className="mobile-summary-card">
            <div className="mobile-summary-label">{t('notifications.summary.total')}</div>
            <div className="mobile-summary-value">{items.length}</div>
            <div className="mobile-summary-caption">{t('notifications.summary.total.caption')}</div>
          </div>
          <div className="mobile-summary-card">
            <div className="mobile-summary-label">{t('notifications.summary.unread')}</div>
            <div className="mobile-summary-value">{unreadCount}</div>
            <div className="mobile-summary-caption">{t('notifications.summary.unread.caption')}</div>
          </div>
          <div className="mobile-summary-card">
            <div className="mobile-summary-label">{t('notifications.summary.read')}</div>
            <div className="mobile-summary-value">{readCount}</div>
            <div className="mobile-summary-caption">{t('notifications.summary.read.caption')}</div>
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className="mobile-panel" style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : items.length === 0 ? (
          <div className="mobile-panel mobile-empty">
            <Empty description={t('notifications.empty.title')} style={{ padding: 40, color: '#7b9586' }} image={<InboxOutlined style={{ fontSize: 42, color: '#67c98a' }} />} />
            <Button type="primary" onClick={() => navigate('/watchlist')}>{t('notifications.empty.action')}</Button>
          </div>
        ) : (
          <>
            <div className="mobile-panel">
              <div className="mobile-section-header">
                <div>
                  <div className="mobile-section-title">{t('notifications.timeline.title')}</div>
                  <div className="mobile-section-note">{t('notifications.timeline.note')}</div>
                </div>
                <span className="mobile-soft-tag">{t('notifications.timeline.pending', { count: unreadCount })}</span>
              </div>
              <List
                dataSource={items}
                renderItem={item => (
                  <div
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid rgba(93, 187, 123, 0.14)',
                      borderLeft: item.is_read ? '3px solid transparent' : '3px solid #77d7a2',
                      background: item.is_read ? 'rgba(255, 255, 255, 0.92)' : 'rgba(238, 249, 241, 0.98)',
                      borderRadius: 16,
                      marginBottom: 10,
                      border: '1px solid rgba(93, 187, 123, 0.14)',
                    }}
                    onClick={() => !item.is_read && markRead(item.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text strong style={{ color: '#183024', fontSize: 14 }}>
                        {TYPE_ICON[item.type] ?? '🔔'} {item.title}
                      </Text>
                      {!item.is_read && (
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#77d7a2', marginTop: 4 }} />
                      )}
                    </div>
                    <div className="mobile-chip-row" style={{ marginBottom: 8 }}>
                      <span className="mobile-soft-tag">{typeLabels[item.type] ?? t('notifications.type.default')}</span>
                      <span className="mobile-soft-tag">{item.is_read ? t('notifications.state.read') : t('notifications.state.unread')}</span>
                    </div>
                    {item.body && (
                      <Text style={{ color: '#5f7a6a', fontSize: 13, display: 'block', marginBottom: 4 }}>
                        {item.body}
                      </Text>
                    )}
                    <Text style={{ fontSize: 11, color: '#7b9586' }}>{fmtTime(item.created_at)}</Text>
                  </div>
                )}
              />
            </div>

            {items.length < total && (
              <div style={{ textAlign: 'center', padding: 16 }}>
                <Button
                  type="link"
                  loading={loading}
                  onClick={() => load(page + 1)}
                >
                  {t('notifications.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}

      </div>

      <BottomNav />
    </div>
  );
};
