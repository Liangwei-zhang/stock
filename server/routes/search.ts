import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validate.js';
import { query } from '../db/pool.js';
import { cacheWithLock, cacheKey } from '../core/cache.js';

const router = Router();
router.use(optionalAuth);

const searchQuerySchema = z.object({
  q:    z.string().min(1).max(50),
  type: z.enum(['equity', 'crypto', 'etf', '']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * GET /api/search?q=AAPL
 * 使用 pg_trgm 模糊搜索標的
 */
router.get(
  '/',
  validate(searchQuerySchema, 'query'),
  async (req, res) => {
    const { q, type, limit } = req.query as z.infer<typeof searchQuerySchema>;

    const key = cacheKey('search', { q: q.toUpperCase(), type, limit });

    const results = await cacheWithLock(key, async () => {
      const params: unknown[] = [`%${q}%`, `${q}%`, limit];
      const typeFilter = type ? `AND asset_type = $${params.length + 1}` : '';
      if (type) params.push(type);

      return query(
        `SELECT symbol, name, name_zh, asset_type, exchange, sector
         FROM symbols
         WHERE is_active = true
           AND (symbol ILIKE $2 OR name ILIKE $1 OR name_zh ILIKE $1)
           ${typeFilter}
         ORDER BY
           CASE WHEN symbol ILIKE $2 THEN 0
                WHEN symbol ILIKE $1 THEN 1
                ELSE 2 END,
           symbol
         LIMIT $3`,
        params
      );
    }, 60); // 緩存 60 秒

    res.json({ items: results, query: q });
  }
);

export default router;
