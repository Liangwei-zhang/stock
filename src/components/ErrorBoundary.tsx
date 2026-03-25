/**
 * ErrorBoundary.tsx — 全局 React 错误捕获
 * 防止任何子组件崩溃导致整个应用白屏
 *
 * 增強功能：
 *  - 重試按鈕：直接重置 state 重新渲染子組件（無需刷新頁面）
 *  - 顯示錯誤摘要（非完整 stack trace）
 *  - 複製錯誤信息按鈕，方便用戶回報
 *  - componentDidCatch 記錄 componentStack 到 console.error
 */
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button, Result, Space, message } from 'antd';
import { CopyOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { safeGetItem, safeSetItem } from '../utils/storage';

interface Props  { children: ReactNode; }
interface State  { hasError: boolean; error: Error | null; componentStack: string | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 記錄完整錯誤信息（含 componentStack）到 console，便於開發調試
    console.error('[ErrorBoundary] Caught error:', error, '\nComponent stack:', info.componentStack);

    // 持久化錯誤摘要到 localStorage（最多保存 20 條）
    try {
      const entry = {
        ts:             Date.now(),
        message:        error.message,
        stack:          error.stack?.slice(0, 500),
        componentStack: info.componentStack?.slice(0, 300),
      };
      const prev = safeGetItem<typeof entry[]>('error_log', []);
      prev.unshift(entry);
      safeSetItem('error_log', prev.slice(0, 20));
    } catch {}

    this.setState({ componentStack: info.componentStack ?? null });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
  };

  private handleCopyError = () => {
    const { error, componentStack } = this.state;
    const text = [
      `錯誤：${error?.message ?? '未知錯誤'}`,
      '',
      '堆棧：',
      error?.stack ?? '（無）',
      '',
      '組件樹：',
      componentStack ?? '（無）',
    ].join('\n');

    navigator.clipboard?.writeText(text).then(
      () => { message.success('已複製錯誤信息'); },
      () => { message.error('複製失敗，請手動選取'); },
    );
  };

  render() {
    if (this.state.hasError) {
      const errMsg = this.state.error?.message ?? '未知錯誤';
      return (
        <div style={{ padding: 40 }}>
          <Result
            status="error"
            title="應用發生錯誤"
            subTitle={errMsg}
            extra={
              <Space wrap>
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  onClick={this.handleRetry}
                >
                  重試
                </Button>
                <Button
                  icon={<CopyOutlined />}
                  onClick={this.handleCopyError}
                >
                  複製錯誤信息
                </Button>
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    // Clear potentially corrupted state
                    ['trading_simulator_v2', 'auto_trade_config_v2'].forEach(k => {
                      try { localStorage.removeItem(k); } catch {}
                    });
                    window.location.reload();
                  }}
                >
                  清空緩存並重載
                </Button>
              </Space>
            }
          />
          <details style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
            <summary>錯誤詳情</summary>
            <pre style={{ overflow: 'auto', maxHeight: 200, marginTop: 8 }}>
              {this.state.error?.stack}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
