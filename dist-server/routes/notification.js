import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { query, queryOne } from '../db/pool.js';
const router = Router();
router.use(authMiddleware);
/** GET /api/notifications?page=1&limit=20 */
router.get('/', asyncHandler(async (req, res) => {
    const userId = req.userId;
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const offset = (page - 1) * limit;
    const [rows, countRow] = await Promise.all([
        query(`SELECT id, type, title, body, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`, [userId, limit, offset]),
        queryOne(`SELECT COUNT(*) as count FROM notifications WHERE user_id = $1`, [userId]),
    ]);
    res.json({
        items: rows,
        total: parseInt(countRow?.count ?? '0', 10),
        page,
        limit,
    });
}));
/** PUT /api/notifications/read-all — 全部標記已讀（靜態路由必須在動態路由前面）*/
router.put('/read-all', asyncHandler(async (req, res) => {
    const userId = req.userId;
    await query(`UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`, [userId]);
    res.json({ message: 'All notifications marked as read' });
}));
/** PUT /api/notifications/:id/read */
router.put('/:id/read', asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    await query(`UPDATE notifications SET is_read = true
     WHERE id = $1 AND user_id = $2`, [id, userId]);
    res.json({ message: 'Notification marked as read' });
}));
export default router;
//# sourceMappingURL=notification.js.map