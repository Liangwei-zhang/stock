import React, { useEffect, useState } from 'react';
import { Button, Form, InputNumber, Alert, Spin, Typography, Result } from 'antd';
import { useI18n } from '../i18n';
import { readJsonIfAvailable } from '../utils/http';

const { Title, Text } = Typography;

interface TradeInfo {
  id: string;
  symbol: string;
  action: string;
  suggested_shares: number;
  suggested_price: number;
  suggested_amount: number;
  status: string;
}

export default function TradeAdjustPage() {
  const { t } = useI18n();
  const params = new URLSearchParams(window.location.search);
  const tradeId = params.get('id');
  const token   = params.get('t');
  const symbol  = params.get('symbol') ?? '';
  const action  = params.get('action') ?? '';

  const [trade, setTrade] = useState<TradeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const actionLabel = action === 'sell'
    ? t('tradeAdjust.action.sell')
    : action === 'buy'
    ? t('tradeAdjust.action.buy')
    : t('tradeAdjust.action.trade');

  useEffect(() => {
    if (!tradeId || !token) {
      setError(t('tradeAdjust.missingLink'));
      setLoading(false);
      return;
    }
    // 直接從 URL 中取得基本信息（無法查詢 trade 詳情的情況下使用 query params）
    // 實際項目可加一個 GET /api/trade/:id/info?t=xxx 接口
    setTrade(null);
    setLoading(false);
  }, [tradeId, token]);

  const handleSubmit = async (values: { actual_shares: number; actual_price: number }) => {
    if (!tradeId || !token) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/trade/${tradeId}/adjust?t=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await readJsonIfAvailable<{ message?: string; error?: string }>(res);
      if (!data) {
        setError(t('tradeAdjust.networkError'));
        return;
      }
      if (!res.ok) {
        setError(data.error ?? t('tradeAdjust.submissionFailed'));
        return;
      }
      setDone(true);
    } catch {
      setError(t('tradeAdjust.networkError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mobile-shell mobile-shell--auth">
        <Spin size="large" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="mobile-result-shell">
        <Result
          status="success"
          title={t('tradeAdjust.done.title')}
          subTitle={t('tradeAdjust.done.subtitle')}
          extra={<Button type="primary" href="/">{t('tradeAdjust.done.action')}</Button>}
          className="mobile-result-card"
        />
      </div>
    );
  }

  return (
    <div className="mobile-shell mobile-shell--auth">
      <div className="mobile-auth-card">
        <div className="mobile-auth-hero">
          <div className="mobile-eyebrow">{t('tradeAdjust.eyebrow')}</div>
          <div className="mobile-auth-icon">✏️</div>
          <Title level={3} className="mobile-page-title" style={{ fontSize: 30, margin: 0 }}>{t('tradeAdjust.title')}</Title>
          <Text className="mobile-page-subtitle" style={{ display: 'block' }}>
            {symbol
              ? t('tradeAdjust.subtitle.withSymbol', { action: actionLabel, symbol })
              : t('tradeAdjust.subtitle.generic')}
          </Text>
        </div>

        <div className="mobile-feature-grid">
          <div className="mobile-feature-card">
            <div className="mobile-feature-value">Exec</div>
            <div className="mobile-feature-label">{t('tradeAdjust.feature.fill')}</div>
          </div>
          <div className="mobile-feature-card">
            <div className="mobile-feature-value">Sync</div>
            <div className="mobile-feature-label">{t('tradeAdjust.feature.sync')}</div>
          </div>
          <div className="mobile-feature-card">
            <div className="mobile-feature-value">Alert</div>
            <div className="mobile-feature-label">{t('tradeAdjust.feature.alert')}</div>
          </div>
        </div>

        <div className="mobile-info-banner">
          {t('tradeAdjust.info')}
        </div>

        {error && (
          <Alert
            type="error"
            message={error}
            style={{ marginBottom: 16 }}
            showIcon
          />
        )}

        <Form layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="actual_shares"
            label={t('tradeAdjust.form.executedShares')}
            rules={[{ required: true, message: t('tradeAdjust.form.executedSharesRequired') }]}
          >
            <InputNumber
              size="large"
              style={{ width: '100%' }}
              min={1}
              step={1}
              precision={0}
              placeholder={t('tradeAdjust.form.executedSharesPlaceholder')}
            />
          </Form.Item>

          <Form.Item
            name="actual_price"
            label={t('tradeAdjust.form.averagePrice')}
            rules={[{ required: true, message: t('tradeAdjust.form.averagePriceRequired') }]}
          >
            <InputNumber
              size="large"
              style={{ width: '100%' }}
              min={0.01}
              step={0.01}
              prefix="$"
              placeholder={t('tradeAdjust.form.averagePricePlaceholder')}
              formatter={v => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={v => parseFloat((v ?? '').replace(/,/g, '')) as never}
            />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            size="large"
            block
            loading={submitting}
            style={{ height: 48, fontSize: 16 }}
          >
            {t('tradeAdjust.submit')}
          </Button>
        </Form>

        <div className="mobile-helper-list">
          <div className="mobile-helper-item">{t('tradeAdjust.helper.average')}</div>
          <div className="mobile-helper-item">{t('tradeAdjust.helper.validLink')}</div>
        </div>
      </div>
    </div>
  );
}
