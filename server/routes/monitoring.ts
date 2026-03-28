/**
 * server/routes/monitoring.ts — Layer 6 監控 API
 *
 * 對應 SmartClean: app/api/monitoring.py
 * 受 Bearer Token 保護（設置 INTERNAL_TOKEN 環境變量啟用）
 *
 * GET /api/monitoring/stats   — JSON 統計（請求數、錯誤率、p95 延遲）
 * GET /api/monitoring/metrics — Prometheus 文本格式
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { metrics } from '../core/monitoring.js';
import { config } from '../core/config.js';

const router = Router();

/** 內部 Bearer Token 驗證（若未設置 INTERNAL_TOKEN，開發環境無需認證） */
function requireBearer(req: Request, res: Response, next: NextFunction): void {
  if (!config.INTERNAL_TOKEN) {
    // 未配置 token → 僅開發環境放行
    if (config.NODE_ENV === 'production') {
      res.status(401).json({ error: 'INTERNAL_TOKEN 未配置，監控端點已關閉' });
      return;
    }
    return next();
  }
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${config.INTERNAL_TOKEN}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

/** JSON 統計（對應 SmartClean GET /api/monitoring/stats） */
router.get('/stats', requireBearer, (_req, res) => {
  const stats = metrics.getStats();
  const allEndpoints = Object.values(stats.endpoints as Record<string, any>);
  res.json({
    requests:       allEndpoints.reduce((s, d) => s + d.requests, 0),
    errors:         allEndpoints.reduce((s, d) => s + d.errors,   0),
    uptime_seconds: stats.uptime_seconds,
    endpoints:      stats.endpoints,
    timestamp:      stats.timestamp,
  });
});

/** Prometheus 文本格式（對應 SmartClean GET /api/monitoring/metrics） */
router.get('/metrics', requireBearer, (_req, res) => {
  res.type('text/plain').send(metrics.prometheusFormat('stock_signal'));
});

/** 重置指標（僅開發/測試環境使用） */
router.post('/reset', requireBearer, (_req, res) => {
  if (config.NODE_ENV === 'production') {
    res.status(403).json({ error: '生產環境禁止重置指標' });
    return;
  }
  metrics.reset();
  res.json({ ok: true, message: '指標已重置' });
});

export default router;
