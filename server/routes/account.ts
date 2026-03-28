import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { query, queryOne } from '../db/pool.js';

const router = Router();
router.use(authMiddleware);

const updateAccountSchema = z.object({
  total_capital: z.number().positive('總資金必須大於 0').optional(),
  currency:      z.enum(['USD', 'TWD', 'CNY', 'HKD']).optional(),
  name:          z.string().max(50).optional(),
  locale:        z.string().optional(),
  timezone:      z.string().optional(),
});

/**
 * GET /api/account
 * 返回帳戶資訊 + 動態計算可用現金
 */
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.userId!;

  const [userRow, accountRow, portfolioRows] = await Promise.all([
    queryOne<{ name: string | null; email: string; plan: string; locale: string; timezone: string }>(
      `SELECT name, email, plan, locale, timezone FROM users WHERE id = $1`,
      [userId]
    ),
    queryOne<{ total_capital: string; currency: string }>(
      `SELECT total_capital, currency FROM user_account WHERE user_id = $1`,
      [userId]
    ),
    query<{ symbol: string; shares: string; avg_cost: string; total_capital: string }>(
      `SELECT symbol, shares, avg_cost, total_capital FROM user_portfolio WHERE user_id = $1`,
      [userId]
    ),
  ]);

  if (!userRow || !accountRow) {
    return res.status(404).json({ error: '用戶不存在' });
  }

  const totalCapital = parseFloat(accountRow.total_capital);
  const portfolioValue = portfolioRows.reduce(
    (sum, p) => sum + parseFloat(p.total_capital), 0
  );
  const availableCash = totalCapital - portfolioValue;

  res.json({
    user: userRow,
    account: {
      totalCapital,
      currency: accountRow.currency,
      portfolioValue: parseFloat(portfolioValue.toFixed(2)),
      availableCash: parseFloat(availableCash.toFixed(2)),
      portfolioPct: totalCapital > 0
        ? parseFloat((portfolioValue / totalCapital * 100).toFixed(1))
        : 0,
    },
    portfolio: portfolioRows.map(p => ({
      symbol: p.symbol,
      shares: parseFloat(p.shares),
      avgCost: parseFloat(p.avg_cost),
      totalCapital: parseFloat(p.total_capital),
      pct: totalCapital > 0
        ? parseFloat((parseFloat(p.total_capital) / totalCapital * 100).toFixed(1))
        : 0,
    })),
  });
}));

/**
 * PUT /api/account
 * 更新總資金 / 語言 / 時區 / 名稱
 */
router.put(
  '/',
  validate(updateAccountSchema),
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const body = req.body as z.infer<typeof updateAccountSchema>;

    if (body.total_capital !== undefined || body.currency !== undefined) {
      await query(
        `INSERT INTO user_account (user_id, total_capital, currency, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE SET
           total_capital = COALESCE(EXCLUDED.total_capital, user_account.total_capital),
           currency      = COALESCE(EXCLUDED.currency, user_account.currency),
           updated_at    = now()`,
        [userId, body.total_capital ?? null, body.currency ?? null]
      );
    }

    const updates: string[] = [];
    const params: unknown[] = [userId];
    if (body.name !== undefined)     { params.push(body.name);     updates.push(`name = $${params.length}`);     }
    if (body.locale !== undefined)   { params.push(body.locale);   updates.push(`locale = $${params.length}`);   }
    if (body.timezone !== undefined) { params.push(body.timezone); updates.push(`timezone = $${params.length}`); }

    if (updates.length > 0) {
      await query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $1`,
        params
      );
    }

    res.json({ message: '更新成功' });
  })
);

export default router;
