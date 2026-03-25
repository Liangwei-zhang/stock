import React, { useState } from 'react';
import { Button, Dropdown, message, Tooltip } from 'antd';
import { DownloadOutlined, LoadingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { generateAndExport } from '../export/report-service';

interface Props {
  symbol: string;
  disabled?: boolean;
}

export const ExportButton: React.FC<Props> = ({ symbol, disabled }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const doExport = async (format: 'csv' | 'json' | 'html') => {
    if (!symbol) return;
    setLoading(true);
    try {
      await generateAndExport(symbol, format);
      message.success(t('exportBtn.success', { symbol, format: format.toUpperCase() }));
    } catch (err: any) {
      message.error(t('exportBtn.failed', { msg: err?.message ?? err }));
    } finally {
      setLoading(false);
    }
  };

  const items = [
    { key: 'html', label: t('exportBtn.html') },
    { key: 'csv',  label: t('exportBtn.csv') },
    { key: 'json', label: t('exportBtn.json') },
  ];

  return (
    <Tooltip title={t('exportBtn.tooltip', { symbol })} placement="bottomRight">
      <span>
        <Dropdown
          disabled={disabled || loading || !symbol}
          menu={{
            items,
            onClick: ({ key }) => doExport(key as 'csv' | 'json' | 'html'),
          }}
          trigger={['click']}
        >
          <Button
            size="small"
            icon={loading ? <LoadingOutlined/> : <DownloadOutlined/>}
            style={{ fontSize: 11 }}
          >
            {t('exportBtn.button')}
          </Button>
        </Dropdown>
      </span>
    </Tooltip>
  );
};
