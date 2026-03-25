import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

// ── 注册所有适配器和插件（副作用：只需 import 一次）──────────────────────────
import './adapters';   // BinanceAdapter, PolygonAdapter, YahooAdapter
import './plugins';    // SMCGen3Plugin（+ bootstrap 恢复上次选中）

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
