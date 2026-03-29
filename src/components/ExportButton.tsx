import React, { useState } from 'react';
import { Button, Dropdown, message, Tooltip } from 'antd';
import { DownloadOutlined, LoadingOutlined } from '@ant-design/icons';
import { generateAndExport } from '../export/report-service';

interface Props {
  symbol: string;
  disabled?: boolean;
}

export const ExportButton: React.FC<Props> = ({ symbol, disabled }) => {
  const [loading, setLoading] = useState(false);

  const doExport = async (format: 'csv' | 'json' | 'html') => {
    if (!symbol) return;
    setLoading(true);
    try {
      await generateAndExport(symbol, format);
      message.success(`${symbol} report exported (${format.toUpperCase()})`);
    } catch (err: any) {
      message.error(`Export failed: ${err?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  };

  const items = [
    { key: 'html', label: 'HTML report (print or save as PDF)' },
    { key: 'csv',  label: 'CSV historical price data' },
    { key: 'json', label: 'JSON full analysis payload' },
  ];

  return (
    <Tooltip title={`Export ${symbol} analysis report`} placement="bottomRight">
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
            Export Report
          </Button>
        </Dropdown>
      </span>
    </Tooltip>
  );
};
