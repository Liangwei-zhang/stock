// ecosystem.config.js — PM2 配置
export default {
  apps: [
    {
      name: 'stock-api',
      script: './server/api.ts',
      interpreter: 'tsx',
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '500M',
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
