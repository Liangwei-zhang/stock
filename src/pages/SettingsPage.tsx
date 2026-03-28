import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography, Form, Input, InputNumber, Select, Button,
  Divider, message, Spin,
} from 'antd';
import { LogoutOutlined, SaveOutlined } from '@ant-design/icons';
import { useAuth, useApi } from '../hooks/useAuth';
import { BottomNav } from '../components/BottomNav';

const { Title, Text } = Typography;

interface AccountInfo {
  name?: string;
  email: string;
  locale?: string;
  timezone?: string;
  totalCapital: number;
  currency: string;
}

const CURRENCIES = ['USD', 'TWD', 'HKD', 'CNY', 'JPY', 'EUR', 'GBP'];

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#0d0d0d', color: '#fff', paddingBottom: 80 },
  header: { padding: '20px 16px 12px', background: '#141414', borderBottom: '1px solid #1f1f1f' },
  section: { padding: '16px', margin: '12px 16px 0', background: '#141414', borderRadius: 12 },
  sectionTitle: { color: '#8c8c8c', fontSize: 12, marginBottom: 12 },
};

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const apiFetch = useApi();
  const [form] = Form.useForm();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    apiFetch<AccountInfo>('/api/account')
      .then(data => {
        form.setFieldsValue({
          name: data.name ?? '',
          total_capital: data.totalCapital,
          currency: data.currency,
          locale: data.locale ?? 'zh-TW',
          timezone: data.timezone ?? 'Asia/Taipei',
        });
      })
      .catch(() => message.error('載入設置失敗'))
      .finally(() => setLoading(false));
  }, [user]);

  const handleSave = async () => {
    const vals = await form.validateFields();
    setSaving(true);
    try {
      await apiFetch('/api/account', {
        method: 'PUT',
        body: JSON.stringify({
          name: vals.name || undefined,
          total_capital: Number(vals.total_capital),
          currency: vals.currency,
          locale: vals.locale,
          timezone: vals.timezone,
        }),
      });
      message.success('設置已保存');
    } catch (err: any) {
      message.error(err.message || '保存失敗');
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
      <div style={{ ...styles.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
        <BottomNav />
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <Title level={5} style={{ color: '#fff', margin: 0 }}>⚙️ 設置</Title>
        <Text style={{ color: '#8c8c8c', fontSize: 13 }}>{user?.email}</Text>
      </div>

      <div style={styles.section}>
        <Text style={styles.sectionTitle}>帳戶設置</Text>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={<span style={{ color: '#8c8c8c' }}>顯示名稱</span>}>
            <Input
              placeholder="選填"
              style={{ background: '#1f1f1f', borderColor: '#303030', color: '#fff' }}
            />
          </Form.Item>

          <Form.Item
            name="total_capital"
            label={<span style={{ color: '#8c8c8c' }}>總資金</span>}
            rules={[{ required: true, message: '請輸入總資金' }]}
          >
            <InputNumber
              min={0}
              step={1000}
              prefix="$"
              style={{ width: '100%' }}
              placeholder="50000"
            />
          </Form.Item>

          <Form.Item name="currency" label={<span style={{ color: '#8c8c8c' }}>貨幣</span>}>
            <Select
              options={CURRENCIES.map(c => ({ label: c, value: c }))}
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item name="locale" label={<span style={{ color: '#8c8c8c' }}>語言</span>}>
            <Select
              options={[
                { label: '繁體中文', value: 'zh-TW' },
                { label: '简体中文', value: 'zh-CN' },
                { label: 'English', value: 'en-US' },
              ]}
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item name="timezone" label={<span style={{ color: '#8c8c8c' }}>時區</span>}>
            <Select
              options={[
                { label: 'Asia/Taipei (UTC+8)', value: 'Asia/Taipei' },
                { label: 'Asia/Shanghai (UTC+8)', value: 'Asia/Shanghai' },
                { label: 'Asia/Hong_Kong (UTC+8)', value: 'Asia/Hong_Kong' },
                { label: 'America/New_York (EST)', value: 'America/New_York' },
                { label: 'America/Los_Angeles (PST)', value: 'America/Los_Angeles' },
                { label: 'Europe/London (GMT)', value: 'Europe/London' },
              ]}
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Button
            type="primary"
            block
            icon={<SaveOutlined />}
            loading={saving}
            onClick={handleSave}
            style={{ marginTop: 8 }}
          >
            保存設置
          </Button>
        </Form>
      </div>

      <div style={styles.section}>
        <Text style={styles.sectionTitle}>帳號操作</Text>
        <Divider style={{ borderColor: '#1f1f1f', margin: '0 0 12px' }} />
        <Button
          danger
          block
          icon={<LogoutOutlined />}
          onClick={handleLogout}
        >
          登出
        </Button>
      </div>
    </div>
  );
};
