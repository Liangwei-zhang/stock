import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography, List, Switch, Button, Modal, Input,
  Spin, message, Empty, Slider, Tag, Popconfirm,
} from 'antd';
import { PlusOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { useAuth, useApi } from '../hooks/useAuth';
import { BottomNav } from '../components/BottomNav';

const { Title, Text } = Typography;

interface WatchItem {
  id: string;
  symbol: string;
  notify: boolean;
  min_score: number;
  created_at: string;
}

interface SearchResult {
  symbol: string;
  name: string;
  asset_type: string;
  exchange?: string;
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#0d0d0d', color: '#fff', paddingBottom: 70 },
  header: { padding: '20px 16px 12px', background: '#141414', borderBottom: '1px solid #1f1f1f', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  section: { padding: '0 16px' },
  item: { background: '#141414', borderRadius: 10, padding: '12px 16px', margin: '10px 0' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  subtext: { fontSize: 12, color: '#8c8c8c' },
  scoreLabel: { fontSize: 11, color: '#faad14' },
};

export const WatchlistPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const apiFetch = useApi();

  const [items, setItems] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [minScore, setMinScore] = useState(65);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    load();
  }, [user]);

  const load = () => {
    setLoading(true);
    apiFetch<WatchItem[]>('/api/watchlist')
      .then(setItems)
      .catch(() => message.error('載入關注列表失敗'))
      .finally(() => setLoading(false));
  };

  const handleSearch = async (q: string) => {
    setSearchQ(q);
    if (q.length < 1) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await apiFetch<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}&limit=15`);
      setSearchResults(res);
    } catch {
      // silent
    } finally {
      setSearching(false);
    }
  };

  const handleAdd = async (sr: SearchResult) => {
    try {
      await apiFetch('/api/watchlist', {
        method: 'POST',
        body: JSON.stringify({ symbol: sr.symbol, min_score: minScore, notify: true }),
      });
      message.success(`已添加 ${sr.symbol}`);
      setSearchOpen(false);
      setSearchQ('');
      setSearchResults([]);
      load();
    } catch (err: any) {
      message.error(err.message || '添加失敗');
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
      message.error('更新失敗');
    }
  };

  const handleDelete = async (id: string, symbol: string) => {
    try {
      await apiFetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      message.success(`已移除 ${symbol}`);
      setItems(prev => prev.filter(i => i.id !== id));
    } catch {
      message.error('刪除失敗');
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <Title level={5} style={{ color: '#fff', margin: 0 }}>⭐ 我的關注</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          size="small"
          onClick={() => setSearchOpen(true)}
        >
          添加
        </Button>
      </div>

      <div style={styles.section}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : items.length === 0 ? (
          <Empty description="暫無關注" style={{ padding: 40, color: '#595959' }} />
        ) : (
          items.map(item => (
            <div key={item.id} style={styles.item}>
              <div style={styles.row}>
                <Text strong style={{ color: '#fff', fontSize: 16 }}>{item.symbol}</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Switch
                    size="small"
                    checked={item.notify}
                    onChange={(v) => handleToggleNotify(item, v)}
                  />
                  <Popconfirm
                    title={`確認移除 ${item.symbol}？`}
                    onConfirm={() => handleDelete(item.id, item.symbol)}
                    okText="移除"
                    cancelText="取消"
                  >
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      size="small"
                    />
                  </Popconfirm>
                </div>
              </div>
              <div style={styles.row}>
                <Text style={styles.subtext}>
                  {item.notify ? '推送開啟' : '推送關閉'}
                </Text>
                <Text style={styles.scoreLabel}>
                  靈敏度 ≥ {item.min_score}
                </Text>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 搜索添加彈窗 */}
      <Modal
        open={searchOpen}
        title="搜索標的"
        footer={null}
        onCancel={() => { setSearchOpen(false); setSearchQ(''); setSearchResults([]); }}
        styles={{ content: { background: '#141414' }, header: { background: '#141414', color: '#fff' } }}
      >
        <div style={{ marginBottom: 12 }}>
          <Text style={{ color: '#8c8c8c', fontSize: 12 }}>靈敏度（最低信號分）：{minScore}</Text>
          <Slider
            min={50}
            max={90}
            step={5}
            value={minScore}
            onChange={setMinScore}
            marks={{ 50: '50', 65: '65', 75: '75', 90: '90' }}
          />
        </div>

        <Input
          prefix={<SearchOutlined />}
          placeholder="輸入股票代碼，如 AAPL、BTC..."
          value={searchQ}
          onChange={e => handleSearch(e.target.value)}
          allowClear
          autoFocus
          style={{ background: '#1f1f1f', border: '1px solid #303030', color: '#fff' }}
        />

        {searching && <div style={{ textAlign: 'center', padding: 16 }}><Spin size="small" /></div>}

        <List
          style={{ marginTop: 8, maxHeight: 300, overflowY: 'auto' }}
          dataSource={searchResults}
          renderItem={sr => (
            <List.Item
              style={{ cursor: 'pointer', padding: '10px 0', borderBottom: '1px solid #1f1f1f' }}
              onClick={() => handleAdd(sr)}
            >
              <div>
                <Text strong style={{ color: '#fff' }}>{sr.symbol}</Text>
                <Text style={{ color: '#8c8c8c', marginLeft: 8, fontSize: 13 }}>{sr.name}</Text>
                <Tag style={{ marginLeft: 8 }} color="blue">{sr.asset_type}</Tag>
              </div>
            </List.Item>
          )}
        />
      </Modal>

      <BottomNav />
    </div>
  );
};
