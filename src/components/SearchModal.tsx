import React, { useState, useEffect, useRef } from 'react';
import { Input, Tag, Typography, Spin, Empty, Button } from 'antd';
import { SearchOutlined, PlusOutlined, CheckOutlined, StarOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { SearchResult } from '../types';
import { searchSymbols, assetTypeLabel, assetTypeColor, POPULAR_ASSETS } from '../services/searchService';

const { Text } = Typography;

interface Props {
  visible:   boolean;
  watchlist: string[];       // 已添加的 symbol 列表
  onClose:   () => void;
  onAdd:     (item: SearchResult) => void;
}

export const SearchModal: React.FC<Props> = ({ visible, watchlist, onClose, onAdd }) => {
  const { t } = useTranslation();
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<SearchResult[]>(POPULAR_ASSETS);
  const [loading,  setLoading]  = useState(false);
  const inputRef: any           = useRef(null);
  const timerRef                = useRef<ReturnType<typeof setTimeout>>();

  // 每次打开时聚焦搜索框
  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults(POPULAR_ASSETS);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  // 防抖搜索
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
        { label: t('search.hotStocks'),  items: POPULAR_ASSETS.filter(a => a.assetType === 'equity') },
        { label: t('search.futures'),    items: POPULAR_ASSETS.filter(a => a.assetType === 'futures') },
        { label: t('search.etf'),        items: POPULAR_ASSETS.filter(a => a.assetType === 'etf') },
        { label: t('search.indices'),    items: POPULAR_ASSETS.filter(a => a.assetType === 'index') },
      ];

  const renderItem = (item: SearchResult) => {
    const added = watchlist.includes(item.symbol);
    return (
      <div key={item.symbol} style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px', borderRadius: 8, marginBottom: 4,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.07)',
        transition: 'background .2s',
        cursor: added ? 'default' : 'pointer',
      }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(24,144,255,0.1)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
      >
        {/* 代码 */}
        <Text style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600, color: '#fff', minWidth: 72 }}>
          {item.symbol}
        </Text>
        {/* 名称 */}
        <Text style={{ flex: 1, color: '#8b949e', fontSize: 13 }} ellipsis>
          {item.name}
        </Text>
        {/* 类型 */}
        <Tag color={assetTypeColor(item.assetType)} style={{ margin: 0, fontSize: 11 }}>
          {assetTypeLabel(item.assetType)}
        </Tag>
        {/* 交易所 */}
        {item.exchange && (
          <Text style={{ color: '#586069', fontSize: 11, minWidth: 32 }}>{item.exchange}</Text>
        )}
        {/* 添加按钮 */}
        <Button
          size="small"
          type={added ? 'default' : 'primary'}
          icon={added ? <CheckOutlined /> : <PlusOutlined />}
          disabled={added}
          onClick={() => { if (!added) { onAdd(item); } }}
          style={{ minWidth: 64 }}
        >
          {added ? t('common.added') : t('common.add')}
        </Button>
      </div>
    );
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex', justifyContent: 'center', paddingTop: '8vh',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 640,
          background: '#1a1f2e',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 16,
          display: 'flex', flexDirection: 'column',
          maxHeight: '80vh', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── 搜索框 ── */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <Input
            ref={inputRef}
            prefix={<SearchOutlined style={{ color: '#8b949e' }} />}
            placeholder={t('search.placeholder')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            allowClear
            size="large"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
          />
          <Text style={{ color: '#586069', fontSize: 12, marginTop: 6, display: 'block' }}>
            {t('search.hint')}
          </Text>
        </div>

        {/* ── 结果列表 ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <Spin size="small" /> <Text style={{ color: '#8b949e', marginLeft: 8 }}>{t('common.searching')}</Text>
            </div>
          )}

          {!loading && !query.trim() && categories && categories.map(cat => (
            <div key={cat.label} style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Text style={{ color: '#8b949e', fontSize: 12, fontWeight: 500 }}>{cat.label}</Text>
              </div>
              {cat.items.map(renderItem)}
            </div>
          ))}

          {!loading && query.trim() && (
            results.length === 0
              ? <Empty description={<span style={{ color: '#586069' }}>{t('common.noResult')}</span>} />
              : results.map(renderItem)
          )}
        </div>

        {/* ── 底部关闭 ── */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.08)', textAlign: 'right' }}>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </div>
  );
};
