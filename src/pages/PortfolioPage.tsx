import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography, Button, Modal, Input, InputNumber,
  Spin, message, Empty, Popconfirm, Form,
} from 'antd';
import { DeleteOutlined, EditOutlined, LineChartOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { useAuth, useApi } from '../hooks/useAuth';
import { BottomNav } from '../components/BottomNav';
import { useI18n } from '../i18n';

const { Title, Text } = Typography;

interface PortfolioItem {
  id: string;
  symbol: string;
  shares: number;
  avg_cost: number;
  total_capital: number;
}

interface AccountSummary {
  totalCapital: number;
  currency: string;
}

interface AccountResponse {
  account: AccountSummary;
}

export const PortfolioPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const apiFetch = useApi();
  const { t, formatCurrency, formatNumber } = useI18n();
  const [form] = Form.useForm();

  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<PortfolioItem | null>(null);
  const [saving, setSaving] = useState(false);

  const fmtMoney = (value: number, currency = 'USD', digits = 2) =>
    formatCurrency(value, currency, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  const fmtShares = (value: number) =>
    formatNumber(Math.trunc(value), { maximumFractionDigits: 0 });

  const fmtPct = (value: number, digits = 1) =>
    formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    load();
  }, [user]);

  const load = async () => {
    setLoading(true);
    try {
      const [portfolio, acc] = await Promise.all([
        apiFetch<PortfolioItem[]>('/api/portfolio'),
        apiFetch<AccountResponse>('/api/account'),
      ]);
      setItems(portfolio);
      setAccount(acc.account);
    } catch {
      message.error(t('portfolio.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditItem(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (item: PortfolioItem) => {
    setEditItem(item);
    form.setFieldsValue({
      symbol: item.symbol,
      shares: Math.trunc(item.shares),
      avg_cost: item.avg_cost,
    });
    setModalOpen(true);
  };

  const closeForm = () => {
    setModalOpen(false);
    setEditItem(null);
    form.resetFields();
  };

  const handleSave = async () => {
    const vals = await form.validateFields();
    setSaving(true);
    try {
      const body = {
        symbol: vals.symbol?.toUpperCase(),
        shares: Math.trunc(Number(vals.shares)),
        avg_cost: Number(vals.avg_cost),
      };
      if (editItem) {
        await apiFetch(`/api/portfolio/${editItem.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        message.success(t('portfolio.updateSuccess'));
      } else {
        await apiFetch('/api/portfolio', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        message.success(t('portfolio.addSuccess', { symbol: body.symbol }));
      }
      closeForm();
      await load();
    } catch (err: any) {
      message.error(err.message || t('portfolio.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, symbol: string) => {
    try {
      await apiFetch(`/api/portfolio/${id}`, { method: 'DELETE' });
      message.success(t('portfolio.deleteSuccess', { symbol }));
      setItems(prev => prev.filter(i => i.id !== id));
    } catch {
      message.error(t('portfolio.deleteFailed'));
    }
  };

  const currency = account?.currency ?? 'USD';
  const totalCapital = account?.totalCapital ?? 0;
  const deployedCapital = items.reduce((sum, item) => sum + item.total_capital, 0);
  const cashReserve = Math.max(0, totalCapital - deployedCapital);
  const deployedPct = totalCapital > 0 ? Math.max(0, Math.min(100, (deployedCapital / totalCapital) * 100)) : 0;
  const largestHolding = [...items].sort((a, b) => b.total_capital - a.total_capital)[0];

  return (
    <div className="mobile-shell">
      <div className="mobile-shell__inner">
        <div className="mobile-premium-hero">
          <div className="mobile-premium-hero__top">
            <div className="mobile-premium-hero__copy">
              <div className="mobile-eyebrow">{t('portfolio.eyebrow')}</div>
              <Title level={2} className="mobile-page-title" style={{ fontSize: 32, margin: 0 }}>
                {t('portfolio.title')}
              </Title>
              <Text className="mobile-page-subtitle" style={{ display: 'block' }}>
                {t('portfolio.subtitle')}
              </Text>
            </div>
            <div className="mobile-premium-hero__actions">
              <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
                {t('portfolio.addPosition')}
              </Button>
              <Button className="mobile-ghost-action" icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
                {t('portfolio.capital')}
              </Button>
            </div>
          </div>
          <div className="mobile-inline-metrics">
            <span className="mobile-inline-metric">{t('portfolio.metric.holdings')} <strong>{items.length}</strong></span>
            <span className="mobile-inline-metric">{t('portfolio.metric.deployed')} <strong>{fmtPct(deployedPct)}%</strong></span>
            <span className="mobile-inline-metric">{t('portfolio.metric.cash')} <strong>{fmtPct(Math.max(0, 100 - deployedPct))}%</strong></span>
          </div>
        </div>

        <div className="mobile-summary-grid">
          <div className="mobile-summary-card">
            <div className="mobile-summary-label">{t('portfolio.summary.deployed')}</div>
            <div className="mobile-summary-value">{fmtMoney(deployedCapital, currency, 0)}</div>
            <div className="mobile-summary-caption">{t('portfolio.summary.deployed.caption')}</div>
          </div>
          <div className="mobile-summary-card">
            <div className="mobile-summary-label">{t('portfolio.summary.cashBuffer')}</div>
            <div className="mobile-summary-value">{fmtMoney(cashReserve, currency, 0)}</div>
            <div className="mobile-summary-caption">{t('portfolio.summary.cashBuffer.caption')}</div>
          </div>
          <div className="mobile-summary-card">
            <div className="mobile-summary-label">{t('portfolio.summary.largestLine')}</div>
            <div className="mobile-summary-value">{largestHolding ? largestHolding.symbol : '—'}</div>
            <div className="mobile-summary-caption">{largestHolding && totalCapital > 0 ? t('portfolio.summary.largestLine.caption', { pct: fmtPct((largestHolding.total_capital / totalCapital) * 100) }) : t('portfolio.summary.largestLine.empty')}</div>
          </div>
        </div>

        <div className="mobile-panel mobile-panel--highlight">
          <div className="mobile-section-header">
            <div>
              <div className="mobile-section-title">{t('portfolio.map.title')}</div>
              <div className="mobile-section-note">{t('portfolio.map.note')}</div>
            </div>
            <span className="mobile-soft-tag"><LineChartOutlined /> {t('portfolio.map.total', { value: fmtMoney(totalCapital, currency, 0) })}</span>
          </div>
          <div className="mobile-meter" style={{ marginBottom: 12 }}>
            <span style={{ width: `${Math.min(100, Math.max(deployedPct, items.length > 0 ? 8 : 0))}%` }} />
          </div>
          <div className="mobile-split-row" style={{ marginTop: 0, marginBottom: 12 }}>
            <span>{t('portfolio.split.deployed')} <strong>{fmtMoney(deployedCapital, currency, 0)}</strong> ({fmtPct(deployedPct)}%)</span>
            <span>{t('portfolio.split.cash')} <strong>{fmtMoney(cashReserve, currency, 0)}</strong> ({fmtPct(Math.max(0, 100 - deployedPct))}%)</span>
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : items.length === 0 ? (
            <div className="mobile-empty">
              <Empty description={t('portfolio.empty.title')} style={{ padding: 20, color: '#7b9586' }} />
              <Button type="primary" onClick={openAdd}>{t('portfolio.empty.addFirst')}</Button>
            </div>
          ) : (
            <div className="mobile-allocation-list">
              {[...items].sort((a, b) => b.total_capital - a.total_capital).map(item => {
                const itemPct = totalCapital > 0 ? (item.total_capital / totalCapital) * 100 : 0;
                return (
                  <div key={item.id} className="mobile-allocation-item">
                    <div className="mobile-allocation-head">
                      <div>
                        <div className="mobile-allocation-symbol">{item.symbol}</div>
                        <div className="mobile-allocation-meta">
                          <span>{fmtShares(item.shares)} {t('portfolio.form.shares')}</span>
                          <span>{t('portfolio.allocation.avg', { price: fmtMoney(item.avg_cost, currency, 2) })}</span>
                        </div>
                      </div>
                      <div className="mobile-allocation-value">
                        <strong>{fmtMoney(item.total_capital, currency, 0)}</strong>
                        <span>{t('portfolio.allocation.allocation', { pct: fmtPct(itemPct) })}</span>
                      </div>
                    </div>
                    <div className="mobile-allocation-bar">
                      <span style={{ width: `${Math.min(100, Math.max(itemPct, 8))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mobile-panel">
          <div className="mobile-section-header">
            <div>
              <div className="mobile-section-title">{t('portfolio.ledger.title')}</div>
              <div className="mobile-section-note">{t('portfolio.ledger.note')}</div>
            </div>
            <span className="mobile-soft-tag">{t('portfolio.ledger.records', { count: items.length })}</span>
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : items.length === 0 ? (
            <div className="mobile-empty">
              <Text className="mobile-muted">{t('portfolio.ledger.empty')}</Text>
              <Button type="primary" style={{ marginTop: 12 }} onClick={openAdd}>{t('portfolio.ledger.createFirst')}</Button>
            </div>
          ) : (
            <div className="mobile-list">
              {items.map(item => {
                const itemPct = totalCapital > 0 ? (item.total_capital / totalCapital) * 100 : 0;
                return (
                  <div key={item.id} className="mobile-list-card mobile-list-card--active">
                    <div className="mobile-list-row">
                      <div>
                        <Text strong className="mobile-symbol">{item.symbol}</Text>
                        <div className="mobile-allocation-meta" style={{ marginTop: 6 }}>
                          <span>{fmtShares(item.shares)} {t('portfolio.form.shares')}</span>
                          <span>{t('portfolio.allocation.avg', { price: fmtMoney(item.avg_cost, currency, 2) })}</span>
                        </div>
                      </div>
                      <Text strong className="mobile-list-value">{fmtMoney(item.total_capital, currency, 0)}</Text>
                    </div>
                    <div className="mobile-chip-row" style={{ marginTop: 12 }}>
                      <span className="mobile-soft-tag mobile-soft-tag--list">{t('portfolio.ledger.allocation', { pct: fmtPct(itemPct) })}</span>
                      <span className="mobile-soft-tag mobile-soft-tag--list">{t('portfolio.ledger.wholeShare')}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                      <Button
                        type="text"
                        icon={<EditOutlined />}
                        size="small"
                        style={{ color: '#5f7a6a' }}
                        onClick={() => openEdit(item)}
                      />
                      <Popconfirm
                        title={t('portfolio.removeConfirm', { symbol: item.symbol })}
                        onConfirm={() => handleDelete(item.id, item.symbol)}
                        okText={t('common.remove')}
                        cancelText={t('common.cancel')}
                      >
                        <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                      </Popconfirm>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={modalOpen}
        title={editItem ? t('portfolio.modal.editTitle', { symbol: editItem.symbol }) : t('portfolio.modal.addTitle')}
        onOk={handleSave}
        onCancel={closeForm}
        confirmLoading={saving}
        okText={editItem ? t('portfolio.modal.editOk') : t('portfolio.modal.addOk')}
        cancelText={t('common.cancel')}
        rootClassName="mobile-modal"
        styles={{ content: { background: '#ffffff' }, header: { background: '#ffffff', color: '#183024' } }}
      >
        <Text className="mobile-page-subtitle" style={{ display: 'block', marginBottom: 16 }}>
          {t('portfolio.modal.subtitle')}
        </Text>
        <Form form={form} layout="vertical">
          <Form.Item name="symbol" label={<span style={{ color: '#5f7a6a' }}>{t('portfolio.form.symbol')}</span>} rules={[{ required: true, message: t('portfolio.form.symbolRequired') }]}>
            <Input
              placeholder={t('portfolio.form.symbolPlaceholder')}
              disabled={!!editItem}
              style={{ background: '#ffffff', borderColor: 'rgba(93, 187, 123, 0.18)', color: '#183024' }}
              onChange={e => form.setFieldValue('symbol', e.target.value.toUpperCase())}
            />
          </Form.Item>
          <Form.Item
            name="shares"
            label={<span style={{ color: '#5f7a6a' }}>{t('portfolio.form.shares')}</span>}
            rules={[
              { required: true, message: t('portfolio.form.sharesRequired') },
              {
                validator: (_, value) => Number.isInteger(value) && value > 0
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('portfolio.form.sharesInvalid'))),
              },
            ]}
          >
            <InputNumber
              min={1}
              step={1}
              precision={0}
              style={{ width: '100%', background: '#ffffff', borderColor: 'rgba(93, 187, 123, 0.18)' }}
              placeholder={t('portfolio.form.sharesPlaceholder')}
            />
          </Form.Item>
          <Form.Item name="avg_cost" label={<span style={{ color: '#5f7a6a' }}>{t('portfolio.form.avgCost', { currency })}</span>} rules={[{ required: true, message: t('portfolio.form.avgCostRequired') }]}>
            <InputNumber
              min={0.000001}
              step={0.01}
              prefix="$"
              style={{ width: '100%', background: '#ffffff', borderColor: 'rgba(93, 187, 123, 0.18)' }}
              placeholder={t('portfolio.form.avgCostPlaceholder')}
            />
          </Form.Item>
        </Form>
      </Modal>

      <BottomNav />
    </div>
  );
};
