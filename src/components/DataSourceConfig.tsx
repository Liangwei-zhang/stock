import React, { useState } from 'react';
import { Modal, Button, Switch, Tag, Tooltip, Space, Typography, Divider } from 'antd';
import { DatabaseOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { dataSourceRegistry } from '../core/data-source-registry';

const { Text, Title } = Typography;

interface Props {
  onUpdate?: () => void;
}

export const DataSourceConfig: React.FC<Props> = ({ onUpdate }) => {
  const [open, setOpen] = useState(false);

  const adapters = dataSourceRegistry.listAdapters();
  const cfg      = dataSourceRegistry.getConfig();

  const assetTypeColors: Record<string, string> = {
    crypto:  'gold',
    equity:  'green',
    etf:     'cyan',
    futures: 'orange',
    index:   'purple',
    other:   'default',
  };

  return (
    <>
      <Tooltip title="Data Source Settings">
        <Button size="small" icon={<DatabaseOutlined/>} onClick={() => setOpen(true)} style={{ fontSize: 11 }}>
          Data Sources
        </Button>
      </Tooltip>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={<Button type="primary" onClick={() => setOpen(false)}>Close</Button>}
        title={
          <Space>
            <DatabaseOutlined/>
            <span>Data Source Settings</span>
          </Space>
        }
        width={500}
      >
        <Title level={5} style={{ marginBottom: 12 }}>Registered Adapters</Title>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {adapters.map(a => (
            <div
              key={a.id}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${a.disabled ? 'rgba(93, 187, 123, 0.14)' : 'rgba(93, 187, 123, 0.22)'}`,
                background: a.disabled ? '#f7fbf8' : '#ffffff',
                opacity: a.disabled ? 0.5 : 1,
                transition: 'all .15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <Text strong style={{ fontSize: 13 }}>{a.name}</Text>
                  <Tag style={{ marginLeft: 8, fontSize: 10 }}>Priority {a.priority}</Tag>
                </div>
                <Switch
                  size="small"
                  checked={!a.disabled}
                  onChange={v => {
                    dataSourceRegistry.setDisabled(a.id, !v);
                    onUpdate?.();
                  }}
                />
              </div>
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {a.assetTypes.map(t => (
                  <Tag key={t} color={assetTypeColors[t] ?? 'default'} style={{ fontSize: 10, margin: 0 }}>{t}</Tag>
                ))}
              </div>
            </div>
          ))}
        </div>

        <Divider style={{ margin: '16px 0' }}/>

        <Title level={5} style={{ marginBottom: 8 }}>Automatic Fallback Chain</Title>
        <div style={{ fontSize: 12, color: '#5f7a6a', lineHeight: 1.7 }}>
          <div>🔐 <strong style={{ color: '#183024' }}>Crypto</strong>: Binance → Yahoo</div>
          <div>📈 <strong style={{ color: '#183024' }}>US Equities / ETF / Index</strong>: Polygon → Yahoo</div>
          <div>🌍 <strong style={{ color: '#183024' }}>Other</strong>: Yahoo (direct or local proxy)</div>
          <div style={{ marginTop: 8, color: '#7b9586' }}>
            All requests read from local cache first (60s TTL) and only fetch fresh data after expiry.
            Historical bars are written to IndexedDB and server-side SQLite when server.ts is running.
          </div>
        </div>
      </Modal>
    </>
  );
};
