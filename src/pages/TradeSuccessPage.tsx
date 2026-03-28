import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, Result } from 'antd';

/**
 * TradeSuccessPage — 郵件確認連結的落地頁
 * 路由：/trade/success?action=confirmed|ignored&symbol=AAPL
 */
export const TradeSuccessPage: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const action = params.get('action') ?? 'confirmed';
  const symbol = params.get('symbol') ?? '';

  const config =
    action === 'ignored'
      ? {
          status: 'info' as const,
          title: '已忽略本次建議',
          subtitle: `${symbol ? `${symbol} ` : ''}此次交易建議已標記為忽略，持倉不會有任何變動。`,
        }
      : action === 'adjusted'
      ? {
          status: 'success' as const,
          title: '已提交調整',
          subtitle: `${symbol ? `${symbol} ` : ''}實際操作已記錄，持倉已按您的實際數量更新。`,
        }
      : {
          status: 'success' as const,
          title: '交易確認成功',
          subtitle: `${symbol ? `${symbol} ` : ''}持倉已按建議自動更新，感謝您的確認。`,
        };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0d0d0d',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <Result
        status={config.status}
        title={<span style={{ color: '#fff' }}>{config.title}</span>}
        subTitle={<span style={{ color: '#8c8c8c' }}>{config.subtitle}</span>}
        extra={[
          <Button
            key="home"
            type="primary"
            onClick={() => navigate('/')}
          >
            查看帳戶
          </Button>,
        ]}
        style={{ background: '#141414', borderRadius: 12, padding: '32px 24px' }}
      />
    </div>
  );
};
