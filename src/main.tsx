import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { MobileApp } from './MobileApp';
import { AuthProvider } from './hooks/useAuth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { I18nProvider } from './i18n';

// ── 注册所有适配器和插件（副作用：只需 import 一次）──────────────────────────
import './adapters';   // BinanceAdapter, PolygonAdapter, YahooAdapter
import './plugins';    // SMCGen3Plugin（+ bootstrap 恢复上次选中）

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <I18nProvider>
          <Routes>
            {/* 舊版桌面分析工具 */}
            <Route path="/desktop" element={<App />} />
            {/* H5 手機端訂閱系統（餘下所有路由） */}
            <Route path="/*" element={<MobileApp />} />
          </Routes>
        </I18nProvider>
      </AuthProvider>
    </BrowserRouter>
  </ErrorBoundary>,
);
