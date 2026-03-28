import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, corsOrigins } from './core/config.js';
import { pool } from './db/pool.js';
import { redis } from './core/cache.js';
import { blacklistMiddleware } from './middleware/rateLimiter.js';
import { requestLogger } from './core/monitoring.js';
import healthRouter       from './routes/health.js';
import monitoringRouter   from './routes/monitoring.js';
import authRouter         from './routes/auth.js';
import accountRouter      from './routes/account.js';
import watchlistRouter    from './routes/watchlist.js';
import portfolioRouter    from './routes/portfolio.js';
import searchRouter       from './routes/search.js';
import tradeRouter        from './routes/trade.js';
import notificationRouter from './routes/notification.js';

const app = express();

// ── 信任代理（Nginx） ──
app.set('trust proxy', 1);
// ── 安全頭（SEC-01）──
app.use(helmet({
  contentSecurityPolicy: false, // 由 Nginx 處理 CSP
  hsts: { maxAge: 31_536_000, includeSubDomains: true },
}));
// ── CORS ──
app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

// ── 請求體解析 ──
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── 黑名單 ──
app.use(blacklistMiddleware);

// ── 請求日誌 + Metrics（Layer 6）──
app.use(requestLogger);

// ── 路由 ──
app.use('/health',             healthRouter);
app.use('/api/monitoring',     monitoringRouter);
app.use('/api/auth',           authRouter);
app.use('/api/account',        accountRouter);
app.use('/api/watchlist',      watchlistRouter);
app.use('/api/portfolio',      portfolioRouter);
app.use('/api/search',         searchRouter);
app.use('/api/trade',          tradeRouter);
app.use('/api/notifications',  notificationRouter);

// ── 404 兜底 ──
app.use((_req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// ── 全局錯誤處理 ──
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[API 錯誤]', err.message);
  res.status(500).json({ error: '服務器內部錯誤' });
});

const PORT = config.PORT;

// CRIT-06: 顯式連接 Redis，啟動時立即暴露配置錯誤（lazyConnect: true 預設不自動連接）
redis.connect().catch(err => {
  console.error('[Redis] 啟動連接失敗：', err.message);
});

const server = app.listen(PORT, () => {
  console.log(`✅ API 服務啟動：http://localhost:${PORT}`);
  console.log(`   環境: ${config.NODE_ENV}`);

  // PM2 cluster ready signal（wait_ready: true 配合使用，零停機部署）
  if (process.send) {
    process.send('ready');
  }
});

// ── 統一 graceful shutdown（REL-01：集中編排，避免競爭 process.exit）──
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[API] 收到 ${signal}，開始優雅關閉...`);

  // 1. 停止接收新連接
  server.close();

  // 2. 等待正在處理的請求完成（最多 2 秒）
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 3. 並行關閉 DB + Redis
  await Promise.allSettled([
    pool.end().then(() => console.log('[DB] 連接池已關閉')),
    redis.quit().then(() => console.log('[Redis] 已斷開')),
  ]);

  console.log('[API] 優雅關閉完成');
  process.exit(0);
}

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT',  () => gracefulShutdown('SIGINT'));

export default app;
