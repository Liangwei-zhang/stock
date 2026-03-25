/**
 * SimulatedUsersPanel.tsx — 模拟用户排行榜 + 决策日志面板（父組件）
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Switch, Button, Typography, InputNumber, Space,
} from 'antd';
import {
  ThunderboltOutlined, ReloadOutlined, PauseOutlined,
} from '@ant-design/icons';
import {
  simulatedUserService,
  SimUserState,
} from '../services/simulatedUsers';
import { SimulatedUserRanking, RankingItem } from './SimulatedUserRanking';
import { SimulatedUserDetail } from './SimulatedUserDetail';
import { SimulatedUserConfig } from './SimulatedUserConfig';

const { Text, Title } = Typography;

interface Props {
  prices:   Map<string, number>;
  symbols:  string[];
  embedded?: boolean;
}

export const SimulatedUsersPanel: React.FC<Props> = ({ prices, symbols, embedded }) => {
  const [enabled,     setEnabled]     = useState(simulatedUserService.isEnabled());
  const [states,      setStates]      = useState<SimUserState[]>([]);
  const [ranking,     setRanking]     = useState<RankingItem[]>([]);
  const [activeUser,  setActiveUser]  = useState<string | null>(null);
  const [settingUser, setSettingUser] = useState<SimUserState | null>(null);
  const [resetBal,    setResetBal]    = useState<number>(50000);

  const refresh = useCallback(() => {
    setStates(simulatedUserService.getStates());
    setRanking(simulatedUserService.getRanking(prices));
  }, [prices]);

  useEffect(() => {
    simulatedUserService.setOnUpdate(refresh);
    refresh();
    return () => simulatedUserService.setOnUpdate(() => {});
  }, [refresh]);

  const handleEnable   = (v: boolean) => { simulatedUserService.setEnabled(v); setEnabled(v); };
  const handleResetAll = () => { simulatedUserService.resetAll(resetBal); refresh(); };
  const handleResetUser = (userId: string) => { simulatedUserService.resetUser(userId); refresh(); };
  const handleSelectUser = (userId: string) => setActiveUser(prev => prev === userId ? null : userId);

  const selectedState = activeUser ? states.find(s => s.user.id === activeUser) : null;

  return (
    <Card style={{ marginTop: embedded ? 0 : 16, border: embedded ? 'none' : undefined, background: embedded ? 'transparent' : undefined }}>
      {/* 頭部控制欄 */}
      <Row align="middle" gutter={16} style={{ marginBottom: 16 }}>
        <Col>
          <ThunderboltOutlined style={{ fontSize: 20, marginRight: 8 }} />
          <Title level={4} style={{ margin: 0, display: 'inline' }}>模拟用户竞技场</Title>
        </Col>
        <Col flex={1} />
        <Col>
          <Space>
            <Text>初始資金</Text>
            <InputNumber
              value={resetBal}
              onChange={v => setResetBal(v ?? 50000)}
              formatter={v => `$${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={v => Number(v?.replace(/\$|,/g, ''))}
              style={{ width: 120 }}
              size="small"
            />
            <Button size="small" danger icon={<ReloadOutlined />} onClick={handleResetAll}>重置全部</Button>
            <Text>模擬開關</Text>
            <Switch checked={enabled} onChange={handleEnable} />
          </Space>
        </Col>
      </Row>

      {!enabled && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#8b949e' }}>
          <PauseOutlined style={{ fontSize: 24, marginBottom: 8, display: 'block' }} />
          開啟模擬開關後，模擬用戶將在每次市場信號更新時自動交易
        </div>
      )}

      {enabled && (
        <>
          <SimulatedUserRanking
            ranking={ranking}
            activeUser={activeUser}
            onSelect={handleSelectUser}
            onSettings={setSettingUser}
            onReset={handleResetUser}
          />
          {selectedState && <SimulatedUserDetail state={selectedState} />}
        </>
      )}

      <SimulatedUserConfig
        settingUser={settingUser}
        symbols={symbols}
        onClose={() => setSettingUser(null)}
        onSaved={refresh}
      />
    </Card>
  );
};
