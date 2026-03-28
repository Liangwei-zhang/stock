import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography, List, Button, Modal, Input, InputNumber,
  Spin, message, Empty, Tag, Popconfirm, Form, Progress,
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useAuth, useApi } from '../hooks/useAuth';
import { BottomNav } from '../components/BottomNav';

const { Title, Text } = Typography;

interface PortfolioItem {
  id: string;
  symbol: string;
  shares: number;
  avg_cost: number;
  total_capital: number;
  target_profit: number;
  stop_loss: number;
  notes?: string;
}

interface AccountSummary {
  totalCapital: number;
  currency: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#0d0d0d', color: '#fff', paddingBottom: 70 },
  header: { padding: '20px 16px 12px', background: '#141414', borderBottom: '1px solid #1f1f1f', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  section: { padding: '0 16px' },
  item: { background: '#141414', borderRadius: 10, padding: '12px 16px', margin: '10px 0' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  subtext: { fontSize: 12, color: '#8c8c8c' },
};

export const PortfolioPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const apiFetch = useApi();
  const [form] = Form.useForm();

  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<PortfolioItem | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    load();
  }, [user]);

  const load = async () => {
    setLoading(true);
    try {
      const [portfolio, acc] = await Promise.all([
        apiFetch<PortfolioItem[]>('/api/portfolio'),
        apiFetch<AccountSummary>('/api/account'),
      ]);
      setItems(portfolio);
      setAccount(acc);
    } catch {
      message.error('載入持倉失敗');
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditItem(null);
    form.resetFields();
    form.setFieldsValue({ target_profit: 15, stop_loss: 8 });
    setModalOpen(true);
  };

  const openEdit = (item: PortfolioItem) => {
    setEditItem(item);
    form.setFieldsValue({
      symbol: item.symbol,
      shares: item.shares,
      avg_cost: item.avg_cost,
      target_profit: +(item.target_profit * 100).toFixed(0),
      stop_loss: +(item.stop_loss * 100).toFixed(0),
      notes: item.notes,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const vals = await form.validateFields();
    setSaving(true);
    try {
      const body = {
        symbol: vals.symbol?.toUpperCase(),
        shares: Number(vals.shares),
        avg_cost: Number(vals.avg_cost),
        target_profit: vals.target_profit / 100,
        stop_loss: vals.stop_loss / 100,
        notes: vals.notes || '',
      };
      if (editItem) {
        await apiFetch(`/api/portfolio/${editItem.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        message.success('持倉已更新');
      } else {
        await apiFetch('/api/portfolio', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        message.success(`${body.symbol} 已添加`);
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      message.error(err.message || '保存失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, symbol: string) => {
    try {
      await apiFetch(`/api/portfolio/${id}`, { method: 'DELETE' });
      message.success(`${symbol} 已移除`);
      setItems(prev => prev.filter(i => i.id !== id));
    } catch {
      message.error('刪除失敗');
    }
  };

  const totalPortfolio = items.reduce((s, i) => s + i.total_capital, 0);
  const currency = account?.currency ?? 'USD';
  const totalCapital = account?.totalCapital ?? 0;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <Title level={5} style={{ color: '#fff', margin: 0 }}>📊 我的持倉</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          size="small"
          onClick={openAdd}
        >
          添加
        </Button>
      </div>

      {/* 分配概覽 */}
      {totalCapital > 0 && (
        <div style={{ padding: '12px 16px', background: '#141414', marginBottom: 2 }}>
          <div style={styles.row}>
            <Text style={{ color: '#8c8c8c', fontSize: 12 }}>持倉佔比</Text>
            <Text style={{ color: '#1677ff', fontSize: 12 }}>
              {((totalPortfolio / totalCapital) * 100).toFixed(1)}%
            </Text>
          </div>
          <Progress
            percent={+(totalPortfolio / totalCapital * 100).toFixed(1)}
            showInfo={false}
            strokeColor="#1677ff"
            trailColor="#2a2a2a"
          />
        </div>
      )}

      <div style={styles.section}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : items.length === 0 ? (
          <Empty description="暫無持倉" style={{ padding: 40, color: '#595959' }} />
        ) : (
          items.map(item => {
            const itemPct = totalCapital > 0 ? (item.total_capital / totalCapital * 100).toFixed(1) : '0';
            return (
              <div key={item.id} style={styles.item}>
                <div style={styles.row}>
                  <Text strong style={{ color: '#fff', fontSize: 16 }}>{item.symbol}</Text>
                  <Text strong style={{ color: '#fff' }}>
                    ${fmt(item.total_capital)}
                  </Text>
                </div>
                <div style={styles.row}>
                  <Text style={styles.subtext}>
                    {item.shares} 股 × ${fmt(item.avg_cost)}
                  </Text>
                  <Tag color="blue" style={{ margin: 0 }}>{itemPct}%</Tag>
                </div>
                <div style={styles.row}>
                  <Text style={{ ...styles.subtext, color: '#52c41a' }}>
                    止盈 {pct(item.target_profit)}
                  </Text>
                  <Text style={{ ...styles.subtext, color: '#ff4d4f' }}>
                    止損 {pct(item.stop_loss)}
                  </Text>
                  <div>
                    <Button
                      type="text"
                      icon={<EditOutlined />}
                      size="small"
                      style={{ color: '#8c8c8c' }}
                      onClick={() => openEdit(item)}
                    />
                    <Popconfirm
                      title={`確認移除 ${item.symbol}？`}
                      onConfirm={() => handleDelete(item.id, item.symbol)}
                      okText="移除"
                      cancelText="取消"
                    >
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        size="small"
                      />
                    </Popconfirm>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 添加/編輯彈窗 */}
      <Modal
        open={modalOpen}
        title={editItem ? `編輯 ${editItem.symbol}` : '添加持倉'}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        styles={{ content: { background: '#141414' }, header: { background: '#141414', color: '#fff' } }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="symbol" label={<span style={{ color: '#8c8c8c' }}>股票代碼</span>} rules={[{ required: true, message: '請輸入代碼' }]}>
            <Input
              placeholder="AAPL、NVDA、BTC-USD..."
              disabled={!!editItem}
              style={{ background: '#1f1f1f', borderColor: '#303030', color: '#fff' }}
              onChange={e => form.setFieldValue('symbol', e.target.value.toUpperCase())}
            />
          </Form.Item>
          <Form.Item name="shares" label={<span style={{ color: '#8c8c8c' }}>持有股數</span>} rules={[{ required: true }]}>
            <InputNumber
              min={0.000001}
              step={1}
              style={{ width: '100%', background: '#1f1f1f', borderColor: '#303030' }}
              placeholder="100"
            />
          </Form.Item>
          <Form.Item name="avg_cost" label={<span style={{ color: '#8c8c8c' }}>平均成本（{currency}）</span>} rules={[{ required: true }]}>
            <InputNumber
              min={0.000001}
              step={0.01}
              prefix="$"
              style={{ width: '100%', background: '#1f1f1f', borderColor: '#303030' }}
              placeholder="200.00"
            />
          </Form.Item>
          <Form.Item name="target_profit" label={<span style={{ color: '#8c8c8c' }}>止盈 %</span>}>
            <InputNumber min={1} max={200} step={1} suffix="%" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="stop_loss" label={<span style={{ color: '#8c8c8c' }}>止損 %</span>}>
            <InputNumber min={1} max={50} step={1} suffix="%" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label={<span style={{ color: '#8c8c8c' }}>備註（選填）</span>}>
            <Input
              placeholder="備註..."
              style={{ background: '#1f1f1f', borderColor: '#303030', color: '#fff' }}
            />
          </Form.Item>
        </Form>
      </Modal>

      <BottomNav />
    </div>
  );
};
