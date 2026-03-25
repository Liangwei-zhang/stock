import React, { useState, useEffect } from 'react';
import { Modal, Select, Button, Slider, Switch, Tooltip, Tag, Divider, Space, Typography } from 'antd';
import { ExperimentOutlined, SettingOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { pluginRegistry } from '../core/plugin-registry';
import type { PluginRegistrySnapshot, PluginConfigSchema } from '../core/types';

const { Text, Title } = Typography;

interface Props {
  currentSymbol?: string;
  onSwitch?:      () => void;   // 切换后通知父组件刷新
}

export const PluginSelector: React.FC<Props> = ({ currentSymbol, onSwitch }) => {
  const [open,     setOpen]     = useState(false);
  const [snap,     setSnap]     = useState<PluginRegistrySnapshot>(pluginRegistry.snapshot());
  const [cfgDraft, setCfgDraft] = useState<Record<string, unknown>>({});
  const [loading,  setLoading]  = useState(false);

  // 打开时同步快照 & 当前配置
  const handleOpen = () => {
    const s = pluginRegistry.snapshot();
    setSnap(s);
    const plugin = pluginRegistry.getPlugin(s.active);
    setCfgDraft(plugin?.getConfig?.() ?? {});
    setOpen(true);
  };

  const handleActivate = async (id: string) => {
    if (id === snap.active) return;
    setLoading(true);
    try {
      await pluginRegistry.setActive(id, currentSymbol);
      setSnap(pluginRegistry.snapshot());
      const plugin = pluginRegistry.getPlugin(id);
      setCfgDraft(plugin?.getConfig?.() ?? {});
      onSwitch?.();
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = () => {
    pluginRegistry.savePluginConfig(snap.active, cfgDraft);
    onSwitch?.();
    setOpen(false);
  };

  const activePlugin = pluginRegistry.getPlugin(snap.active);
  const schema: PluginConfigSchema[] = activePlugin?.configSchema ?? [];

  return (
    <>
      <Tooltip title={`算法插件：${snap.plugins.find(p => p.id === snap.active)?.name ?? '未知'}`}>
        <Button
          size="small"
          icon={<ExperimentOutlined/>}
          onClick={handleOpen}
          style={{ fontSize: 11 }}
        >
          {snap.plugins.find(p => p.id === snap.active)?.name ?? '算法'}
        </Button>
      </Tooltip>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        onOk={handleSaveConfig}
        okText="应用"
        cancelText="取消"
        title={
          <Space>
            <ExperimentOutlined/>
            <span>算法插件管理</span>
          </Space>
        }
        width={520}
      >
        {/* 插件列表 */}
        <Title level={5} style={{ marginBottom: 12 }}>可用插件</Title>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {snap.plugins.map(p => (
            <div
              key={p.id}
              onClick={() => handleActivate(p.id)}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${snap.active === p.id ? '#1890ff' : '#21262d'}`,
                background: snap.active === p.id ? 'rgba(24,144,255,0.08)' : 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'all .15s',
              }}
            >
              <div>
                <Text strong style={{ color: snap.active === p.id ? '#1890ff' : '#e6edf3' }}>
                  {p.name}
                </Text>
                <Tag style={{ marginLeft: 8, fontSize: 10 }}>{p.version}</Tag>
                <div style={{ fontSize: 12, color: '#8b949e', marginTop: 2 }}>{p.description}</div>
              </div>
              {snap.active === p.id && (
                <CheckCircleOutlined style={{ color: '#1890ff', fontSize: 16, marginLeft: 8 }} />
              )}
            </div>
          ))}
        </div>

        {/* 当前插件参数配置 */}
        {schema.length > 0 && (
          <>
            <Divider style={{ margin: '0 0 16px' }}/>
            <Title level={5} style={{ marginBottom: 12 }}>
              <SettingOutlined style={{ marginRight: 6 }}/>
              参数调整（{activePlugin?.name}）
            </Title>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
              {schema.map(s => (
                <div key={s.key} style={{ marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, color: '#8b949e', display: 'block', marginBottom: 4 }}>
                    {s.label}
                  </Text>
                  {s.type === 'boolean' ? (
                    <Switch
                      size="small"
                      checked={Boolean(cfgDraft[s.key] ?? s.default)}
                      onChange={v => setCfgDraft(d => ({ ...d, [s.key]: v }))}
                    />
                  ) : s.type === 'select' ? (
                    <Select
                      size="small"
                      style={{ width: '100%' }}
                      value={cfgDraft[s.key] ?? s.default}
                      options={s.options}
                      onChange={v => setCfgDraft(d => ({ ...d, [s.key]: v }))}
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Slider
                        style={{ flex: 1 }}
                        min={s.min} max={s.max} step={s.step ?? 1}
                        value={Number(cfgDraft[s.key] ?? s.default)}
                        onChange={v => setCfgDraft(d => ({ ...d, [s.key]: v }))}
                      />
                      <Text style={{ fontSize: 12, minWidth: 32, textAlign: 'right' }}>
                        {Number(cfgDraft[s.key] ?? s.default).toFixed(
                          (s.step ?? 1) < 1 ? 2 : 0
                        )}
                      </Text>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>
    </>
  );
};
