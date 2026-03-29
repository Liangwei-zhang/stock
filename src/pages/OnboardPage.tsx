import React, { useState } from 'react';
import { Button, Form, InputNumber, Select, Typography, message, Space } from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import { useAuth, useApi } from '../hooks/useAuth';

const { Title, Text, Paragraph } = Typography;

interface Props {
  onComplete: () => void;
}

export default function OnboardPage({ onComplete }: Props) {
  const { user } = useAuth();
  const apiFetch = useApi();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: { total_capital: number; currency: string }) => {
    setLoading(true);
    try {
      await apiFetch('/api/account', {
        method: 'PUT',
        body: JSON.stringify(values),
      });
      message.success('設置成功！歡迎使用 Stock Signal 🎉');
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
          <div className="mobile-eyebrow">Portfolio Onboarding</div>
          <div className="mobile-auth-icon">👋</div>
          <Title level={2} className="mobile-page-title" style={{ fontSize: 32, margin: 0 }}>
            {user?.name ? `歡迎，${user.name}！` : '歡迎！'}
          </Title>
          <Text className="mobile-page-subtitle" style={{ display: 'block' }}>先定義資金池與計價貨幣，後續的倉位建議、風險比與提醒節奏都會以此為基準。</Text>
        </div>

        <div className="mobile-info-banner">
          <Paragraph style={{ margin: 0, fontSize: 13, color: 'inherit' }}>
            💡 <strong>僅用於計算倉位</strong><br />
            系統根據您填入的總資金計算買入股數和金額建議，
            實際資金完全由您自己管理。
          </Paragraph>
        </div>

        <Form
          layout="vertical"
          initialValues={{ currency: 'USD', total_capital: 50000 }}
          onFinish={handleSubmit}
        >
          <Form.Item
            name="total_capital"
            label="投資總資金"
            rules={[
              { required: true, message: '請輸入投資總資金' },
              { type: 'number', min: 100, message: '至少 100' },
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

          <Form.Item name="currency" label="貨幣">
            <Select size="large">
              <Select.Option value="USD">🇺🇸 USD — 美元</Select.Option>
              <Select.Option value="TWD">🇹🇼 TWD — 新台幣</Select.Option>
              <Select.Option value="CNY">🇨🇳 CNY — 人民幣</Select.Option>
              <Select.Option value="HKD">🇭🇰 HKD — 港元</Select.Option>
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
              完成設置，開始使用 →
            </Button>
            <Button
              type="link"
              block
              onClick={onComplete}
              style={{ color: '#999' }}
            >
              稍後設置
            </Button>
          </Space>
        </Form>
      </div>
    </div>
  );
}
