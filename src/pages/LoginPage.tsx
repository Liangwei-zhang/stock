import React, { useState } from 'react';
import { Button, Form, Input, message, Steps, Typography } from 'antd';
import { MailOutlined, SafetyOutlined } from '@ant-design/icons';
import { useAuth } from '../hooks/useAuth';
import { LOCALE_NATIVE_LABELS, SUPPORTED_LOCALES, useI18n } from '../i18n';
import { readJsonIfAvailable } from '../utils/http';

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
  const { locale, setLocale, t } = useI18n();
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
      const data = await readJsonIfAvailable<{ message?: string; error?: string; devCode?: string }>(res);
      if (!data) {
        message.error(t('login.message.network'));
        return;
      }
      if (!res.ok) {
        message.error(data.error ?? t('login.message.sendLater'));
        return;
      }
      setEmail(values.email);
      setDevCode(data.devCode ?? '');
      setStep('code');
      startCountdown();
      if (data.devCode) {
        codeForm.setFieldsValue({ code: data.devCode });
        message.info(t('login.message.devAutofill'));
      } else {
        message.success(t('login.message.sent'));
      }
    } catch {
      message.error(t('login.message.network'));
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
        body: JSON.stringify({
          email,
          code: values.code,
          locale,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await readJsonIfAvailable<LoginResponse & { error?: string }>(res);
      if (!data) {
        message.error(t('login.message.network'));
        return;
      }
      if (!res.ok) {
        message.error((data as { error?: string }).error ?? t('login.message.verifyFailed'));
        return;
      }
      login(data.token, data.user);
      onSuccess(data.user.isNew);
    } catch {
      message.error(t('login.message.network'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mobile-shell mobile-shell--auth">
      <div className="mobile-auth-card">
        {/* Logo */}
        <div className="mobile-auth-hero">
          <div className="mobile-eyebrow">{t('login.eyebrow')}</div>
          <div className="mobile-auth-icon">📈</div>
          <Title level={2} className="mobile-page-title" style={{ fontSize: 34, margin: 0 }}>{t('login.title')}</Title>
          <Text className="mobile-page-subtitle" style={{ display: 'block' }}>{t('login.subtitle')}</Text>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <Text className="mobile-form-footnote" style={{ margin: 0 }}>{t('login.languageLabel')}</Text>
          {SUPPORTED_LOCALES.map(item => (
            <Button
              key={item}
              size="small"
              type={item === locale ? 'primary' : 'default'}
              onClick={() => setLocale(item)}
            >
              {LOCALE_NATIVE_LABELS[item]}
            </Button>
          ))}
        </div>

        <div className="mobile-feature-grid">
          <div className="mobile-feature-card">
            <div className="mobile-feature-value">60s</div>
            <div className="mobile-feature-label">{t('login.feature.fastAccess')}</div>
          </div>
          <div className="mobile-feature-card">
            <div className="mobile-feature-value">Mail</div>
            <div className="mobile-feature-label">{t('login.feature.passwordless')}</div>
          </div>
          <div className="mobile-feature-card">
            <div className="mobile-feature-value">Sync</div>
            <div className="mobile-feature-label">{t('login.feature.sync')}</div>
          </div>
        </div>

        {/* 步驟指示 */}
        <Steps
          current={step === 'email' ? 0 : 1}
          size="small"
          style={{ marginBottom: 28 }}
          items={[
            { title: t('login.step.email'), icon: <MailOutlined /> },
            { title: t('login.step.verify'), icon: <SafetyOutlined /> },
          ]}
        />

        {step === 'email' && (
          <Form onFinish={handleSendCode} layout="vertical">
            <Form.Item
              name="email"
              label={t('login.emailLabel')}
              rules={[
                { required: true, message: t('login.emailRequired') },
                { type: 'email', message: t('login.emailInvalid') },
              ]}
            >
              <Input
                size="large"
                prefix={<MailOutlined />}
                placeholder={t('login.emailPlaceholder')}
                autoComplete="email"
              />
            </Form.Item>
            <Text className="mobile-form-footnote">{t('login.emailFootnote')}</Text>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={loading}
              >
                {t('login.sendCode')}
              </Button>
            </Form.Item>
          </Form>
        )}

        {step === 'code' && (
          <Form form={codeForm} onFinish={handleVerify} layout="vertical">
            <div className="mobile-info-banner">
              {t('login.codeSentTo', { email })}
            </div>
            {devCode && (
              <div className="mobile-highlight-banner">
                ⚠️ {t('login.devCodeBanner', { code: devCode })}
              </div>
            )}
            <Form.Item
              name="code"
              label={t('login.codeLabel')}
              rules={[
                { required: true, message: t('login.codeRequired') },
                { len: 6, message: t('login.codeLength') },
              ]}
            >
              <Input
                size="large"
                prefix={<SafetyOutlined />}
                placeholder={t('login.codePlaceholder')}
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
                {t('login.signIn')}
              </Button>
            </Form.Item>
            <Text className="mobile-form-footnote">{t('login.codeFootnote')}</Text>
            <Button
              type="link"
              block
              disabled={countdown > 0}
              onClick={() => {
                setStep('email');
                setCountdown(0);
              }}
            >
              {countdown > 0 ? t('login.resend', { seconds: countdown }) : t('login.useAnotherEmail')}
            </Button>
          </Form>
        )}

        <div className="mobile-helper-list">
          <div className="mobile-helper-item">{t('login.helper.syncPrefs')}</div>
          <div className="mobile-helper-item">{t('login.helper.devMode')}</div>
        </div>
      </div>
    </div>
  );
}
