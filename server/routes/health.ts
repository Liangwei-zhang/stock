import { Router } from 'express';
import { checkDbHealth } from '../db/pool.js';
import { checkRedisHealth } from '../core/cache.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(async (_req, res) => {
  const [db, redisOk] = await Promise.all([checkDbHealth(), checkRedisHealth()]);

  const status = db && redisOk ? 'ok' : 'degraded';
  res.status(status === 'ok' ? 200 : 503).json({
    status,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    services: { db, redis: redisOk },
  });
}));

export default router;
