// ecosystem.config.js — PM2 配置
export default {
  apps: [
    {
      name: 'stock-api',
      script: './server/api.ts',
      interpreter: 'tsx',
      instances: 4,                    // PM2 cluster 4 進程 → ~3200 QPS
      exec_mode: 'cluster',
      max_memory_restart: '500M',
      kill_timeout: 10_000,            // graceful shutdown 等待 10 秒
      listen_timeout: 5_000,
      wait_ready: true,                // 等待 process.send('ready') 再切流量
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/api-error.log',
      out_file:   './logs/api-out.log',
    },
    {
      name: 'stock-scanner',
      script: './server/scanner/index.ts',
      interpreter: 'tsx',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      cron_restart: '0 4 * * *', // 每天凌晨 4 點重啟
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/scanner-error.log',
      out_file:   './logs/scanner-out.log',
    },
    {
      name: 'stock-email-worker',
      script: './server/email-worker.ts',
      interpreter: 'tsx',
      instances: 2,
      exec_mode: 'fork',
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/email-error.log',
      out_file:   './logs/email-out.log',
    },
  ],
};
