import crypto from 'crypto';
import { config } from '../core/config.js';
import { query, queryOne } from '../db/pool.js';
/**
 * 分批止盈策略
 * 參考設計文件 4.3 節
 */
function calcSellAction(shares, avgCost, currentPrice, targetProfit, stopLoss, smcTopProbability = 0) {
    const pnlPct = (currentPrice - avgCost) / avgCost;
    // 止損觸發
    if (pnlPct <= -stopLoss) {
        return { sellPct: 1.0, reason: `止損觸發（虧損 ${(pnlPct * 100).toFixed(1)}%，止損線 ${(stopLoss * 100).toFixed(0)}%）` };
    }
    // SMC 頂部概率 > 70%
    if (smcTopProbability > 0.7) {
        return { sellPct: 0.5, reason: `SMC 頂部概率 ${(smcTopProbability * 100).toFixed(0)}%，建議賣出一半` };
    }
    // 分批止盈
    if (pnlPct >= 0.40) {
        return { sellPct: 1.0, reason: `盈利 ${(pnlPct * 100).toFixed(1)}% ≥ 40%，全部清倉` };
    }
    if (pnlPct >= 0.25) {
        return { sellPct: 0.75, reason: `盈利 ${(pnlPct * 100).toFixed(1)}% ≥ 25%，賣出 75% 鎖定利潤` };
    }
    if (pnlPct >= targetProfit) {
        return { sellPct: 0.50, reason: `已達目標 ${(targetProfit * 100).toFixed(0)}%（當前 ${(pnlPct * 100).toFixed(1)}%），賣出 50% 鎖定利潤` };
    }
    return null; // 不觸發賣出
}
/**
 * 處理賣出信號：掃描所有持倉該標的的用戶，判斷是否觸發止盈/止損
 */
export async function processSellSignal(signal) {
    const { symbol, currentPrice, smcTopProbability = 0 } = signal;
    const portfolios = await query(`SELECT
       p.id, p.user_id, u.email,
       p.symbol, p.shares, p.avg_cost, p.total_capital,
       p.target_profit, p.stop_loss, ua.currency
     FROM user_portfolio p
     JOIN users u         ON u.id = p.user_id
     JOIN user_account ua ON ua.user_id = p.user_id
     WHERE p.symbol = $1 AND p.notify = true AND u.is_active = true`, [symbol]);
    if (portfolios.length === 0)
        return;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    for (const p of portfolios) {
        const shares = parseFloat(p.shares);
        const avgCost = parseFloat(p.avg_cost);
        const targetProfit = parseFloat(p.target_profit);
        const stopLoss = parseFloat(p.stop_loss);
        const action = calcSellAction(shares, avgCost, currentPrice, targetProfit, stopLoss, smcTopProbability);
        if (!action)
            continue;
        const sellShares = Math.floor(shares * action.sellPct);
        if (sellShares < 1)
            continue;
        const suggestedAmount = parseFloat((sellShares * currentPrice).toFixed(2));
        const pnl = parseFloat(((currentPrice - avgCost) * sellShares).toFixed(2));
        const pnlPct = parseFloat(((currentPrice - avgCost) / avgCost * 100).toFixed(2));
        // 判斷類型
        const isStopping = pnlPct < 0;
        const tradeType = isStopping ? 'stop_loss' : 'sell';
        const action2 = 'sell';
        // 取 signal_id（用同一個）
        const sigRow = await queryOne(`INSERT INTO signals (symbol, type, score, price, reasons)
       VALUES ($1, $2::signal_type, $3, $4, $5)
       RETURNING id`, [symbol, tradeType, isStopping ? 30 : 75, currentPrice, JSON.stringify([action.reason])]);
        if (!sigRow)
            continue;
        const linkToken = crypto.randomUUID();
        const linkSig = crypto.createHmac('sha256', config.TRADE_LINK_SECRET)
            .update(`${linkToken}:${p.user_id}:${symbol}`)
            .digest('hex');
        const tradeRow = await queryOne(`INSERT INTO trade_log (
         user_id, symbol, action,
         suggested_shares, suggested_price, suggested_amount,
         signal_id, link_token, link_sig, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`, [
            p.user_id, symbol, action2,
            sellShares, currentPrice, suggestedAmount,
            sigRow.id, linkToken, linkSig, expiresAt,
        ]);
        if (!tradeRow)
            continue;
        // 入隊郵件
        const subject = isStopping
            ? `⛔ 止損提醒 | ${symbol}`
            : `🔔 止盈建議 | ${symbol}`;
        await query(`INSERT INTO email_queue (user_id, email, subject, body_html, priority)
       VALUES ($1, $2, $3, $4, $5)`, [
            p.user_id,
            p.email,
            subject,
            buildSellEmailHtml({
                symbol, isStopping, shares, avgCost,
                currentPrice, sellShares, suggestedAmount, pnl, pnlPct,
                reason: action.reason,
                tradeId: tradeRow.id,
                linkToken, currency: p.currency,
                remainShares: shares - sellShares,
            }),
            isStopping ? 1 : 5, // 止損郵件最高優先級
        ]);
    }
}
function buildSellEmailHtml(p) {
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const confirmUrl = `${appUrl}/api/trade/${p.tradeId}/confirm?action=accept&t=${p.linkToken}`;
    const adjustUrl = `${appUrl}/trade/adjust?id=${p.tradeId}&t=${p.linkToken}`;
    const ignoreUrl = `${appUrl}/api/trade/${p.tradeId}/confirm?action=ignore&t=${p.linkToken}`;
    const emoji = p.isStopping ? '⛔' : '🔔';
    const title = p.isStopping ? '止損提醒' : '止盈建議';
    const pnlColor = p.pnlPct >= 0 ? '#52c41a' : '#ff4d4f';
    return `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#333">
  <h2 style="margin:0 0 16px">${emoji} ${title} | ${p.symbol}</h2>

  <div style="background:#fafafa;border-radius:8px;padding:16px;margin-bottom:16px;font-size:14px">
    <p style="margin:2px 0">📊 您的持倉：${p.shares} 股 × 成本 $${p.avgCost.toFixed(2)}</p>
    <p style="margin:2px 0">💰 當前價格：<strong>$${p.currentPrice.toFixed(2)}</strong></p>
    <p style="margin:2px 0">盈虧：<strong style="color:${pnlColor}">${p.pnlPct >= 0 ? '+' : ''}$${p.pnl.toFixed(0)} (${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(1)}%)</strong></p>
  </div>

  <div style="border:1px solid #e8e8e8;border-radius:8px;padding:16px;margin-bottom:16px">
    <p style="margin:0 0 4px;font-weight:bold">── 建議操作 ──</p>
    <p style="margin:0;font-size:18px">
      賣出 <strong>${p.sellShares} 股</strong> × $${p.currentPrice.toFixed(2)}<br>
      回收金額：<strong>$${p.suggestedAmount.toFixed(2)}</strong>
    </p>
    ${p.remainShares > 0
        ? `<p style="margin:8px 0 0;font-size:13px;color:#666">賣出後剩餘：${p.remainShares.toFixed(0)} 股 × 成本 $${p.avgCost.toFixed(2)}</p>`
        : ''}
  </div>

  <div style="background:#fffbe6;border-radius:8px;padding:12px 16px;margin-bottom:24px;font-size:13px">
    ${p.reason}
  </div>

  <p style="color:#999;font-size:12px">⚠️ 以上為系統算法建議，不構成投資建議</p>

  <div style="display:flex;gap:8px;margin-top:16px">
    <a href="${confirmUrl}" style="flex:1;text-align:center;padding:12px;background:#52c41a;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">✅ 按建議確認</a>
    <a href="${adjustUrl}"  style="flex:1;text-align:center;padding:12px;background:#1677ff;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">✏️ 我調整了</a>
    <a href="${ignoreUrl}"  style="flex:1;text-align:center;padding:12px;background:#8c8c8c;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">✖ 忽略</a>
  </div>
</div>`;
}
//# sourceMappingURL=sellScanner.js.map