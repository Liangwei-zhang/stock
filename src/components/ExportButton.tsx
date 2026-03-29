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
      message.success(`已匯出 ${symbol} 報告（${format.toUpperCase()}）`);
    } catch (err: any) {
      message.error(`匯出失敗：${err?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  };

  const items = [
    { key: 'html', label: 'HTML 報告（可列印或另存 PDF）' },
    { key: 'csv',  label: 'CSV 歷史價格資料' },
    { key: 'json', label: 'JSON 完整分析資料' },
  ];

  return (
    <Tooltip title={`匯出 ${symbol} 分析報告`} placement="bottomRight">
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
            匯出報告
          </Button>
        </Dropdown>
      </span>
    </Tooltip>
  );
};
