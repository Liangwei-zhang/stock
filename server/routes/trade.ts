import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { query, queryOne, transaction } from '../db/pool.js';
import { config } from '../core/config.js';

const router = Router();

/** 驗證 link_token + link_sig（HMAC 簽名校驗） */
function verifyLinkToken(
  tradeRow: { user_id: string; link_token: string; link_sig: string; symbol: string },
  token: string
): boolean {
  if (tradeRow.link_token !== token) return false;
  const expected = crypto.createHmac('sha256', config.TRADE_LINK_SECRET)
    .update(`${token}:${tradeRow.user_id}:${tradeRow.symbol}`)
    .digest('hex');
  // 防時序攻擊
  return crypto.timingSafeEqual(
    Buffer.from(tradeRow.link_sig),
    Buffer.from(expected)
  );
}

const confirmQuerySchema = z.object({
  action: z.enum(['accept', 'ignore']),
  t:      z.string().min(1),
});

/**
 * GET /api/trade/:id/confirm
 * 郵件鏈接一鍵確認/忽略（無需登入，一次性 token）
 */
router.get(
  '/:id/confirm',
  validate(confirmQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { action, t } = req.query as { action: 'accept' | 'ignore'; t: string };

    const trade = await queryOne<{
      id: string; user_id: string; symbol: string; action: string;
      suggested_shares: string; suggested_price: string; suggested_amount: string;
      status: string; link_token: string; link_sig: string; expires_at: string;
    }>(
      `SELECT * FROM trade_log WHERE id = $1`,
      [id]
    );

    if (!trade) {
      return res.status(404).send(renderPage('❌', '交易記錄不存在'));
    }
    if (trade.status !== 'pending') {
      return res.send(renderPage('ℹ️', `此建議已${statusLabel(trade.status)}，無需重複操作`));
    }
    if (new Date(trade.expires_at) < new Date()) {
      return res.send(renderPage('⏰', '此確認鏈接已過期（24 小時有效）'));
    }
    if (!verifyLinkToken(trade, t)) {
      return res.status(403).send(renderPage('⛔', '鏈接無效或已失效'));
    }

    if (action === 'ignore') {
      await query(
        `UPDATE trade_log SET status = 'ignored', confirmed_at = now() WHERE id = $1`,
        [id]
      );
      return res.send(renderPage('✅', '已忽略此建議'));
    }

    // accept：更新持倉
    await transaction(async (client) => {
      const shares = parseFloat(trade.suggested_shares);
      const price  = parseFloat(trade.suggested_price);
      const amount = parseFloat(trade.suggested_amount);

      if (trade.action === 'buy' || trade.action === 'add') {
        // 更新或創建持倉
        await client.query(
          `INSERT INTO user_portfolio (user_id, symbol, shares, avg_cost, total_capital)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, symbol) DO UPDATE SET
             avg_cost = (user_portfolio.shares * user_portfolio.avg_cost + $3 * $4)
                        / (user_portfolio.shares + $3),
             shares = user_portfolio.shares + $3,
             total_capital = (user_portfolio.shares + $3) *
                             ((user_portfolio.shares * user_portfolio.avg_cost + $3 * $4)
                              / (user_portfolio.shares + $3)),
             updated_at = now()`,
          [trade.user_id, trade.symbol, shares, price, amount]
        );
      } else if (trade.action === 'sell') {
        // 減少持倉
        const existing = await client.query<{ shares: string; avg_cost: string }>(
          `SELECT shares, avg_cost FROM user_portfolio
           WHERE user_id = $1 AND symbol = $2`,
          [trade.user_id, trade.symbol]
        );
        if (existing.rows.length > 0) {
          const oldShares = parseFloat(existing.rows[0].shares);
          const remain = oldShares - shares;
          if (remain <= 0.001) {
            // 全部賣出
            await client.query(
              `DELETE FROM user_portfolio WHERE user_id = $1 AND symbol = $2`,
              [trade.user_id, trade.symbol]
            );
          } else {
            await client.query(
              `UPDATE user_portfolio SET shares = $3,
               total_capital = $3 * avg_cost, updated_at = now()
               WHERE user_id = $1 AND symbol = $2`,
              [trade.user_id, trade.symbol, remain]
            );
          }
        }
      }

      await client.query(
        `UPDATE trade_log SET
           status = 'confirmed',
           actual_shares = $2, actual_price = $3, actual_amount = $4,
           confirmed_at = now()
         WHERE id = $1`,
        [id, shares, price, amount]
      );
    });

    return res.send(renderPage('✅', `已確認！持倉已自動更新 📊`));
  })
);

const adjustSchema = z.object({
  actual_shares: z.number().positive(),
  actual_price:  z.number().positive(),
});

/**
 * POST /api/trade/:id/adjust
 * 提交實際操作數據（H5 調整頁面提交）
 * 帶 link_token 驗證（無需登入）
 */
router.post(
  '/:id/adjust',
  validate(adjustSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { t } = req.query as { t?: string };
    const { actual_shares, actual_price } = req.body as z.infer<typeof adjustSchema>;

    if (!t) return res.status(400).json({ error: '缺少驗證 token' });

    const trade = await queryOne<{
      id: string; user_id: string; symbol: string; action: string;
      status: string; link_token: string; link_sig: string; expires_at: string;
    }>(`SELECT * FROM trade_log WHERE id = $1`, [id]);

    if (!trade) return res.status(404).json({ error: '不存在' });
    if (trade.status !== 'pending') return res.status(400).json({ error: '已操作' });
    if (new Date(trade.expires_at) < new Date()) return res.status(400).json({ error: '已過期' });
    if (!verifyLinkToken(trade, t)) return res.status(403).json({ error: '鏈接無效' });

    const actual_amount = parseFloat((actual_shares * actual_price).toFixed(2));

    await transaction(async (client) => {
      const shares = actual_shares;
      const price  = actual_price;

      if (trade.action === 'buy' || trade.action === 'add') {
        await client.query(
          `INSERT INTO user_portfolio (user_id, symbol, shares, avg_cost, total_capital)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, symbol) DO UPDATE SET
             avg_cost = (user_portfolio.shares * user_portfolio.avg_cost + $3 * $4)
                        / (user_portfolio.shares + $3),
             shares = user_portfolio.shares + $3,
             total_capital = (user_portfolio.shares + $3) *
                             ((user_portfolio.shares * user_portfolio.avg_cost + $3 * $4)
                              / (user_portfolio.shares + $3)),
             updated_at = now()`,
          [trade.user_id, trade.symbol, shares, price, shares * price]
        );
      } else {
        const existing = await client.query<{ shares: string; avg_cost: string }>(
          `SELECT shares, avg_cost FROM user_portfolio
           WHERE user_id = $1 AND symbol = $2`,
          [trade.user_id, trade.symbol]
        );
        if (existing.rows.length > 0) {
          const remain = parseFloat(existing.rows[0].shares) - shares;
          if (remain <= 0.001) {
            await client.query(
              `DELETE FROM user_portfolio WHERE user_id = $1 AND symbol = $2`,
              [trade.user_id, trade.symbol]
            );
          } else {
            await client.query(
              `UPDATE user_portfolio SET shares = $3,
               total_capital = $3 * avg_cost, updated_at = now()
               WHERE user_id = $1 AND symbol = $2`,
              [trade.user_id, trade.symbol, remain]
            );
          }
        }
      }

      await client.query(
        `UPDATE trade_log SET
           status = 'adjusted',
           actual_shares = $2, actual_price = $3, actual_amount = $4,
           confirmed_at = now()
         WHERE id = $1`,
        [id, shares, price, actual_amount]
      );
    });

    res.json({ message: '已記錄您的實際操作', actual_amount });
  }
);

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    confirmed: '已確認', adjusted: '已調整', ignored: '已忽略', expired: '已過期',
  };
  return map[s] ?? s;
}

function renderPage(emoji: string, msg: string): string {
  return `<!DOCTYPE html><html lang="zh">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stock Signal</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;
min-height:100dvh;margin:0;background:#f0f2f5}
.card{background:#fff;border-radius:20px;padding:40px 32px;text-align:center;
max-width:320px;box-shadow:0 4px 20px rgba(0,0,0,.08)}
.emoji{font-size:56px;margin-bottom:16px}
p{color:#555;font-size:15px;line-height:1.6}
a{color:#1677ff;font-size:13px}</style></head>
<body><div class="card">
<div class="emoji">${emoji}</div>
<p>${msg}</p>
<a href="/">返回首頁</a>
</div></body></html>`;
}

export default router;
