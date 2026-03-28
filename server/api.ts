import express from 'express';
import cors from 'cors';
import { config, corsOrigins } from './core/config.js';
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
app.listen(PORT, () => {
  console.log(`✅ API 服務啟動：http://localhost:${PORT}`);
  console.log(`   環境: ${config.NODE_ENV}`);

  // PM2 cluster ready signal（wait_ready: true 配合使用，零停機部署）
  if (process.send) {
    process.send('ready');
  }
});

// graceful shutdown — 停止接新請求，等 DB/Redis 各自的 SIGTERM handler 清理
process.once('SIGINT', () => {
  console.log('[API] 收到 SIGINT，正在優雅關閉...');
  process.exit(0);
});

export default app;
