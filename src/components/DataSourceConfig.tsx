import React, { useState } from 'react';
import { Modal, Button, Switch, Tag, Tooltip, Space, Typography, Divider } from 'antd';
import { DatabaseOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { dataSourceRegistry } from '../core/data-source-registry';

const { Text, Title } = Typography;

interface Props {
  onUpdate?: () => void;
}

export const DataSourceConfig: React.FC<Props> = ({ onUpdate }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const adapters = dataSourceRegistry.listAdapters();
  const cfg      = dataSourceRegistry.getConfig();

  const assetTypeColors: Record<string, string> = {
    crypto:  'gold',
    equity:  'blue',
    etf:     'cyan',
    futures: 'orange',
    index:   'purple',
    other:   'default',
  };

  return (
    <>
      <Tooltip title={t('dataSource.configTitle')}>
        <Button size="small" icon={<DatabaseOutlined/>} onClick={() => setOpen(true)} style={{ fontSize: 11 }}>
          {t('dataSource.config')}
        </Button>
      </Tooltip>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={<Button type="primary" onClick={() => setOpen(false)}>{t('common.close')}</Button>}
        title={
          <Space>
            <DatabaseOutlined/>
            <span>{t('dataSource.configTitle')}</span>
          </Space>
        }
        width={500}
      >
        <Title level={5} style={{ marginBottom: 12 }}>{t('dataSource.registeredAdapters')}</Title>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {adapters.map(a => (
            <div
              key={a.id}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${a.disabled ? '#21262d' : '#30363d'}`,
                background: a.disabled ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
                opacity: a.disabled ? 0.5 : 1,
                transition: 'all .15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <Text strong style={{ fontSize: 13 }}>{a.name}</Text>
                  <Tag style={{ marginLeft: 8, fontSize: 10 }}>{t('dataSource.priority', { val: a.priority })}</Tag>
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

        <Title level={5} style={{ marginBottom: 8 }}>{t('dataSource.fallbackChain')}</Title>
        <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.7 }}>
          <div>🔐 <strong style={{ color: '#e6edf3' }}>{t('dataSource.cryptoChain')}</strong>：Binance → Yahoo</div>
          <div>📈 <strong style={{ color: '#e6edf3' }}>{t('dataSource.equityChain')}</strong>：Polygon → Yahoo</div>
          <div>🌍 <strong style={{ color: '#e6edf3' }}>{t('dataSource.otherChain')}</strong>：Yahoo（直连或本地代理）</div>
          <div style={{ marginTop: 8, color: '#484f58' }}>
            {t('dataSource.fallbackDesc')}
          </div>
        </div>
      </Modal>
    </>
  );
};
