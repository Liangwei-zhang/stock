import React from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
import LoginPage from './pages/LoginPage';
import OnboardPage from './pages/OnboardPage';
import { HomePage } from './pages/HomePage';
import { WatchlistPage } from './pages/WatchlistPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SettingsPage } from './pages/SettingsPage';
import TradeAdjustPage from './pages/TradeAdjustPage';
import { TradeSuccessPage } from './pages/TradeSuccessPage';
import { useI18n } from './i18n';
import './mobile-theme.css';

/**
 * MobileApp — H5 訂閱系統手機端路由
 *
 * 路由對照設計文件 §7.1
 */
export const MobileApp: React.FC = () => {
  const navigate = useNavigate();
  const { antdLocale } = useI18n();
  return (
    <ConfigProvider locale={antdLocale} theme={{
      algorithm: theme.defaultAlgorithm,
      token: {
        colorPrimary: '#2f8c57',
        colorInfo: '#2f8c57',
        colorSuccess: '#67b783',
        colorWarning: '#c8aa6f',
        colorError: '#ff6b6b',
        colorBgBase: '#f8fbf8',
        colorBgContainer: '#ffffff',
        colorBgElevated: '#ffffff',
        colorText: '#14261d',
        colorTextSecondary: '#5c7367',
        colorBorder: 'rgba(84, 155, 108, 0.18)',
        borderRadius: 20,
        borderRadiusLG: 24,
        boxShadowSecondary: '0 28px 70px rgba(84, 135, 101, 0.18)',
        fontFamily: 'Aptos, Avenir Next, SF Pro Display, Segoe UI Variable Display, Segoe UI, Helvetica Neue, Arial, sans-serif',
      },
      components: {
        Button: {
          controlHeightLG: 48,
          borderRadiusLG: 16,
          fontWeight: 600,
        },
        Input: {
          controlHeightLG: 48,
        },
        InputNumber: {
          controlHeightLG: 48,
        },
        Select: {
          controlHeightLG: 48,
        },
        Modal: {
          borderRadiusLG: 24,
        },
      },
    }}>
      <Routes>
        <Route path="/login"           element={<LoginPage onSuccess={(isNew) => navigate(isNew ? '/onboard' : '/')} />} />
        <Route path="/onboard"         element={<OnboardPage onComplete={() => navigate('/')} />} />
        <Route path="/"                element={<HomePage />} />
        <Route path="/watchlist"       element={<WatchlistPage />} />
        <Route path="/portfolio"       element={<PortfolioPage />} />
        <Route path="/notifications"   element={<NotificationsPage />} />
        <Route path="/settings"        element={<SettingsPage />} />
        <Route path="/trade/adjust"    element={<TradeAdjustPage />} />
        <Route path="/trade/success"   element={<TradeSuccessPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ConfigProvider>
  );
};
