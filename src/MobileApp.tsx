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

/**
 * MobileApp — H5 訂閱系統手機端路由
 *
 * 路由對照設計文件 §7.1
 */
export const MobileApp: React.FC = () => {
  const navigate = useNavigate();
  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
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
