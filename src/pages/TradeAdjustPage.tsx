import React, { useEffect, useState } from 'react';
import { Button, Form, InputNumber, Alert, Spin, Typography, Result } from 'antd';

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
  const params = new URLSearchParams(window.location.search);
  const tradeId = params.get('id');
  const token   = params.get('t');

  const [trade, setTrade] = useState<TradeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tradeId || !token) {
      setError('鏈接參數缺失，請從郵件中重新點擊');
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
      const data = await res.json() as { message?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? '提交失敗，請重試');
        return;
      }
      setDone(true);
    } catch {
      setError('網絡錯誤，請稍後重試');
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
          title="記錄成功！"
          subTitle="您的實際操作已記錄，持倉已自動更新 📊"
          extra={<Button type="primary" href="/">返回首頁</Button>}
          className="mobile-result-card"
        />
      </div>
    );
  }

  return (
    <div className="mobile-shell mobile-shell--auth">
      <div className="mobile-auth-card">
        <div className="mobile-auth-hero">
          <div className="mobile-eyebrow">Trade Feedback Loop</div>
          <div className="mobile-auth-icon">✏️</div>
          <Title level={3} className="mobile-page-title" style={{ fontSize: 30, margin: 0 }}>填寫實際操作</Title>
          <Text className="mobile-page-subtitle" style={{ display: 'block' }}>把您在券商 App 的最終成交結果回填，系統會以真實成交修正持倉與後續提醒。</Text>
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
            label="實際成交股數"
            rules={[{ required: true, message: '請輸入成交股數' }]}
          >
            <InputNumber
              size="large"
              style={{ width: '100%' }}
              min={0.001}
              step={1}
              placeholder="例如：28"
            />
          </Form.Item>

          <Form.Item
            name="actual_price"
            label="實際成交均價"
            rules={[{ required: true, message: '請輸入成交均價' }]}
          >
            <InputNumber
              size="large"
              style={{ width: '100%' }}
              min={0.01}
              step={0.01}
              prefix="$"
              placeholder="例如：178.50"
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
            提交確認
          </Button>
        </Form>
      </div>
    </div>
  );
}
