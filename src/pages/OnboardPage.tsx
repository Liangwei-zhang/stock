import React, { useState } from 'react';
import { Button, Form, InputNumber, Select, Typography, message, Space } from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import { useAuth, useApi } from '../hooks/useAuth';
import { useI18n } from '../i18n';

const { Title, Text, Paragraph } = Typography;

interface Props {
  onComplete: () => void;
}

export default function OnboardPage({ onComplete }: Props) {
  const { user } = useAuth();
  const apiFetch = useApi();
  const { t, formatNumber } = useI18n();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: { total_capital: number; currency: string }) => {
    setLoading(true);
    try {
      await apiFetch('/api/account', {
        method: 'PUT',
        body: JSON.stringify(values),
      });
      message.success(t('onboard.setupComplete'));
      onComplete();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mobile-shell mobile-shell--auth">
      <div className="mobile-auth-card">
        <div className="mobile-auth-hero">
          <div className="mobile-eyebrow">{t('onboard.eyebrow')}</div>
          <div className="mobile-auth-icon">👋</div>
          <Title level={2} className="mobile-page-title" style={{ fontSize: 32, margin: 0 }}>
            {user?.name ? t('onboard.title.named', { name: user.name }) : t('onboard.title.generic')}
          </Title>
          <Text className="mobile-page-subtitle" style={{ display: 'block' }}>{t('onboard.subtitle')}</Text>
        </div>

        <div className="mobile-feature-grid">
          <div className="mobile-feature-card">
            <div className="mobile-feature-value">1</div>
            <div className="mobile-feature-label">{t('onboard.feature.baseline')}</div>
          </div>
          <div className="mobile-feature-card">
            <div className="mobile-feature-value">FX</div>
            <div className="mobile-feature-label">{t('onboard.feature.currency')}</div>
          </div>
          <div className="mobile-feature-card">
            <div className="mobile-feature-value">Risk</div>
            <div className="mobile-feature-label">{t('onboard.feature.risk')}</div>
          </div>
        </div>

        <div className="mobile-info-banner">
          <Paragraph style={{ margin: 0, fontSize: 13, color: 'inherit' }}>
            <strong>{t('onboard.infoTitle')}</strong><br />
            {t('onboard.infoBody')}
          </Paragraph>
        </div>

        <Form
          form={form}
          layout="vertical"
          initialValues={{ currency: 'USD', total_capital: 50000 }}
          onFinish={handleSubmit}
        >
          <Text className="mobile-form-footnote">{t('onboard.quickPicks')}</Text>
          <div className="mobile-quick-picks">
            {[20000, 50000, 100000].map(amount => (
              <Button
                key={amount}
                className="mobile-quick-pick"
                onClick={() => form.setFieldValue('total_capital', amount)}
              >
                {formatNumber(amount)}
              </Button>
            ))}
          </div>

          <Form.Item
            name="total_capital"
            label={t('onboard.totalCapital')}
            rules={[
              { required: true, message: t('onboard.totalCapitalRequired') },
              { type: 'number', min: 100, message: t('onboard.totalCapitalMin') },
            ]}
          >
            <InputNumber
              size="large"
              style={{ width: '100%' }}
              prefix={<DollarOutlined />}
              placeholder="50000"
              min={100}
              step={1000}
              formatter={v => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={v => parseFloat((v ?? '').replace(/,/g, '')) as never}
            />
          </Form.Item>

          <Form.Item name="currency" label={t('onboard.currency')}>
            <Select size="large">
              <Select.Option value="USD">{t('onboard.currency.usd')}</Select.Option>
              <Select.Option value="TWD">{t('onboard.currency.twd')}</Select.Option>
              <Select.Option value="CNY">{t('onboard.currency.cny')}</Select.Option>
              <Select.Option value="HKD">{t('onboard.currency.hkd')}</Select.Option>
            </Select>
          </Form.Item>

          <Space direction="vertical" style={{ width: '100%', gap: 8 }}>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={loading}
              style={{ height: 48, fontSize: 16 }}
            >
              {t('onboard.finish')}
            </Button>
            <Button
              type="link"
              block
              onClick={onComplete}
              style={{ color: '#5f7a6a' }}
            >
              {t('onboard.later')}
            </Button>
          </Space>
        </Form>

        <div className="mobile-helper-list">
          <div className="mobile-helper-item">{t('onboard.helper.sizing')}</div>
          <div className="mobile-helper-item">{t('onboard.helper.updateLater')}</div>
        </div>
      </div>
    </div>
  );
}
