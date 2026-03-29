import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, Result } from 'antd';
import { useI18n } from '../i18n';

/**
 * TradeSuccessPage — 郵件確認連結的落地頁
 * 路由：/trade/success?action=confirmed|ignored&symbol=AAPL
 */
export const TradeSuccessPage: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const action = params.get('action') ?? 'confirmed';
  const symbol = params.get('symbol') ?? '';
  const symbolLabel = symbol ? symbol : '';

  const config =
    action === 'ignored'
      ? {
          status: 'info' as const,
          title: t('tradeSuccess.ignored.title'),
          subtitle: t('tradeSuccess.ignored.subtitle', { symbol: symbolLabel }),
        }
      : action === 'adjusted'
      ? {
          status: 'success' as const,
          title: t('tradeSuccess.adjusted.title'),
          subtitle: t('tradeSuccess.adjusted.subtitle', { symbol: symbolLabel }),
        }
      : {
          status: 'success' as const,
          title: t('tradeSuccess.confirmed.title'),
          subtitle: t('tradeSuccess.confirmed.subtitle', { symbol: symbolLabel }),
        };

  return (
    <div className="mobile-result-shell">
      <Result
        status={config.status}
        title={<span style={{ color: '#183024' }}>{config.title}</span>}
        subTitle={<span style={{ color: '#5f7a6a' }}>{config.subtitle}</span>}
        extra={[
          <Button
            key="home"
            type="primary"
            onClick={() => navigate('/')}
          >
            {t('tradeSuccess.openHome')}
          </Button>,
        ]}
        className="mobile-result-card"
      />
    </div>
  );
};
