import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { query, queryOne } from '../db/pool.js';
import { delCache } from '../core/cache.js';

const router = Router();
router.use(authMiddleware);

async function getMaxPortfolio(userId: string): Promise<number> {
  const row = await queryOne<{ plan: string }>(
    `SELECT plan FROM users WHERE id = $1`,
    [userId]
  );
  const limits: Record<string, number> = { free: 5, pro: 20, premium: 100 };
  return limits[row?.plan ?? 'free'] ?? 5;
}

const addSchema = z.object({
  symbol:        z.string().min(1).max(20).transform(s => s.toUpperCase()),
  shares:        z.number().int('Shares must be a whole number').positive('Shares must be greater than 0'),
  avg_cost:      z.number().positive('Average cost must be greater than 0'),
  target_profit: z.number().min(0.01).max(1).default(0.15),
  stop_loss:     z.number().min(0.01).max(1).default(0.08),
  notify:        z.boolean().default(true),
  notes:         z.string().max(200).optional(),
});

const updateSchema = addSchema.partial().omit({ symbol: true });

/** GET /api/portfolio */
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const rows = await query(
    `SELECT p.id, p.symbol, p.shares, p.avg_cost, p.total_capital,
            p.target_profit, p.stop_loss, p.notify, p.notes, p.updated_at,
            s.name, s.name_zh, s.asset_type
     FROM user_portfolio p
     LEFT JOIN symbols s ON s.symbol = p.symbol
     WHERE p.user_id = $1
     ORDER BY p.total_capital DESC`,
    [userId]
  );
  res.json(rows);
}));

/** POST /api/portfolio */
router.post('/', validate(addSchema), asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const body = req.body as z.infer<typeof addSchema>;

  const [countRow, max] = await Promise.all([
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM user_portfolio WHERE user_id = $1`,
      [userId]
    ),
    getMaxPortfolio(userId),
  ]);
  if (Number(countRow?.count ?? 0) >= max) {
    return res.status(400).json({ error: `Portfolio limit reached (${max} positions)` });
  }

  // Ensure the symbol exists.
  await query(
    `INSERT INTO symbols (symbol, name) VALUES ($1, $1)
     ON CONFLICT (symbol) DO NOTHING`,
    [body.symbol]
  );

  const totalCapital = parseFloat((body.shares * body.avg_cost).toFixed(2));

  const row = await queryOne(
    `INSERT INTO user_portfolio
       (user_id, symbol, shares, avg_cost, total_capital, target_profit, stop_loss, notify, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_id, symbol) DO UPDATE SET
       shares = EXCLUDED.shares,
       avg_cost = EXCLUDED.avg_cost,
       total_capital = EXCLUDED.total_capital,
       target_profit = EXCLUDED.target_profit,
       stop_loss = EXCLUDED.stop_loss,
       notify = EXCLUDED.notify,
       notes = EXCLUDED.notes,
       updated_at = now()
     RETURNING *`,
    [
      userId, body.symbol, body.shares, body.avg_cost, totalCapital,
      body.target_profit, body.stop_loss, body.notify, body.notes ?? null,
    ]
  );

  await delCache('active_symbols');
  res.status(201).json(row);
}));

/** PUT /api/portfolio/:id */
router.put('/:id', validate(updateSchema), asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const { id } = req.params;
  const body = req.body as z.infer<typeof updateSchema>;

  // Merge existing values before recalculating total_capital.
  const existing = await queryOne<{
    shares: string; avg_cost: string;
  }>(
    `SELECT shares, avg_cost FROM user_portfolio WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!existing) return res.status(404).json({ error: 'Position not found' });

  const newShares   = body.shares   ?? parseFloat(existing.shares);
  const newAvgCost  = body.avg_cost ?? parseFloat(existing.avg_cost);
  const totalCapital = parseFloat((newShares * newAvgCost).toFixed(2));

  const updates: string[] = ['updated_at = now()', `total_capital = $3`];
  const params: unknown[] = [id, userId, totalCapital];

  const fields: [keyof typeof body, string][] = [
    ['shares', 'shares'], ['avg_cost', 'avg_cost'],
    ['target_profit', 'target_profit'], ['stop_loss', 'stop_loss'],
    ['notify', 'notify'], ['notes', 'notes'],
  ];
  for (const [key, col] of fields) {
    if (body[key] !== undefined) {
      params.push(body[key]);
      updates.push(`${col} = $${params.length}`);
    }
  }

  const row = await queryOne(
    `UPDATE user_portfolio SET ${updates.join(', ')}
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    params
  );
  await delCache('active_symbols');
  res.json(row);
}));

/** DELETE /api/portfolio/:id */
router.delete('/:id', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const { id } = req.params;
  const row = await queryOne(
    `DELETE FROM user_portfolio WHERE id = $1 AND user_id = $2 RETURNING symbol`,
    [id, userId]
  );
  if (!row) return res.status(404).json({ error: 'Position not found' });
  await delCache('active_symbols');
  res.json({ message: 'Deleted' });
}));

export default router;
