import React, { useState, useEffect, useRef } from 'react';
import { Input, Tag, Typography, Spin, Empty, Button } from 'antd';
import { SearchOutlined, PlusOutlined, CheckOutlined, StarOutlined } from '@ant-design/icons';
import { SearchResult } from '../types';
import { searchSymbols, assetTypeColor, POPULAR_ASSETS } from '../services/searchService';
import { getDesktopAssetTypeLabel } from '../utils/desktopLabels';

const { Text } = Typography;

interface Props {
  visible:   boolean;
  watchlist: string[];
  onClose:   () => void;
  onAdd:     (item: SearchResult) => void;
}

export const SearchModal: React.FC<Props> = ({ visible, watchlist, onClose, onAdd }) => {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<SearchResult[]>(POPULAR_ASSETS);
  const [loading,  setLoading]  = useState(false);
  const inputRef: any           = useRef(null);
  const timerRef                = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults(POPULAR_ASSETS);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!query.trim()) { setResults(POPULAR_ASSETS); setLoading(false); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      const res = await searchSymbols(query);
      setResults(res);
      setLoading(false);
    }, 350);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  if (!visible) return null;

  const categories = query.trim()
    ? null
    : [
        { label: '🏆 熱門股票', items: POPULAR_ASSETS.filter(a => a.assetType === 'equity') },
        { label: '📦 期貨（金屬 / 商品）', items: POPULAR_ASSETS.filter(a => a.assetType === 'futures') },
        { label: '📊 ETF', items: POPULAR_ASSETS.filter(a => a.assetType === 'etf') },
        { label: '📈 指數', items: POPULAR_ASSETS.filter(a => a.assetType === 'index') },
      ];

  const renderItem = (item: SearchResult) => {
    const added = watchlist.includes(item.symbol);
    return (
      <div key={item.symbol} style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px', borderRadius: 8, marginBottom: 4,
        background: '#f7fcf8',
        border: '1px solid rgba(103, 201, 138, 0.14)',
        transition: 'background .2s',
        cursor: added ? 'default' : 'pointer',
      }}
        onMouseEnter={e => (e.currentTarget.style.background = '#eef9f1')}
        onMouseLeave={e => (e.currentTarget.style.background = '#f7fcf8')}
      >
        <Text style={{ fontFamily: 'SF Mono, Cascadia Mono, Consolas, Roboto Mono, Courier New, monospace', fontSize: 14, fontWeight: 600, color: '#183024', minWidth: 72 }}>
          {item.symbol}
        </Text>
        <Text style={{ flex: 1, color: '#5f7a6a', fontSize: 13 }} ellipsis>
          {item.name}
        </Text>
        <Tag color={assetTypeColor(item.assetType)} style={{ margin: 0, fontSize: 11 }}>
          {getDesktopAssetTypeLabel(item.assetType)}
        </Tag>
        {item.exchange && (
          <Text style={{ color: '#7b9586', fontSize: 11, minWidth: 32 }}>{item.exchange}</Text>
        )}
        <Button
          size="small"
          type={added ? 'default' : 'primary'}
          icon={added ? <CheckOutlined /> : <PlusOutlined />}
          disabled={added}
          onClick={() => { if (!added) { onAdd(item); } }}
          style={{ minWidth: 64 }}
        >
          {added ? '已加入' : '加入'}
        </Button>
      </div>
    );
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(113, 153, 124, 0.18)',
        backdropFilter: 'blur(6px)',
        display: 'flex', justifyContent: 'center', paddingTop: '8vh',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 640,
          background: '#ffffff',
          border: '1px solid rgba(103, 201, 138, 0.18)',
          borderRadius: 16,
          display: 'flex', flexDirection: 'column',
          maxHeight: '80vh', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(103, 201, 138, 0.14)' }}>
          <Input
            ref={inputRef}
            prefix={<SearchOutlined style={{ color: '#5f7a6a' }} />}
            placeholder="搜尋代號或名稱，例如 NVDA、gold、GC=F"
            value={query}
            onChange={e => setQuery(e.target.value)}
            allowClear
            size="large"
            style={{ background: '#f7fcf8', border: '1px solid rgba(103, 201, 138, 0.18)', color: '#183024' }}
          />
          <Text style={{ color: '#7b9586', fontSize: 12, marginTop: 6, display: 'block' }}>
            支援美股、ETF、黃金／白銀／原油期貨、指數與其他常見資產
          </Text>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <Spin size="small" /> <Text style={{ color: '#5f7a6a', marginLeft: 8 }}>搜尋中...</Text>
            </div>
          )}

          {!loading && !query.trim() && categories && categories.map(cat => (
            <div key={cat.label} style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Text style={{ color: '#5f7a6a', fontSize: 12, fontWeight: 500 }}>{cat.label}</Text>
              </div>
              {cat.items.map(renderItem)}
            </div>
          ))}

          {!loading && query.trim() && (
            results.length === 0
              ? <Empty description={<span style={{ color: '#7b9586' }}>找不到符合條件的資產</span>} />
              : results.map(renderItem)
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(103, 201, 138, 0.14)', textAlign: 'right' }}>
          <Button onClick={onClose}>關閉</Button>
        </div>
      </div>
    </div>
  );
};
