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
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 20px',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 440,
        background: '#fff',
        borderRadius: 20,
        padding: '36px 28px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>👋</div>
          <Title level={3} style={{ margin: 0 }}>
            {user?.name ? `歡迎，${user.name}！` : '歡迎！'}
          </Title>
          <Text type="secondary">讓我們先設置您的投資帳戶</Text>
        </div>

        <div style={{
          background: '#f9f0ff',
          border: '1px solid #d3adf7',
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 24,
        }}>
          <Paragraph style={{ margin: 0, fontSize: 13, color: '#531dab' }}>
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
