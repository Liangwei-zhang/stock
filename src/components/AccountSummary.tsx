import React from 'react';
import { Row, Col, Switch, Typography } from 'antd';

const { Text } = Typography;

interface StatItem {
  t: string;
  v: number;
  p: string;
  s?: string;
  c: string | undefined;
}

interface AccountSummaryProps {
  balance:          number;
  totalValue:       number;
  totalPnL:         number;
  totalPnLPercent:  number;
  autoTradeEnabled: boolean;
  onToggleAutoTrade: (v: boolean) => void;
}

export const AccountSummary: React.FC<AccountSummaryProps> = React.memo(({
  balance, totalValue, totalPnL, totalPnLPercent, autoTradeEnabled, onToggleAutoTrade,
}) => {
  const pnlColor = totalPnL >= 0 ? '#52c41a' : '#ff4d4f';
  return (
    <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
      {([
        { t: '可用餘額', v: balance,                       p: '$',                                    c: undefined },
        { t: '持倉市值', v: totalValue - balance,          p: '$',                                    c: undefined },
        { t: '總資產',   v: totalValue,                    p: '$',                                    c: undefined },
        { t: '總盈虧',   v: Math.abs(totalPnL),            p: totalPnL >= 0 ? '+$' : '-$',           c: pnlColor  },
        { t: '收益率',   v: Math.abs(totalPnLPercent),     p: totalPnLPercent >= 0 ? '+' : '-', s: '%', c: pnlColor },
      ] as StatItem[]).map(m => (
        <Col key={m.t} span={4}>
          <div style={{ background: 'var(--color-background-secondary,#f5f5f5)', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 11, color: '#8b949e' }}>{m.t}</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: m.c }}>
              {m.p}{(m.v ?? 0).toLocaleString('en', { maximumFractionDigits: 2 })}{m.s ?? ''}
            </div>
          </div>
        </Col>
      ))}
      <Col span={4}>
        <div style={{
          background: autoTradeEnabled ? 'rgba(82,196,26,0.1)' : 'var(--color-background-secondary,#f5f5f5)',
          borderRadius: 8, padding: '8px 12px',
          border: autoTradeEnabled ? '1px solid rgba(82,196,26,0.4)' : undefined,
        }}>
          <div style={{ fontSize: 11, color: '#8b949e' }}>自動交易</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <Switch checked={autoTradeEnabled} onChange={onToggleAutoTrade} size="small" />
            <Text style={{ fontSize: 13, color: autoTradeEnabled ? '#52c41a' : '#8b949e' }}>
              {autoTradeEnabled ? '運行中' : '已暫停'}
            </Text>
          </div>
        </div>
      </Col>
    </Row>
  );
});

AccountSummary.displayName = 'AccountSummary';
