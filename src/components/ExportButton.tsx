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
      message.success(`${symbol} 报表已导出（${format.toUpperCase()}）`);
    } catch (err: any) {
      message.error(`导出失败：${err?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  };

  const items = [
    { key: 'html', label: '📊 HTML 报表（可打印/存 PDF）' },
    { key: 'csv',  label: '📋 CSV 历史 K 线数据' },
    { key: 'json', label: '🔧 JSON 完整分析数据' },
  ];

  return (
    <Tooltip title={`导出 ${symbol} 分析报表`} placement="bottomRight">
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
            导出报表
          </Button>
        </Dropdown>
      </span>
    </Tooltip>
  );
};
