/**
 * ErrorBoundary.tsx — 全局 React 错误捕获
 * 防止任何子组件崩溃导致整个应用白屏
 */
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button, Result } from 'antd';

interface Props  { children: ReactNode; }
interface State  { hasError: boolean; error: Error | null; componentStack: string; retryCount: number; }

const MAX_AUTO_RETRIES = 3;

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: '', retryCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentStack = info.componentStack ?? '';
    this.setState({ componentStack });

    // Log to a monitoring service in production
    const entry = {
      ts: Date.now(),
      message: error.message,
      stack: error.stack?.slice(0, 500),
      componentStack: componentStack.slice(0, 300),
    };
    try {
      const prev = JSON.parse(localStorage.getItem('error_log') || '[]');
      prev.unshift(entry);
      localStorage.setItem('error_log', JSON.stringify(prev.slice(0, 20)));
    } catch {}

    // 先嘗試自動恢復（不清緩存），連續失敗 MAX_AUTO_RETRIES 次再提示用戶
    if (this.state.retryCount < MAX_AUTO_RETRIES) {
      setTimeout(() => {
        this.setState(s => ({ hasError: false, error: null, componentStack: '', retryCount: s.retryCount + 1 }));
      }, 1000);
    }
  }

  private clearAllCache(): void {
    // Clear known state keys
    ['trading_simulator_v2', 'auto_trade_config_v2'].forEach(k => localStorage.removeItem(k));
    // Clear all sim_user_* keys
    const simKeys = Object.keys(localStorage).filter(k => k.startsWith('sim_user_'));
    simKeys.forEach(k => localStorage.removeItem(k));
    window.location.reload();
  }

  render() {
    if (this.state.hasError && this.state.retryCount >= MAX_AUTO_RETRIES) {
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
              <Button key="reset" onClick={this.clearAllCache.bind(this)}>
                清空緩存並重載
              </Button>,
            ]}
          />
          <details style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
            <summary>錯誤詳情</summary>
            <pre style={{ overflow: 'auto', maxHeight: 200 }}>{this.state.error?.stack}</pre>
            {this.state.componentStack && (
              <pre style={{ overflow: 'auto', maxHeight: 100, marginTop: 8 }}>
                {this.state.componentStack}
              </pre>
            )}
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
