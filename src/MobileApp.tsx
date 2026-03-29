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
import './mobile-theme.css';

/**
 * MobileApp — H5 訂閱系統手機端路由
 *
 * 路由對照設計文件 §7.1
 */
export const MobileApp: React.FC = () => {
  const navigate = useNavigate();
  return (
    <ConfigProvider theme={{
      algorithm: theme.darkAlgorithm,
      token: {
        colorPrimary: '#2f7df6',
        colorInfo: '#2f7df6',
        colorSuccess: '#3ddc97',
        colorWarning: '#ffbf69',
        colorError: '#ff6b6b',
        colorBgBase: '#07111f',
        colorBgContainer: '#0d1625',
        colorBgElevated: '#111d31',
        colorText: '#f5f7fb',
        colorTextSecondary: '#a6b3c8',
        colorBorder: 'rgba(148, 163, 184, 0.16)',
        borderRadius: 18,
        borderRadiusLG: 22,
        boxShadowSecondary: '0 24px 80px rgba(3, 10, 24, 0.45)',
        fontFamily: 'Avenir Next, SF Pro Display, Segoe UI Variable Display, Segoe UI, sans-serif',
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
        {/* 舊版桌面應用保留在 /desktop */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ConfigProvider>
  );
};
