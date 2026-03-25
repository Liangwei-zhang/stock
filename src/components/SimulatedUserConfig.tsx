import React from 'react';
import {
  Modal, Form, Divider, InputNumber, Select, Slider, Switch,
} from 'antd';
import { simulatedUserService, SimUserState } from '../services/simulatedUsers';

interface SimulatedUserConfigProps {
  settingUser: SimUserState | null;
  symbols:     string[];
  onClose:     () => void;
  onSaved:     () => void;
}

export const SimulatedUserConfig: React.FC<SimulatedUserConfigProps> = React.memo(({
  settingUser, symbols, onClose, onSaved,
}) => {
  const [form] = Form.useForm();
  if (!settingUser) return null;
  const s = settingUser.user.strategy;

  return (
    <Modal
      title={`${settingUser.user.emoji} ${settingUser.user.name} — 設置`}
      open={!!settingUser}
      onCancel={onClose}
      width={560}
      onOk={() => {
        const vals = form.getFieldsValue();
        simulatedUserService.updateStrategy(settingUser.user.id, {
          minBuyScore:      vals.minBuyScore,
          minSellScore:     vals.minSellScore,
          minPredProb:      vals.minPredProb / 100,
          positionPct:      vals.positionPct / 100,
          stopMultiplier:   vals.stopMultiplier,
          profitMultiplier: vals.profitMultiplier,
          requireTriple:    vals.requireTriple,
          onlyWithTrend:    vals.onlyWithTrend,
          pauseOnDrawdown:  vals.pauseOnDrawdown / 100,
        });
        simulatedUserService.setUserSymbols(settingUser.user.id, vals.allowedSymbols ?? []);
        const newBal = vals.initBalance;
        if (newBal && newBal !== settingUser.initBalance) {
          Modal.confirm({
            title: '重置账户确认',
            content: `将把 ${settingUser.user.name} 的初始资金改为 $${newBal.toLocaleString()}，账户将被重置（持仓和交易记录清空）。确认吗？`,
            onOk: () => {
              simulatedUserService.setUserInitBalance(settingUser.user.id, newBal);
              onSaved();
            },
          });
        }
        onClose();
        onSaved();
      }}
      okText="保存"
      cancelText="取消"
    >
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ span: 10 }}
        initialValues={{
          minBuyScore:      s.minBuyScore === 999  ? 75 : s.minBuyScore,
          minSellScore:     s.minSellScore === 999 ? 75 : s.minSellScore,
          minPredProb:      Math.round(s.minPredProb * 100),
          positionPct:      Math.round(s.positionPct * 100),
          stopMultiplier:   s.stopMultiplier,
          profitMultiplier: s.profitMultiplier,
          requireTriple:    s.requireTriple,
          onlyWithTrend:    s.onlyWithTrend,
          pauseOnDrawdown:  Math.round(s.pauseOnDrawdown * 100),
          initBalance:      settingUser.initBalance,
          allowedSymbols:   settingUser.allowedSymbols,
        }}
      >
        <Divider orientation="left" plain style={{ fontSize: 12 }}>賬戶設置</Divider>
        <Form.Item label="初始資金" name="initBalance" help="修改後點確定會提示重置賬戶">
          <InputNumber
            style={{ width: '100%' }}
            min={1000}
            step={10000}
            formatter={v => `$ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(v) => Number(v?.replace(/\$\s?|(,*)/g, '') || 0) as any}
          />
        </Form.Item>
        <Form.Item label="自動交易標的" name="allowedSymbols" help="留空 = 所有自選股">
          <Select
            mode="multiple"
            placeholder="留空 = 交易所有自選股標的"
            style={{ width: '100%' }}
            allowClear
            options={symbols.map(sym => ({ label: sym, value: sym }))}
          />
        </Form.Item>
        <Divider orientation="left" plain style={{ fontSize: 12 }}>入場閾值</Divider>
        <Form.Item label="買入最低分" name="minBuyScore">
          <Slider min={30} max={100} marks={{ 55: '55', 75: '75' }} />
        </Form.Item>
        <Form.Item label="賣出最低分" name="minSellScore">
          <Slider min={30} max={100} marks={{ 55: '55', 75: '75' }} />
        </Form.Item>
        <Form.Item label="預測最低概率%" name="minPredProb">
          <Slider min={50} max={95} marks={{ 65: '65%', 80: '80%' }} />
        </Form.Item>
        <Divider orientation="left" plain style={{ fontSize: 12 }}>倉位 & 止損</Divider>
        <Form.Item label="每筆倉位%" name="positionPct">
          <Slider min={5} max={40} marks={{ 10: '10%', 20: '20%' }} />
        </Form.Item>
        <Form.Item label="止損 ATR 倍數" name="stopMultiplier">
          <Slider min={0.5} max={5} step={0.5} marks={{ 1: '1x', 2: '2x', 3: '3x' }} />
        </Form.Item>
        <Form.Item label="止盈 ATR 倍數" name="profitMultiplier">
          <Slider min={1} max={8} step={0.5} marks={{ 2: '2x', 4: '4x' }} />
        </Form.Item>
        <Divider orientation="left" plain style={{ fontSize: 12 }}>過濾條件</Divider>
        <Form.Item label="三重確認" name="requireTriple" valuePropName="checked">
          <Switch size="small" />
        </Form.Item>
        <Form.Item label="順趨勢交易" name="onlyWithTrend" valuePropName="checked">
          <Switch size="small" />
        </Form.Item>
        <Form.Item label="最大回撤暫停%" name="pauseOnDrawdown">
          <Slider min={5} max={50} marks={{ 10: '10%', 25: '25%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
});

SimulatedUserConfig.displayName = 'SimulatedUserConfig';
