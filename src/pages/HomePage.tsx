import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, Progress, Spin, Button, List, Tag, message } from 'antd';
import { EditOutlined } from '@ant-design/icons';
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
}

interface AccountData {
  totalCapital: number;
  portfolioValue: number;
  availableCash: number;
  portfolioPct: number;
  currency: string;
  portfolio: PortfolioItem[];
}

const fmt = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('zh-TW', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#0d0d0d', color: '#fff', paddingBottom: 70 },
  header: { padding: '20px 16px 8px', background: '#141414', borderBottom: '1px solid #1f1f1f' },
  section: { padding: '16px', margin: '12px 16px', background: '#141414', borderRadius: 12 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  symbolTag: { fontWeight: 700, fontSize: 15, color: '#fff' },
  subtext: { fontSize: 12, color: '#8c8c8c' },
};

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const apiFetch = useApi();
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    apiFetch<AccountData>('/api/account')
      .then(setData)
      .catch(() => message.error('載入帳戶失敗'))
      .finally(() => setLoading(false));
  }, [user]);

  if (loading) {
    return (
      <div style={{ ...styles.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
        <BottomNav />
      </div>
    );
  }

  if (!data) return <div style={styles.page}><BottomNav /></div>;

  const portfolioPct = data.totalCapital > 0 ? (data.portfolioValue / data.totalCapital) * 100 : 0;
  const cashPct = 100 - portfolioPct;

  return (
    <div style={styles.page}>
      {/* 頭部 */}
      <div style={styles.header}>
        <Title level={5} style={{ color: '#fff', margin: 0 }}>
          💰 我的帳戶
        </Title>
        {user?.name && <Text style={{ color: '#8c8c8c', fontSize: 13 }}>{user.name}</Text>}
      </div>

      {/* 資金總覽 */}
      <div style={styles.section}>
        <div style={styles.row}>
          <Text style={{ color: '#8c8c8c' }}>總資金</Text>
          <Text strong style={{ color: '#fff', fontSize: 20 }}>
            {fmt(data.totalCapital, data.currency)}
          </Text>
        </div>

        <Progress
          percent={portfolioPct}
          showInfo={false}
          strokeColor="#1677ff"
          trailColor="#2a2a2a"
          style={{ margin: '8px 0' }}
        />

        <div style={styles.row}>
          <Text style={{ color: '#1677ff', fontSize: 13 }}>
            持倉 {fmt(data.portfolioValue, data.currency)} ({portfolioPct.toFixed(1)}%)
          </Text>
          <Text style={{ color: '#52c41a', fontSize: 13 }}>
            現金 {fmt(data.availableCash, data.currency)} ({cashPct.toFixed(1)}%)
          </Text>
        </div>
      </div>

      {/* 持倉明細 */}
      <div style={styles.section}>
        <div style={{ ...styles.row, marginBottom: 12 }}>
          <Text strong style={{ color: '#fff' }}>持倉明細</Text>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => navigate('/settings')}
            style={{ padding: 0 }}
          >
            修改總資金
          </Button>
        </div>

        {data.portfolio.length === 0 ? (
          <Text style={{ color: '#595959' }}>暫無持倉，前往「持倉」頁面添加</Text>
        ) : (
          <List
            dataSource={data.portfolio}
            renderItem={(item) => {
              const itemPct = data.totalCapital > 0 ? (item.total_capital / data.totalCapital) * 100 : 0;
              return (
                <List.Item style={{ padding: '8px 0', borderBottom: '1px solid #1f1f1f' }}>
                  <div style={{ width: '100%' }}>
                    <div style={styles.row}>
                      <span style={styles.symbolTag}>{item.symbol}</span>
                      <Text strong style={{ color: '#fff' }}>
                        {fmt(item.total_capital, data.currency)}
                      </Text>
                    </div>
                    <div style={styles.row}>
                      <Text style={styles.subtext}>
                        {item.shares} 股 × {fmt(item.avg_cost, data.currency)}
                      </Text>
                      <Tag color="blue" style={{ margin: 0 }}>
                        {itemPct.toFixed(1)}%
                      </Tag>
                    </div>
                    <div style={{ ...styles.row, marginBottom: 0 }}>
                      <Text style={styles.subtext}>
                        止盈 {pct(item.target_profit)} · 止損 {pct(item.stop_loss)}
                      </Text>
                    </div>
                  </div>
                </List.Item>
              );
            }}
          />
        )}
      </div>

      <BottomNav />
    </div>
  );
};
