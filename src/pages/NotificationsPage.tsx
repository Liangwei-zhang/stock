import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, List, Button, Spin, Empty, Badge, message } from 'antd';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import { useAuth, useApi } from '../hooks/useAuth';
import { BottomNav } from '../components/BottomNav';

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
  stop_loss: '⛔',
  system: '🔔',
};

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#0d0d0d', color: '#fff', paddingBottom: 70 },
  header: { padding: '20px 16px 12px', background: '#141414', borderBottom: '1px solid #1f1f1f', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  item: { padding: '12px 16px', borderBottom: '1px solid #1f1f1f', cursor: 'default' },
  unread: { borderLeft: '3px solid #1677ff' },
  time: { fontSize: 11, color: '#595959' },
};

export const NotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const apiFetch = useApi();

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
      if (pg === 1) {
        setItems(res.items);
      } else {
        setItems(prev => [...prev, ...res.items]);
      }
      setTotal(res.total);
      setPage(pg);
    } catch {
      message.error('載入通知失敗');
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
      message.success('全部已讀');
    } catch {
      message.error('操作失敗');
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = items.filter(i => !i.is_read).length;

  const fmtTime = (s: string) => {
    const d = new Date(s);
    return d.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={5} style={{ color: '#fff', margin: 0 }}>
            <BellOutlined /> 通知記錄
          </Title>
          {unreadCount > 0 && <Badge count={unreadCount} />}
        </div>
        {unreadCount > 0 && (
          <Button
            type="text"
            size="small"
            icon={<CheckOutlined />}
            loading={markingAll}
            onClick={markAllRead}
            style={{ color: '#1677ff' }}
          >
            全部已讀
          </Button>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : items.length === 0 ? (
        <Empty description="暫無通知" style={{ padding: 60, color: '#595959' }} />
      ) : (
        <>
          <List
            dataSource={items}
            renderItem={item => (
              <div
                style={{
                  ...styles.item,
                  ...(item.is_read ? {} : styles.unread),
                  background: item.is_read ? 'transparent' : '#0d1117',
                }}
                onClick={() => !item.is_read && markRead(item.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text strong style={{ color: '#fff', fontSize: 14 }}>
                    {TYPE_ICON[item.type] ?? '🔔'} {item.title}
                  </Text>
                  {!item.is_read && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#1677ff', marginTop: 4 }} />
                  )}
                </div>
                {item.body && (
                  <Text style={{ color: '#8c8c8c', fontSize: 13, display: 'block', marginBottom: 4 }}>
                    {item.body}
                  </Text>
                )}
                <Text style={styles.time}>{fmtTime(item.created_at)}</Text>
              </div>
            )}
          />

          {items.length < total && (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <Button
                type="link"
                loading={loading}
                onClick={() => load(page + 1)}
              >
                載入更多
              </Button>
            </div>
          )}
        </>
      )}

      <BottomNav />
    </div>
  );
};
