import React, { useState } from 'react';
import { Modal, Button, Switch, Tag, Tooltip, Space, Typography, Divider } from 'antd';
import { DatabaseOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { dataSourceRegistry } from '../core/data-source-registry';
import { getDesktopAssetTypeLabel } from '../utils/desktopLabels';

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
      <Tooltip title="資料來源設定">
        <Button size="small" icon={<DatabaseOutlined/>} onClick={() => setOpen(true)} style={{ fontSize: 11 }}>
          資料來源
        </Button>
      </Tooltip>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={<Button type="primary" onClick={() => setOpen(false)}>關閉</Button>}
        title={
          <Space>
            <DatabaseOutlined/>
            <span>資料來源設定</span>
          </Space>
        }
        width={500}
      >
        <Title level={5} style={{ marginBottom: 12 }}>已註冊的適配器</Title>
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
                  <Tag style={{ marginLeft: 8, fontSize: 10 }}>優先級 {a.priority}</Tag>
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
                  <Tag key={t} color={assetTypeColors[t] ?? 'default'} style={{ fontSize: 10, margin: 0 }}>{getDesktopAssetTypeLabel(t)}</Tag>
                ))}
              </div>
            </div>
          ))}
        </div>

        <Divider style={{ margin: '16px 0' }}/>

        <Title level={5} style={{ marginBottom: 8 }}>自動降級鏈路</Title>
        <div style={{ fontSize: 12, color: '#5f7a6a', lineHeight: 1.7 }}>
          <div>🔐 <strong style={{ color: '#183024' }}>加密貨幣</strong>：Binance → Yahoo</div>
          <div>📈 <strong style={{ color: '#183024' }}>美股 / ETF / 指數</strong>：Polygon → Yahoo</div>
          <div>🌍 <strong style={{ color: '#183024' }}>其他資產</strong>：Yahoo（直接或本地代理）</div>
          <div style={{ marginTop: 8, color: '#7b9586' }}>
            所有請求都會先讀取本地快取（60 秒 TTL），過期後才抓取最新資料。
            當 server.ts 正在執行時，歷史 K 線也會同步寫入 IndexedDB 與伺服器端 SQLite。
          </div>
        </div>
      </Modal>
    </>
  );
};
