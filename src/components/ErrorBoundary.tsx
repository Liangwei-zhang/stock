/**
 * ErrorBoundary.tsx — 分區域錯誤隔離、自動恢復與日誌收集
 *
 * 支持：
 *  - zone 屬性標識錯誤所在區域（chart / analysis / trading / default）
 *  - retry 機制：最多 3 次自動恢復，第 4 次才顯示錯誤 UI
 *  - 錯誤日誌持久化到 localStorage（保留最近 50 條）
 */
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button, Result, Alert } from 'antd';

const MAX_LOG_ENTRIES = 50;
const MAX_AUTO_RETRIES = 2; // 自動恢復最多 2 次，之後顯示錯誤 UI

// ─── ErrorLogService ──────────────────────────────────────────────────────────

export interface ErrorLogEntry {
  ts:      number;
  zone:    string;
  message: string;
  stack?:  string;
}

export const errorLogService = {
  log(zone: string, error: Error, _info?: ErrorInfo): void {
    try {
      const entry: ErrorLogEntry = {
        ts:      Date.now(),
        zone,
        message: error.message,
        stack:   error.stack?.slice(0, 600),
      };
      const prev: ErrorLogEntry[] = JSON.parse(localStorage.getItem('error_log') || '[]');
      prev.unshift(entry);
      localStorage.setItem('error_log', JSON.stringify(prev.slice(0, MAX_LOG_ENTRIES)));
    } catch { /* localStorage unavailable */ }
  },

  getAll(): ErrorLogEntry[] {
    try {
      return JSON.parse(localStorage.getItem('error_log') || '[]');
    } catch { return []; }
  },

  clear(): void {
    try { localStorage.removeItem('error_log'); } catch { /* ignore */ }
  },
};

// ─── Props / State ────────────────────────────────────────────────────────────

interface Props {
  children:  ReactNode;
  /** 區域標識，用於錯誤日誌與 UI 顯示 */
  zone?:     string;
  /** 是否允許自動重試恢復（默認 true）*/
  autoRetry?: boolean;
  /** 自定義錯誤後備 UI */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  hasError:   boolean;
  error:      Error | null;
  retryCount: number;
}

// ─── ErrorBoundary ────────────────────────────────────────────────────────────

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, retryCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const zone = this.props.zone ?? 'default';
    errorLogService.log(zone, error, info);

    // 自動恢復：在短暫延遲後重置（最多 MAX_AUTO_RETRIES 次）
    if ((this.props.autoRetry ?? true) && this.state.retryCount < MAX_AUTO_RETRIES) {
      setTimeout(() => {
        this.setState(s => ({
          hasError:   false,
          error:      null,
          retryCount: s.retryCount + 1,
        }));
      }, 1500 * (this.state.retryCount + 1)); // 指數退避：1.5s、3s
    }
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null, retryCount: 0 });
  };

  private handleHardReset = (): void => {
    ['trading_simulator_v2', 'auto_trade_config_v2'].forEach(k => localStorage.removeItem(k));
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const { error } = this.state;
    const zone      = this.props.zone ?? '應用';

    // 使用自定義 fallback（如果提供）
    if (this.props.fallback && error) {
      return <>{this.props.fallback(error, this.handleReset)}</>;
    }

    // 自動恢復中：顯示輕量提示而非完整錯誤頁
    if ((this.props.autoRetry ?? true) && this.state.retryCount < MAX_AUTO_RETRIES) {
      return (
        <div style={{ padding: 16 }}>
          <Alert
            type="warning"
            message={`${zone} 發生錯誤，正在自動恢復…`}
            description={error?.message}
            showIcon
          />
        </div>
      );
    }

    return (
      <div style={{ padding: 40 }}>
        <Result
          status="error"
          title={`${zone} 發生錯誤`}
          subTitle={error?.message || '未知錯誤'}
          extra={[
            <Button type="primary" key="reset" onClick={this.handleReset}>
              重試
            </Button>,
            <Button key="reload" onClick={() => window.location.reload()}>
              重新加載
            </Button>,
            <Button key="hardReset" danger onClick={this.handleHardReset}>
              清空緩存並重載
            </Button>,
          ]}
        />
        <details style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
          <summary>錯誤詳情（{zone}）</summary>
          <pre style={{ overflow: 'auto', maxHeight: 200 }}>{error?.stack}</pre>
        </details>
      </div>
    );
  }
}
