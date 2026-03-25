import React from 'react';
import {
  Card, Row, Col, Tag, Typography, Tooltip, Button,
} from 'antd';
import { SettingOutlined, ReloadOutlined } from '@ant-design/icons';
import { SimUserState } from '../services/simulatedUsers';

const { Text } = Typography;

export interface RankingItem {
  state:      SimUserState;
  totalValue: number;
  pnlPct:     number;
}

interface SimulatedUserRankingProps {
  ranking:    RankingItem[];
  activeUser: string | null;
  onSelect:   (userId: string) => void;
  onSettings: (state: SimUserState) => void;
  onReset:    (userId: string) => void;
}

export const SimulatedUserRanking: React.FC<SimulatedUserRankingProps> = React.memo(({
  ranking, activeUser, onSelect, onSettings, onReset,
}) => (
  <Row gutter={[12, 12]}>
    {ranking.map((item, i) => {
      const { state, totalValue, pnlPct } = item;
      const { user } = state;
      const isPos    = pnlPct >= 0;
      const winRate  = state.tradeStats?.winRate ?? null;
      const trades   = state.trades.length;

      return (
        <Col key={user.id} span={24}>
          <Card
            size="small"
            style={{
              cursor: 'pointer',
              border: activeUser === user.id
                ? '1.5px solid #1890ff'
                : '0.5px solid var(--color-border-tertiary, #e8e8e8)',
              transition: 'all 0.2s',
              background: activeUser === user.id ? 'rgba(24,144,255,0.06)' : undefined,
            }}
            onClick={() => onSelect(user.id)}
          >
            <Row align="middle" gutter={8}>
              <Col>
                <Text style={{ fontSize: 22 }}>{i < 3 ? ['🥇','🥈','🥉'][i] : `#${i + 1}`}</Text>
              </Col>
              <Col flex={1}>
                <Row align="middle" gutter={4}>
                  <Col><Text style={{ fontSize: 16 }}>{user.emoji}</Text></Col>
                  <Col>
                    <Text strong style={{ fontSize: 13 }}>{user.name}</Text>
                    {state.paused && <Tag color="orange" style={{ marginLeft: 4, fontSize: 10 }}>暫停</Tag>}
                  </Col>
                </Row>
                <Text type="secondary" style={{ fontSize: 11 }}>{user.description}</Text>
                {state.allowedSymbols.length > 0 ? (
                  <div style={{ marginTop: 2 }}>
                    {state.allowedSymbols.slice(0, 4).map(sym => (
                      <Tag key={sym} style={{ margin: '1px 2px', fontSize: 10, padding: '0 4px' }}>{sym}</Tag>
                    ))}
                    {state.allowedSymbols.length > 4 && (
                      <Tag style={{ margin: '1px 2px', fontSize: 10, padding: '0 4px' }}>
                        +{state.allowedSymbols.length - 4}
                      </Tag>
                    )}
                  </div>
                ) : (
                  <Text type="secondary" style={{ fontSize: 10 }}>交易所有標的</Text>
                )}
              </Col>
              <Col style={{ textAlign: 'right', minWidth: 100 }}>
                <div style={{ fontSize: 16, fontWeight: 500, color: isPos ? '#52c41a' : '#ff4d4f' }}>
                  {isPos ? '+' : ''}{pnlPct.toFixed(2)}%
                </div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  ${totalValue.toFixed(0)} | {trades} 筆
                  {winRate !== null && ` | 勝${(winRate * 100).toFixed(0)}%`}
                </Text>
              </Col>
              <Col>
                <Tooltip title="設置策略">
                  <Button
                    size="small" type="text" icon={<SettingOutlined />}
                    onClick={e => { e.stopPropagation(); onSettings(state); }}
                  />
                </Tooltip>
                <Tooltip title="重置此用戶">
                  <Button
                    size="small" type="text" danger icon={<ReloadOutlined />}
                    onClick={e => { e.stopPropagation(); onReset(user.id); }}
                  />
                </Tooltip>
              </Col>
            </Row>

            {/* 迷你指標行 */}
            <Row gutter={8} style={{ marginTop: 8 }}>
              {[
                { label: '持倉',    val: state.positions.size,                                                     color: state.positions.size > 0 ? '#1890ff' : '#8b949e' },
                { label: '盈虧比',  val: state.tradeStats ? state.tradeStats.profitFactor.toFixed(1) : '-',        color: undefined },
                { label: '最大回撤', val: state.tradeStats ? `${(state.tradeStats.maxDrawdown * 100).toFixed(1)}%` : '-', color: undefined },
                { label: 'Sharpe', val: state.tradeStats ? state.tradeStats.sharpeRatio.toFixed(2) : '-',          color: undefined },
              ].map(m => (
                <Col key={m.label}>
                  <Text type="secondary" style={{ fontSize: 10 }}>{m.label}</Text>
                  <div style={{ fontSize: 12, fontWeight: 500, color: m.color }}>{m.val}</div>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      );
    })}
  </Row>
));

SimulatedUserRanking.displayName = 'SimulatedUserRanking';
