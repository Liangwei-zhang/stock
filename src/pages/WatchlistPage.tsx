import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography, List, Switch, Button, Modal, Input,
  Spin, message, Empty, Tag, Popconfirm,
} from 'antd';
import { BellOutlined, ClockCircleOutlined, DeleteOutlined, PlusOutlined, SearchOutlined, StarOutlined } from '@ant-design/icons';
import { useAuth, useApi } from '../hooks/useAuth';
import { BottomNav } from '../components/BottomNav';
import { useI18n } from '../i18n';

const { Title, Text } = Typography;

interface WatchItem {
  id: string;
  symbol: string;
  notify: boolean;
  created_at: string;
}

interface SearchResult {
  symbol: string;
  name: string;
  asset_type: string;
  exchange?: string;
}

interface SearchResponse {
  items: SearchResult[];
  query: string;
}

export const WatchlistPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const apiFetch = useApi();
  const { t, formatDate } = useI18n();

  const [items, setItems] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    load();
  }, [user]);

  const load = () => {
    setLoading(true);
    apiFetch<WatchItem[]>('/api/watchlist')
      .then(setItems)
      .catch(() => message.error(t('watchlist.loadFailed')))
      .finally(() => setLoading(false));
  };

  const handleSearch = async (q: string) => {
    setSearchQ(q);
    if (q.length < 1) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await apiFetch<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}&limit=15`);
      setSearchResults(Array.isArray(res.items) ? res.items : []);
    } catch {
      setSearchResults([]);
      // silent
    } finally {
      setSearching(false);
    }
  };

  const handleAdd = async (sr: SearchResult) => {
    try {
      await apiFetch('/api/watchlist', {
        method: 'POST',
        body: JSON.stringify({ symbol: sr.symbol, notify: true }),
      });
      message.success(t('watchlist.addSuccess', { symbol: sr.symbol }));
      setSearchOpen(false);
      setSearchQ('');
      setSearchResults([]);
      load();
    } catch (err: any) {
      message.error(err.message || t('watchlist.addFailed'));
    }
  };

  const handleToggleNotify = async (item: WatchItem, notify: boolean) => {
    try {
      await apiFetch(`/api/watchlist/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ notify }),
      });
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, notify } : i));
    } catch {
      message.error(t('watchlist.updateFailed'));
    }
  };

  const handleDelete = async (id: string, symbol: string) => {
    try {
      await apiFetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      message.success(t('watchlist.removeSuccess', { symbol }));
      setItems(prev => prev.filter(i => i.id !== id));
    } catch {
      message.error(t('watchlist.removeFailed'));
    }
  };

  const fmtDate = (value: string) =>
    formatDate(value, { month: 'short', day: 'numeric' });

  const alertsEnabled = items.filter(item => item.notify).length;
  const latestAdd = items.length > 0
    ? [...items].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0]
    : null;

  return (
    <div className="mobile-shell">
      <div className="mobile-shell__inner">
        <div className="mobile-premium-hero">
          <div className="mobile-premium-hero__top">
            <div className="mobile-premium-hero__copy">
              <div className="mobile-eyebrow">{t('watchlist.eyebrow')}</div>
              <Title level={2} className="mobile-page-title" style={{ fontSize: 32, margin: 0 }}>
                {t('watchlist.title')}
              </Title>
              <Text className="mobile-page-subtitle" style={{ display: 'block' }}>
                {t('watchlist.subtitle')}
              </Text>
            </div>
            <div className="mobile-premium-hero__actions">
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setSearchOpen(true)}>
                {t('watchlist.addSymbol')}
              </Button>
              <Button className="mobile-ghost-action" icon={<BellOutlined />} onClick={() => navigate('/notifications')}>
                {t('watchlist.inbox')}
              </Button>
            </div>
          </div>
          <div className="mobile-inline-metrics">
            <span className="mobile-inline-metric">{t('watchlist.metric.tracked')} <strong>{items.length}</strong></span>
            <span className="mobile-inline-metric">{t('watchlist.metric.alerts')} <strong>{alertsEnabled}</strong></span>
            <span className="mobile-inline-metric">{t('watchlist.metric.latest')} <strong>{latestAdd ? latestAdd.symbol : '—'}</strong></span>
          </div>
        </div>

        <div className="mobile-summary-grid">
          <div className="mobile-summary-card">
            <div className="mobile-summary-label">{t('watchlist.summary.tracked')}</div>
            <div className="mobile-summary-value">{items.length}</div>
            <div className="mobile-summary-caption">{t('watchlist.summary.tracked.caption')}</div>
          </div>
          <div className="mobile-summary-card">
            <div className="mobile-summary-label">{t('watchlist.summary.alertsOn')}</div>
            <div className="mobile-summary-value">{alertsEnabled}</div>
            <div className="mobile-summary-caption">{t('watchlist.summary.alertsOn.caption')}</div>
          </div>
          <div className="mobile-summary-card">
            <div className="mobile-summary-label">{t('watchlist.summary.latestAdd')}</div>
            <div className="mobile-summary-value">{latestAdd ? latestAdd.symbol : '—'}</div>
            <div className="mobile-summary-caption">{latestAdd ? t('watchlist.summary.latestAdd.caption', { date: fmtDate(latestAdd.created_at) }) : t('watchlist.summary.latestAdd.empty')}</div>
          </div>
        </div>

        <div className="mobile-panel mobile-panel--highlight">
          <div className="mobile-section-header">
            <div>
              <div className="mobile-section-title">{t('watchlist.section.title')}</div>
              <div className="mobile-section-note">{t('watchlist.section.note')}</div>
            </div>
            <span className="mobile-soft-tag"><StarOutlined /> {t('watchlist.section.tag')}</span>
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : items.length === 0 ? (
            <div className="mobile-empty">
              <Empty description={t('watchlist.empty.title')} style={{ padding: 20, color: '#7b9586' }} />
              <Button type="primary" onClick={() => setSearchOpen(true)}>{t('watchlist.empty.action')}</Button>
            </div>
          ) : (
            <div className="mobile-list">
              {items.map(item => (
                <div key={item.id} className="mobile-list-card mobile-list-card--active">
                  <div className="mobile-list-row">
                    <div>
                      <Text strong className="mobile-symbol">{item.symbol}</Text>
                      <div className="mobile-allocation-meta" style={{ marginTop: 6 }}>
                        <span>{item.notify ? t('watchlist.item.alertsEnabled') : t('watchlist.item.alertsPaused')}</span>
                        <span>{t('watchlist.item.added', { date: fmtDate(item.created_at) })}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Switch
                        size="small"
                        checked={item.notify}
                        onChange={(value) => handleToggleNotify(item, value)}
                      />
                      <Popconfirm
                        title={t('watchlist.removeConfirm', { symbol: item.symbol })}
                        onConfirm={() => handleDelete(item.id, item.symbol)}
                        okText={t('common.remove')}
                        cancelText={t('common.cancel')}
                      >
                        <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                      </Popconfirm>
                    </div>
                  </div>
                  <div className="mobile-chip-row" style={{ marginTop: 12 }}>
                    <span className="mobile-soft-tag mobile-soft-tag--list">
                      <BellOutlined /> {item.notify ? t('watchlist.tag.alertsOn') : t('watchlist.tag.alertsOff')}
                    </span>
                    <span className="mobile-soft-tag mobile-soft-tag--list">
                      <ClockCircleOutlined /> {fmtDate(item.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={searchOpen}
        title={t('watchlist.search.title')}
        footer={null}
        rootClassName="mobile-modal"
        onCancel={() => { setSearchOpen(false); setSearchQ(''); setSearchResults([]); }}
        styles={{ content: { background: '#ffffff' }, header: { background: '#ffffff', color: '#183024' } }}
      >
        <Input
          prefix={<SearchOutlined />}
          placeholder={t('watchlist.search.placeholder')}
          value={searchQ}
          onChange={e => handleSearch(e.target.value)}
          allowClear
          autoFocus
          style={{ background: '#ffffff', border: '1px solid rgba(93, 187, 123, 0.18)', color: '#183024' }}
        />

        {searching && <div style={{ textAlign: 'center', padding: 16 }}><Spin size="small" /></div>}

        <List
          style={{ marginTop: 8, maxHeight: 300, overflowY: 'auto' }}
          dataSource={searchResults}
          locale={{ emptyText: searchQ ? t('watchlist.search.empty') : t('watchlist.search.start') }}
          renderItem={sr => (
            <List.Item
              style={{ cursor: 'pointer', padding: '10px 0', borderBottom: '1px solid rgba(93, 187, 123, 0.14)' }}
              onClick={() => handleAdd(sr)}
            >
              <div>
                <Text strong style={{ color: '#183024' }}>{sr.symbol}</Text>
                <Text style={{ color: '#5f7a6a', marginLeft: 8, fontSize: 13 }}>{sr.name}</Text>
                <Tag style={{ marginLeft: 8 }} color="green">{sr.asset_type}</Tag>
                {sr.exchange && <Tag style={{ marginLeft: 8 }} color="default">{sr.exchange}</Tag>}
              </div>
            </List.Item>
          )}
        />
      </Modal>

      <BottomNav />
    </div>
  );
};
