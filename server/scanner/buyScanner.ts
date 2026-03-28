import { query, queryOne } from '../db/pool.js';
import { redis } from '../core/cache.js';
import { calcPosition } from './positionEngine.js';

export interface BuySignal {
  symbol: string;
  score: number;
  price: number;
  reasons: string[];
  analysis: Record<string, unknown>;
}

/**
 * 處理買入信號：
 * 1. 寫入 signals 表
 * 2. 對所有關注該標的且 min_score 通過的用戶生成 trade_log
 * 3. 批量入隊 email_queue
 */
export async function processBuySignal(signal: BuySignal): Promise<void> {
  // 1. 插入 signals 記錄
  const sigRow = await queryOne<{ id: string }>(
    `INSERT INTO signals (symbol, type, score, price, reasons, analysis)
     VALUES ($1, 'buy', $2, $3, $4, $5)
     RETURNING id`,
    [
      signal.symbol,
      signal.score,
      signal.price,
      JSON.stringify(signal.reasons),
      JSON.stringify(signal.analysis),
    ]
  );
  if (!sigRow) return;
  const signalId = sigRow.id;

  // 2. 查找所有關注且通過 min_score 的用戶
  const subscribers = await query<{
    user_id: string;
    email: string;
    total_capital: string;
    currency: string;
    existing_shares: string | null;
    existing_avg_cost: string | null;
  }>(
    `SELECT
       uw.user_id,
       u.email,
       ua.total_capital,
       ua.currency,
       up.shares   AS existing_shares,
       up.avg_cost AS existing_avg_cost
     FROM user_watchlist uw
     JOIN users u        ON u.id = uw.user_id
     JOIN user_account ua ON ua.user_id = uw.user_id
     LEFT JOIN user_portfolio up ON up.user_id = uw.user_id AND up.symbol = $1
     WHERE uw.symbol = $1
       AND uw.notify = true
       AND $2 >= uw.min_score
       AND u.is_active = true
       AND ua.total_capital > 0`,
    [signal.symbol, signal.score]
  );

  if (subscribers.length === 0) return;

  // 3. 對每個用戶計算倉位並排隊郵件
  const now = Date.now();
  const expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();

  for (const sub of subscribers) {
    const totalCapital = parseFloat(sub.total_capital);

    // 計算可用現金（總資金 - 持倉總值）
    const portfolioRows = await query<{ total_capital: string }>(
      `SELECT SUM(total_capital)::text as total_capital
       FROM user_portfolio WHERE user_id = $1`,
      [sub.user_id]
    );
    const portfolioValue = parseFloat(portfolioRows[0]?.total_capital ?? '0');
    const availableCash = totalCapital - portfolioValue;

    const suggestion = calcPosition({
      totalCapital,
      availableCash,
      currentPrice: signal.price,
      score: signal.score,
      existingShares: sub.existing_shares ? parseFloat(sub.existing_shares) : 0,
      existingAvgCost: sub.existing_avg_cost ? parseFloat(sub.existing_avg_cost) : 0,
    });

    if (!suggestion) continue; // 資金不足，跳過

    // 生成一次性 token
    const linkToken = crypto.randomUUID();
    const crypto2 = await import('crypto');
    const linkSig = crypto2.createHmac('sha256', process.env.TRADE_LINK_SECRET ?? 'secret')
      .update(`${linkToken}:${sub.user_id}:${signal.symbol}`)
      .digest('hex');

    // 插入 trade_log
    const tradeRow = await queryOne<{ id: string }>(
      `INSERT INTO trade_log (
         user_id, symbol, action,
         suggested_shares, suggested_price, suggested_amount,
         signal_id, link_token, link_sig, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        sub.user_id, signal.symbol, suggestion.action,
        suggestion.suggestedShares, suggestion.suggestedPrice, suggestion.suggestedAmount,
        signalId, linkToken, linkSig, expiresAt,
      ]
    );
    if (!tradeRow) continue;

    // 入隊郵件
    const subject = suggestion.action === 'buy'
      ? `📈 買入建議 | ${signal.symbol}`
      : `📈 加倉建議 | ${signal.symbol}`;

    await query(
      `INSERT INTO email_queue (user_id, email, subject, body_html, priority)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        sub.user_id,
        sub.email,
        subject,
        buildBuyEmailHtml({
          signal, suggestion, tradeId: tradeRow.id, linkToken,
          totalCapital, availableCash,
          existingShares: sub.existing_shares ? parseFloat(sub.existing_shares) : 0,
          existingAvgCost: sub.existing_avg_cost ? parseFloat(sub.existing_avg_cost) : 0,
          currency: sub.currency,
        }),
        signal.score >= 90 ? 3 : 5, // 極強信號優先級更高
      ]
    );
  }
}

interface EmailParams {
  signal: BuySignal;
  suggestion: ReturnType<typeof calcPosition>;
  tradeId: string;
  linkToken: string;
  totalCapital: number;
  availableCash: number;
  existingShares: number;
  existingAvgCost: number;
  currency: string;
}

function buildBuyEmailHtml(p: EmailParams): string {
  const { signal, suggestion, tradeId, totalCapital, availableCash, currency } = p;
  if (!suggestion) return '';

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const confirmUrl = `${appUrl}/api/trade/${tradeId}/confirm?action=accept&t=${p.linkToken}`;
  const adjustUrl  = `${appUrl}/trade/adjust?id=${tradeId}&t=${p.linkToken}`;
  const ignoreUrl  = `${appUrl}/api/trade/${tradeId}/confirm?action=ignore&t=${p.linkToken}`;

  const scoreLabel = signal.score >= 90 ? '極強買入' : signal.score >= 80 ? '強買入' : signal.score >= 70 ? '中等買入' : '弱買入';
  const afterCash = availableCash - suggestion.suggestedAmount;

  return `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#333">
  <h2 style="margin:0 0 16px">📈 ${suggestion.action === 'add' ? '加倉' : '買入'}建議 | ${signal.symbol}</h2>

  <div style="background:#f0f8ff;border-radius:8px;padding:16px;margin-bottom:16px">
    <p style="margin:0 0 6px">🎯 信號強度：<strong>${scoreLabel}（Score: ${signal.score}/100）</strong></p>
    <p style="margin:0">💰 當前價格：<strong>$${signal.price.toFixed(2)}</strong></p>
  </div>

  <div style="border:1px solid #e8e8e8;border-radius:8px;padding:16px;margin-bottom:16px">
    <p style="margin:0 0 4px;font-weight:bold">── 建議操作 ──</p>
    <p style="margin:0;font-size:18px">
      ${suggestion.action === 'add' ? '加倉' : '買入'} <strong>${suggestion.suggestedShares} 股</strong> × $${suggestion.suggestedPrice.toFixed(2)}<br>
      投入金額：<strong>$${suggestion.suggestedAmount.toFixed(2)}</strong>
    </p>
  </div>

  <div style="background:#fafafa;border-radius:8px;padding:16px;margin-bottom:16px;font-size:14px">
    <p style="margin:0 0 4px;font-weight:bold">── 帳戶變化 ──</p>
    <p style="margin:2px 0">總資金：$${totalCapital.toFixed(0)} ${currency}</p>
    <p style="margin:2px 0">可用現金：$${availableCash.toFixed(0)} → <strong>$${afterCash.toFixed(0)}</strong></p>
  </div>

  <div style="background:#fafafa;border-radius:8px;padding:16px;margin-bottom:24px;font-size:13px">
    <p style="margin:0 0 6px;font-weight:bold">📊 信號依據：</p>
    ${signal.reasons.map(r => `<p style="margin:2px 0">• ${r}</p>`).join('')}
  </div>

  <p style="color:#999;font-size:12px">⚠️ 以上為系統算法建議，不構成投資建議</p>

  <div style="display:flex;gap:8px;margin-top:16px">
    <a href="${confirmUrl}" style="flex:1;text-align:center;padding:12px;background:#52c41a;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">✅ 按建議確認</a>
    <a href="${adjustUrl}"  style="flex:1;text-align:center;padding:12px;background:#1677ff;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">✏️ 我調整了</a>
    <a href="${ignoreUrl}"  style="flex:1;text-align:center;padding:12px;background:#8c8c8c;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">✖ 忽略</a>
  </div>
</div>`;
}
