import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, Spin, Button, message } from 'antd';
import { BellOutlined, CreditCardOutlined, LineChartOutlined, SettingOutlined, StarOutlined } from '@ant-design/icons';
import { useAuth, useApi } from '../hooks/useAuth';
import { BottomNav } from '../components/BottomNav';
import { useI18n } from '../i18n';

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

interface AccountResponse {
  account: {
    totalCapital: number;
    portfolioValue: number;
    availableCash: number;
    portfolioPct: number;
    currency: string;
  };
  portfolio: Array<{
    symbol: string;
    shares: number;
    avgCost: number;
    totalCapital: number;
    pct: number;
  }>;
}

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const apiFetch = useApi();
  const { t, formatCurrency, formatNumber } = useI18n();
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);

  const fmtMoney = (value: number, currency = 'USD', digits = 0) =>
    formatCurrency(value, currency, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  const fmtShares = (value: number) =>
    formatNumber(Math.trunc(value), { maximumFractionDigits: 0 });

  const fmtPct = (value: number, digits = 1) =>
    formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    apiFetch<AccountResponse>('/api/account')
      .then(res => setData({
        totalCapital: res.account.totalCapital,
        portfolioValue: res.account.portfolioValue,
        availableCash: res.account.availableCash,
        portfolioPct: res.account.portfolioPct,
        currency: res.account.currency,
        portfolio: res.portfolio.map((item, index) => ({
          id: `${item.symbol}-${index}`,
          symbol: item.symbol,
          shares: item.shares,
          avg_cost: item.avgCost,
          total_capital: item.totalCapital,
          target_profit: 0,
          stop_loss: 0,
        })),
      }))
      .catch(() => message.error(t('settings.loadFailed')))
      .finally(() => setLoading(false));
  }, [user]);

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

  if (!data) return <div className="mobile-shell"><div className="mobile-shell__inner" /><BottomNav /></div>;

  const portfolioPct = data.totalCapital > 0
    ? Math.max(0, Math.min(100, (data.portfolioValue / data.totalCapital) * 100))
    : 0;
  const cashPct = Math.max(0, 100 - portfolioPct);
  const sortedPortfolio = [...data.portfolio].sort((a, b) => b.total_capital - a.total_capital);
  const largestHolding = sortedPortfolio[0];
  const orbStyle = { ['--orb-fill' as string]: `${portfolioPct}%` } as React.CSSProperties;
  const summaryCards = [
    {
      label: t('home.summary.holdings'),
      value: `${data.portfolio.length}`,
      caption: t('home.summary.holdings.caption'),
    },
    {
      label: t('home.summary.largestWeight'),
      value: largestHolding ? `${fmtPct((largestHolding.total_capital / data.totalCapital) * 100)}%` : '—',
      caption: largestHolding
        ? t('home.summary.largestWeight.caption.symbol', { symbol: largestHolding.symbol })
        : t('home.summary.largestWeight.caption.empty'),
    },
    {
      label: t('home.summary.cashReserve'),
      value: fmtMoney(data.availableCash, data.currency, 0),
      caption: t('home.summary.cashReserve.caption'),
    },
  ];
  const quickActions = [
    { key: 'watchlist', title: t('home.quick.watchlist.title'), text: t('home.quick.watchlist.text'), icon: <StarOutlined />, onClick: () => navigate('/watchlist') },
    { key: 'portfolio', title: t('home.quick.portfolio.title'), text: t('home.quick.portfolio.text'), icon: <LineChartOutlined />, onClick: () => navigate('/portfolio') },
    { key: 'notifications', title: t('home.quick.notifications.title'), text: t('home.quick.notifications.text'), icon: <BellOutlined />, onClick: () => navigate('/notifications') },
    { key: 'settings', title: t('home.quick.settings.title'), text: t('home.quick.settings.text'), icon: <SettingOutlined />, onClick: () => navigate('/settings') },
  ];

  return (
    <div className="mobile-shell">
      <div className="mobile-shell__inner">
        <div className="mobile-premium-hero">
          <div className="mobile-premium-hero__top">
            <div className="mobile-premium-hero__copy">
              <div className="mobile-eyebrow">{t('home.eyebrow')}</div>
              <Title level={2} className="mobile-page-title" style={{ fontSize: 34, margin: 0 }}>
                {t('home.title')}
              </Title>
              <Text className="mobile-page-subtitle" style={{ display: 'block' }}>
                {user?.name
                  ? t('home.subtitle.named', { name: user.name })
                  : t('home.subtitle.generic')}
              </Text>
            </div>
            <div className="mobile-premium-hero__actions">
              <Button className="mobile-ghost-action" icon={<BellOutlined />} onClick={() => navigate('/notifications')}>
                {t('home.action.inbox')}
              </Button>
              <Button className="mobile-ghost-action" icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
                {t('home.action.settings')}
              </Button>
            </div>
          </div>
          <div className="mobile-inline-metrics">
            <span className="mobile-inline-metric">{t('home.metric.base')} <strong>{data.currency}</strong></span>
            <span className="mobile-inline-metric">{t('home.metric.portfolio')} <strong>{fmtPct(portfolioPct)}%</strong></span>
            <span className="mobile-inline-metric">{t('home.metric.cash')} <strong>{fmtPct(cashPct)}%</strong></span>
          </div>
        </div>

        <div className="mobile-capital-stage">
          <div className="mobile-section-header">
            <div>
              <div className="mobile-section-title">{t('home.capitalSplit.title')}</div>
              <div className="mobile-section-note">{t('home.capitalSplit.note')}</div>
            </div>
            <Button className="mobile-ghost-action" icon={<CreditCardOutlined />} onClick={() => navigate('/settings')}>
              {t('home.editCapital')}
            </Button>
          </div>
          <div className="mobile-capital-grid">
            <div>
              <div className="mobile-summary-label">{t('home.totalCapital')}</div>
              <div className="mobile-capital-value">{fmtMoney(data.totalCapital, data.currency, 0)}</div>
              <div className="mobile-meter" style={{ marginTop: 14 }}>
                <span style={{ width: `${Math.min(100, Math.max(portfolioPct, sortedPortfolio.length > 0 ? 8 : 0))}%` }} />
              </div>
              <div className="mobile-split-row">
                <span>{t('home.split.portfolio')} <strong>{fmtMoney(data.portfolioValue, data.currency, 0)}</strong> ({fmtPct(portfolioPct)}%)</span>
                <span>{t('home.split.cash')} <strong>{fmtMoney(data.availableCash, data.currency, 0)}</strong> ({fmtPct(cashPct)}%)</span>
              </div>
              <div className="mobile-caption" style={{ marginTop: 14 }}>
                {t('home.capitalSplit.caption')}
              </div>
            </div>
            <div className="mobile-orb-card">
              <div className="mobile-orb" style={orbStyle}>
                <div className="mobile-orb__inner">
                  <div className="mobile-orb__value">{formatNumber(portfolioPct, { maximumFractionDigits: 0 })}%</div>
                  <div className="mobile-orb__label">{t('home.invested')}</div>
                </div>
              </div>
              <div className="mobile-orb-note">{t('home.activeHoldings', { count: data.portfolio.length })}</div>
            </div>
          </div>
        </div>

        <div className="mobile-summary-grid">
          {summaryCards.map(card => (
            <div key={card.label} className="mobile-summary-card">
              <div className="mobile-summary-label">{card.label}</div>
              <div className="mobile-summary-value">{card.value}</div>
              <div className="mobile-summary-caption">{card.caption}</div>
            </div>
          ))}
        </div>

        <div className="mobile-panel mobile-panel--highlight">
          <div className="mobile-section-header">
            <div>
              <div className="mobile-section-title">{t('home.breakdown.title')}</div>
              <div className="mobile-section-note">{t('home.breakdown.note')}</div>
            </div>
            <span className="mobile-soft-tag">{t('home.breakdown.lines', { count: sortedPortfolio.length })}</span>
          </div>

          {sortedPortfolio.length === 0 ? (
            <div className="mobile-empty">
              <Text className="mobile-muted">{t('home.breakdown.empty')}</Text>
              <Button type="primary" style={{ marginTop: 12 }} onClick={() => navigate('/portfolio')}>{t('home.breakdown.addFirst')}</Button>
            </div>
          ) : (
            <div className="mobile-allocation-list">
              {sortedPortfolio.map(item => {
                const itemPct = data.totalCapital > 0 ? (item.total_capital / data.totalCapital) * 100 : 0;
                return (
                  <div key={item.id} className="mobile-allocation-item">
                    <div className="mobile-allocation-head">
                      <div>
                        <div className="mobile-allocation-symbol">{item.symbol}</div>
                        <div className="mobile-allocation-meta">
                            <span>{fmtShares(item.shares)} {t('home.breakdown.shares')}</span>
                            <span>{t('home.breakdown.avg', { price: fmtMoney(item.avg_cost, data.currency, 2) })}</span>
                        </div>
                      </div>
                      <div className="mobile-allocation-value">
                        <strong>{fmtMoney(item.total_capital, data.currency, 0)}</strong>
                          <span>{t('home.breakdown.ofTotal', { pct: fmtPct(itemPct) })}</span>
                      </div>
                    </div>
                    <div className="mobile-allocation-bar">
                      <span style={{ width: `${Math.min(100, Math.max(itemPct, 8))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mobile-action-grid" style={{ marginBottom: 14 }}>
          {quickActions.map(action => (
            <div key={action.key} className="mobile-action-card" onClick={action.onClick}>
              <div className="mobile-action-icon">{action.icon}</div>
              <div className="mobile-action-title">{action.title}</div>
              <div className="mobile-action-text">{action.text}</div>
            </div>
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
};
