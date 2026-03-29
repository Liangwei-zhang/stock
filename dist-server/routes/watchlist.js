import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { query, queryOne } from '../db/pool.js';
import { delCache } from '../core/cache.js';
const router = Router();
router.use(authMiddleware);
// 查詢 user plan 的最大關注數
async function getMaxWatchlist(userId) {
    const row = await queryOne(`SELECT plan FROM users WHERE id = $1`, [userId]);
    if (!row)
        return 10;
    const limits = { free: 10, pro: 50, premium: 200 };
    return limits[row.plan] ?? 10;
}
const addSchema = z.object({
    symbol: z.string().min(1).max(20).transform(s => s.toUpperCase()),
    min_score: z.number().int().min(0).max(100).default(65),
    notify: z.boolean().default(true),
});
const updateSchema = z.object({
    min_score: z.number().int().min(0).max(100).optional(),
    notify: z.boolean().optional(),
});
/** GET /api/watchlist */
router.get('/', asyncHandler(async (req, res) => {
    const userId = req.userId;
    const rows = await query(`SELECT w.id, w.symbol, w.notify, w.min_score, w.created_at,
            s.name, s.name_zh, s.asset_type, s.sector
     FROM user_watchlist w
     LEFT JOIN symbols s ON s.symbol = w.symbol
     WHERE w.user_id = $1
     ORDER BY w.created_at DESC`, [userId]);
    res.json(rows);
}));
/** POST /api/watchlist */
router.post('/', validate(addSchema), asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { symbol, min_score, notify } = req.body;
    // 檢查數量上限
    const [countRow, max] = await Promise.all([
        queryOne(`SELECT COUNT(*) as count FROM user_watchlist WHERE user_id = $1`, [userId]),
        getMaxWatchlist(userId),
    ]);
    if (Number(countRow?.count ?? 0) >= max) {
        return res.status(400).json({
            error: `Watchlist limit reached (${max} symbols)`,
        });
    }
    // 確保 symbol 存在（若不存在則自動創建佔位）
    await query(`INSERT INTO symbols (symbol, name) VALUES ($1, $1)
     ON CONFLICT (symbol) DO NOTHING`, [symbol]);
    const row = await queryOne(`INSERT INTO user_watchlist (user_id, symbol, notify, min_score)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, symbol) DO UPDATE SET
       notify = EXCLUDED.notify,
       min_score = EXCLUDED.min_score
     RETURNING *`, [userId, symbol, notify, min_score]);
    // 清除 active_symbols 緩存
    await delCache('active_symbols');
    res.status(201).json(row);
}));
/** PUT /api/watchlist/:id */
router.put('/:id', validate(updateSchema), asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const body = req.body;
    const updates = [];
    const params = [id, userId];
    if (body.min_score !== undefined) {
        params.push(body.min_score);
        updates.push(`min_score = $${params.length}`);
    }
    if (body.notify !== undefined) {
        params.push(body.notify);
        updates.push(`notify = $${params.length}`);
    }
    if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
    }
    const row = await queryOne(`UPDATE user_watchlist SET ${updates.join(', ')}
     WHERE id = $1 AND user_id = $2 RETURNING *`, params);
    if (!row)
        return res.status(404).json({ error: 'Watchlist item not found' });
    await delCache('active_symbols');
    res.json(row);
}));
/** DELETE /api/watchlist/:id */
router.delete('/:id', asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const row = await queryOne(`DELETE FROM user_watchlist WHERE id = $1 AND user_id = $2 RETURNING symbol`, [id, userId]);
    if (!row)
        return res.status(404).json({ error: 'Watchlist item not found' });
    await delCache('active_symbols');
    res.json({ message: 'Deleted successfully' });
}));
export default router;
//# sourceMappingURL=watchlist.js.map