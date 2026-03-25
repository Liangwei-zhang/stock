/**
 * ErrorBoundary.tsx — 全局 React 错误捕获
 * 防止任何子组件崩溃导致整个应用白屏
 */
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button, Result } from 'antd';

interface Props  { children: ReactNode; }
interface State  { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to a monitoring service in production
    const entry = { ts: Date.now(), message: error.message, stack: error.stack?.slice(0, 500) };
    try {
      const prev = JSON.parse(localStorage.getItem('error_log') || '[]');
      prev.unshift(entry);
      localStorage.setItem('error_log', JSON.stringify(prev.slice(0, 20)));
    } catch {}
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40 }}>
          <Result
            status="error"
            title="應用發生錯誤"
            subTitle={this.state.error?.message || '未知錯誤'}
            extra={[
              <Button type="primary" key="reload" onClick={() => window.location.reload()}>
                重新加載
              </Button>,
              <Button key="reset" onClick={() => {
                // Clear potentially corrupted state
                ['trading_simulator_v2', 'auto_trade_config_v2'].forEach(k => localStorage.removeItem(k));
                window.location.reload();
              }}>
                清空緩存並重載
              </Button>,
            ]}
          />
          <details style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
            <summary>錯誤詳情</summary>
            <pre style={{ overflow: 'auto', maxHeight: 200 }}>{this.state.error?.stack}</pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
