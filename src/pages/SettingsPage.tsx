import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography, Form, Input, InputNumber, Select, Button,
  Divider, message, Spin,
} from 'antd';
import { BellOutlined, ClockCircleOutlined, DollarCircleOutlined, GlobalOutlined, HomeOutlined, LogoutOutlined, MailOutlined, SaveOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth, useApi } from '../hooks/useAuth';
import { BottomNav } from '../components/BottomNav';
import { normalizeLocale, translateText, useI18n } from '../i18n';

const { Title, Text } = Typography;

interface AccountInfo {
  user: {
    name?: string | null;
    email: string;
    locale?: string;
    timezone?: string;
  };
  account: {
    totalCapital: number;
    currency: string;
  };
}

const CURRENCIES = ['USD', 'TWD', 'HKD', 'CNY', 'JPY', 'EUR', 'GBP'];

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout, updateUser } = useAuth();
  const apiFetch = useApi();
  const { t, setLocale, formatCurrency } = useI18n();
  const [form] = Form.useForm();
  const watchedName = Form.useWatch('name', form);
  const watchedCapital = Form.useWatch('total_capital', form);
  const watchedCurrency = Form.useWatch('currency', form);
  const watchedTimezone = Form.useWatch('timezone', form);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const timeZoneOptions = [
    { label: t('settings.timeZone.asiaShanghai'), value: 'Asia/Shanghai' },
    { label: t('settings.timeZone.asiaTaipei'), value: 'Asia/Taipei' },
    { label: t('settings.timeZone.asiaHongKong'), value: 'Asia/Hong_Kong' },
    { label: t('settings.timeZone.newYork'), value: 'America/New_York' },
    { label: t('settings.timeZone.losAngeles'), value: 'America/Los_Angeles' },
    { label: t('settings.timeZone.london'), value: 'Europe/London' },
  ];
  const timeZoneLabel = timeZoneOptions.find(option => option.value === watchedTimezone)?.label ?? String(watchedTimezone || 'Asia/Shanghai');

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    apiFetch<AccountInfo>('/api/account')
      .then(data => {
        form.setFieldsValue({
          name: data.user?.name ?? '',
          total_capital: data.account?.totalCapital,
          currency: data.account?.currency,
          locale: data.user?.locale ?? 'en-US',
          timezone: data.user?.timezone ?? 'Asia/Shanghai',
        });
      })
      .catch(() => message.error(t('settings.loadFailed')))
      .finally(() => setLoading(false));
  }, [user]);

  const handleSave = async () => {
    const vals = await form.validateFields();
    setSaving(true);
    try {
      const nextLocale = normalizeLocale(vals.locale);
      await apiFetch('/api/account', {
        method: 'PUT',
        body: JSON.stringify({
          name: vals.name || undefined,
          total_capital: Number(vals.total_capital),
          currency: vals.currency,
          locale: nextLocale,
          timezone: vals.timezone,
        }),
      });
      updateUser({
        name: vals.name || null,
        locale: nextLocale,
        timezone: vals.timezone,
      });
      setLocale(nextLocale);
      message.success(translateText(nextLocale, 'settings.saveSuccess'));
    } catch (err: any) {
      message.error(err.message || t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="mobile-shell">
        <div className="mobile-shell__inner" style={{ minHeight: '60dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" />
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="mobile-shell">
      <div className="mobile-shell__inner">
        <div className="mobile-premium-hero">
          <div className="mobile-premium-hero__top">
            <div className="mobile-premium-hero__copy">
              <div className="mobile-eyebrow">{t('settings.eyebrow')}</div>
              <Title level={2} className="mobile-page-title" style={{ fontSize: 32, margin: 0 }}>{t('settings.title')}</Title>
              <Text className="mobile-page-subtitle" style={{ display: 'block' }}>
                {t('settings.subtitle')}
              </Text>
            </div>
            <div className="mobile-premium-hero__actions">
              <Button className="mobile-ghost-action" icon={<HomeOutlined />} onClick={() => navigate('/')}>
                {t('settings.action.home')}
              </Button>
              <Button className="mobile-ghost-action" icon={<BellOutlined />} onClick={() => navigate('/notifications')}>
                {t('settings.action.inbox')}
              </Button>
            </div>
          </div>
          <div className="mobile-inline-metrics">
            <span className="mobile-inline-metric">{t('settings.metric.currency')} <strong>{watchedCurrency || 'USD'}</strong></span>
            <span className="mobile-inline-metric">{t('settings.metric.capital')} <strong>{formatCurrency(Number(watchedCapital || 0), watchedCurrency || 'USD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</strong></span>
            <span className="mobile-inline-metric">{t('settings.metric.timeZone')} <strong>{timeZoneLabel}</strong></span>
          </div>
        </div>

        <div className="mobile-profile-card">
          <div className="mobile-avatar-badge"><UserOutlined /></div>
          <div>
            <div className="mobile-profile-title">{watchedName || user?.name || t('settings.noDisplayName')}</div>
            <div className="mobile-profile-subtitle">{t('settings.profileSubtitle', { email: user?.email ?? '' })}</div>
          </div>
        </div>

        <div className="mobile-summary-grid">
          <div className="mobile-summary-card">
            <div className="mobile-summary-label">{t('settings.summary.baseCurrency')}</div>
            <div className="mobile-summary-value">{watchedCurrency || 'USD'}</div>
            <div className="mobile-summary-caption">{t('settings.summary.baseCurrency.caption')}</div>
          </div>
          <div className="mobile-summary-card">
            <div className="mobile-summary-label">{t('settings.summary.capital')}</div>
            <div className="mobile-summary-value">{formatCurrency(Number(watchedCapital || 0), watchedCurrency || 'USD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
            <div className="mobile-summary-caption">{t('settings.summary.capital.caption')}</div>
          </div>
          <div className="mobile-summary-card">
            <div className="mobile-summary-label">{t('settings.summary.timeZone')}</div>
            <div className="mobile-summary-value">{timeZoneLabel}</div>
            <div className="mobile-summary-caption">{t('settings.summary.timeZone.caption')}</div>
          </div>
        </div>

        <div className="mobile-panel mobile-panel--highlight">
          <div className="mobile-section-header">
            <div>
              <div className="mobile-section-title">{t('settings.preferences.title')}</div>
              <div className="mobile-section-note">{t('settings.preferences.note')}</div>
            </div>
            <span className="mobile-soft-tag"><MailOutlined /> {t('settings.preferences.tag')}</span>
          </div>
          <Form form={form} layout="vertical">
            <Form.Item name="name" label={<span style={{ color: '#5f7a6a' }}>{t('settings.form.displayName')}</span>}>
              <Input placeholder={t('settings.form.optional')} style={{ background: '#ffffff', borderColor: 'rgba(93, 187, 123, 0.18)', color: '#183024' }} />
            </Form.Item>

            <Text className="mobile-form-footnote">{t('settings.form.quickPicks')}</Text>
            <div className="mobile-quick-picks">
              {[20000, 50000, 100000].map(amount => (
                <Button key={amount} className="mobile-quick-pick" onClick={() => form.setFieldValue('total_capital', amount)}>
                  <DollarCircleOutlined /> {formatCurrency(amount, watchedCurrency || 'USD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </Button>
              ))}
            </div>

            <Form.Item
              name="total_capital"
              label={<span style={{ color: '#5f7a6a' }}>{t('settings.form.totalCapital')}</span>}
              rules={[{ required: true, message: t('settings.form.totalCapitalRequired') }]}
            >
              <InputNumber min={0} step={1000} prefix="$" style={{ width: '100%' }} placeholder="50000" />
            </Form.Item>

            <Text className="mobile-form-footnote">{t('settings.form.totalCapitalFootnote')}</Text>

            <Form.Item name="currency" label={<span style={{ color: '#5f7a6a' }}>{t('settings.form.currency')}</span>}>
              <Select options={CURRENCIES.map(c => ({ label: c, value: c }))} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item name="locale" label={<span style={{ color: '#5f7a6a' }}>{t('settings.form.language')}</span>}>
              <Select
                options={[
                  { label: t('settings.language.en'), value: 'en-US' },
                  { label: t('settings.language.zhTW'), value: 'zh-TW' },
                  { label: t('settings.language.zhCN'), value: 'zh-CN' },
                ]}
                style={{ width: '100%' }}
              />
            </Form.Item>

            <Form.Item name="timezone" label={<span style={{ color: '#5f7a6a' }}>{t('settings.form.timeZone')}</span>}>
              <Select options={timeZoneOptions} style={{ width: '100%' }} />
            </Form.Item>

            <Button type="primary" block icon={<SaveOutlined />} loading={saving} onClick={handleSave} style={{ marginTop: 8 }}>
              {t('settings.form.save')}
            </Button>
          </Form>
        </div>

        <div className="mobile-panel mobile-panel--compact">
          <div className="mobile-section-header" style={{ marginBottom: 12 }}>
            <div>
              <div className="mobile-section-title">{t('settings.security.title')}</div>
              <div className="mobile-section-note">{t('settings.security.note')}</div>
            </div>
            <span className="mobile-soft-tag"><ClockCircleOutlined /> {t('settings.security.tag')}</span>
          </div>
          <Divider style={{ borderColor: 'rgba(93, 187, 123, 0.18)', margin: '0 0 12px' }} />
          <Button danger block icon={<LogoutOutlined />} onClick={handleLogout}>
            {t('settings.signOut')}
          </Button>
        </div>

        <div className="mobile-panel mobile-panel--compact">
          <div className="mobile-chip-row">
            <span className="mobile-soft-tag"><GlobalOutlined /> {t('settings.note.language')}</span>
            <span className="mobile-soft-tag"><DollarCircleOutlined /> {t('settings.note.capital')}</span>
          </div>
        </div>

      </div>

      <BottomNav />
    </div>
  );
};
