import React, { useState } from 'react';
import { Button, Form, Input, message, Steps, Typography } from 'antd';
import { MailOutlined, SafetyOutlined } from '@ant-design/icons';
import { useAuth } from '../hooks/useAuth';

const { Title, Text } = Typography;

interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    plan: string;
    locale: string;
    timezone: string;
    isNew: boolean;
  };
}

interface Props {
  onSuccess: (isNew: boolean) => void;
}

export default function LoginPage({ onSuccess }: Props) {
  const { login } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [devCode, setDevCode] = useState('');
  const [codeForm] = Form.useForm();

  const startCountdown = () => {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown(n => {
        if (n <= 1) { clearInterval(timer); return 0; }
        return n - 1;
      });
    }, 1000);
  };

  const handleSendCode = async (values: { email: string }) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: values.email }),
      });
      const data = await res.json() as { message?: string; error?: string; devCode?: string };
      if (!res.ok) {
        message.error(data.error ?? '發送失敗，請稍後重試');
        return;
      }
      setEmail(values.email);
      setDevCode(data.devCode ?? '');
      setStep('code');
      startCountdown();
      if (data.devCode) {
        codeForm.setFieldsValue({ code: data.devCode });
        message.info('未配置郵件服務，驗證碼已自動填入');
      } else {
        message.success('驗證碼已發送到您的郵箱');
      }
    } catch {
      message.error('網絡錯誤，請稍後重試');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (values: { code: string }) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: values.code }),
      });
      const data = await res.json() as LoginResponse & { error?: string };
      if (!res.ok) {
        message.error((data as { error?: string }).error ?? '驗證失敗');
        return;
      }
      login(data.token, data.user);
      onSuccess(data.user.isNew);
    } catch {
      message.error('網絡錯誤，請稍後重試');
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
      background: '#f0f2f5',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        background: '#fff',
        borderRadius: 16,
        padding: '32px 24px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📈</div>
          <Title level={3} style={{ margin: 0 }}>Stock Signal</Title>
          <Text type="secondary">智能股票訂閱通知系統</Text>
        </div>

        {/* 步驟指示 */}
        <Steps
          current={step === 'email' ? 0 : 1}
          size="small"
          style={{ marginBottom: 28 }}
          items={[
            { title: '輸入郵箱', icon: <MailOutlined /> },
            { title: '驗證碼登入', icon: <SafetyOutlined /> },
          ]}
        />

        {step === 'email' && (
          <Form onFinish={handleSendCode} layout="vertical">
            <Form.Item
              name="email"
              label="郵箱地址"
              rules={[
                { required: true, message: '請輸入郵箱' },
                { type: 'email', message: '請輸入有效的郵箱地址' },
              ]}
            >
              <Input
                size="large"
                prefix={<MailOutlined />}
                placeholder="your@email.com"
                autoComplete="email"
              />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={loading}
              >
                發送驗證碼
              </Button>
            </Form.Item>
          </Form>
        )}

        {step === 'code' && (
          <Form form={codeForm} onFinish={handleVerify} layout="vertical">
            <div style={{
              background: '#e6f7ff',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 16,
              fontSize: 13,
              color: '#0958d9',
            }}>
              已發送到 <strong>{email}</strong>
            </div>
            {devCode && (
              <div style={{
                background: '#fffbe6',
                border: '1px solid #ffe58f',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 16,
                fontSize: 13,
                color: '#874d00',
              }}>
                ⚠️ 未配置郵件服務，驗證碼：<strong style={{ letterSpacing: 4 }}>{devCode}</strong>
              </div>
            )}
            <Form.Item
              name="code"
              label="6 位驗證碼"
              rules={[
                { required: true, message: '請輸入驗證碼' },
                { len: 6, message: '驗證碼為 6 位數字' },
              ]}
            >
              <Input
                size="large"
                prefix={<SafetyOutlined />}
                placeholder="123456"
                maxLength={6}
                style={{ letterSpacing: 6, textAlign: 'center' }}
                autoComplete="one-time-code"
              />
            </Form.Item>
            <Form.Item style={{ marginBottom: 12 }}>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={loading}
              >
                登入
              </Button>
            </Form.Item>
            <Button
              type="link"
              block
              disabled={countdown > 0}
              onClick={() => {
                setStep('email');
                setCountdown(0);
              }}
            >
              {countdown > 0 ? `重新發送（${countdown}s）` : '← 重新輸入郵箱'}
            </Button>
          </Form>
        )}
      </div>
    </div>
  );
}
