import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { query, queryOne, transaction } from '../db/pool.js';
import { redis } from '../core/cache.js';
import { config } from '../core/config.js';
/** 生成 6 位數驗證碼 */
export function generateCode() {
    return String(crypto.randomInt(100000, 999999));
}
/** 儲存驗證碼到 DB（同時在 Redis 中設置 5 分鐘 TTL） */
export async function saveEmailCode(email, code, ip) {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await query(`INSERT INTO email_codes (email, code, ip, expires_at)
     VALUES (lower($1), $2, $3::inet, $4)`, [email, code, ip, expiresAt]);
    // Redis 副本用於快速查驗（降低 DB 壓力）
    await redis.setex(`code:${email.toLowerCase()}`, 300, code);
}
/** 驗證碼校驗：先查 Redis，再查 DB，成功後標記已使用 */
export async function verifyEmailCode(email, code) {
    const lEmail = email.toLowerCase();
    // SEC-02: 按 email 維度的嘗試次數限制（5 分鐘內最多 5 次），Redis 異常時降級放行
    const attemptKey = `verify_attempt:${lEmail}`;
    try {
        const attempts = await redis.incr(attemptKey);
        if (attempts === 1)
            await redis.expire(attemptKey, 300);
        if (attempts > 5)
            return false;
    }
    catch {
        // Redis 異常降級放行
    }
    const cached = await redis.get(`code:${lEmail}`);
    if (cached && cached === code) {
        await redis.del(`code:${lEmail}`);
        // 非同步標記 DB（不阻塞響應）
        query(`UPDATE email_codes SET used_at = now()
       WHERE lower(email) = $1 AND code = $2 AND used_at IS NULL AND expires_at > now()`, [lEmail, code]).catch(err => console.error('[auth] 標記驗證碼失敗：', err.message));
        return true;
    }
    // 慢路徑：DB
    const row = await queryOne(`SELECT id FROM email_codes
     WHERE lower(email) = $1 AND code = $2
       AND used_at IS NULL AND expires_at > now()
     LIMIT 1`, [lEmail, code]);
    if (!row)
        return false;
    await query(`UPDATE email_codes SET used_at = now() WHERE id = $1`, [row.id]);
    return true;
}
/** 根據 email 取得或創建用戶 */
export async function upsertUser(email, preferences = {}) {
    const lEmail = email.toLowerCase();
    return transaction(async (client) => {
        // 先查
        const existing = await client.query(`SELECT * FROM users WHERE lower(email) = $1 LIMIT 1`, [lEmail]);
        if (existing.rows.length > 0) {
            // 更新最後登入時間
            await client.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [existing.rows[0].id]);
            return existing.rows[0];
        }
        // 不存在則創建
        const locale = preferences.locale ?? 'zh-CN';
        const timezone = preferences.timezone ?? 'Asia/Shanghai';
        const { rows } = await client.query(`INSERT INTO users (email, last_login_at, locale, timezone)
       VALUES (lower($1), now(), $2, $3)
       RETURNING *`, [lEmail, locale, timezone]);
        // 創建空資金帳戶（等待引導頁設置）
        await client.query(`INSERT INTO user_account (user_id, total_capital, currency)
       VALUES ($1, 0, 'USD') ON CONFLICT DO NOTHING`, [rows[0].id]);
        return rows[0];
    });
}
/** 創建 session 並返回 JWT token */
export async function createSession(userId, deviceInfo = {}) {
    const expiresAt = new Date(Date.now() + config.JWT_EXPIRES_IN * 1000);
    const payload = { sub: userId, iat: Math.floor(Date.now() / 1000) };
    const token = jwt.sign(payload, config.JWT_SECRET, {
        expiresIn: config.JWT_EXPIRES_IN,
    });
    // 儲存 hash（不存明文 token）
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await query(`INSERT INTO sessions (token_hash, user_id, device_info, expires_at)
     VALUES ($1, $2, $3, $4)`, [tokenHash, userId, JSON.stringify(deviceInfo), expiresAt.toISOString()]);
    return token;
}
/** 驗證 JWT，返回用戶 ID，無效則拋出錯誤 */
export async function verifySession(token) {
    // 驗證 JWT 簽名
    let payload;
    try {
        payload = jwt.verify(token, config.JWT_SECRET);
    }
    catch {
        throw new Error('TOKEN_INVALID');
    }
    // 檢查 session 是否在 DB 中存在且未過期
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = await queryOne(`SELECT user_id FROM sessions
     WHERE token_hash = $1 AND expires_at > now()
     LIMIT 1`, [tokenHash]);
    if (!session)
        throw new Error('TOKEN_REVOKED');
    return payload.sub;
}
/** 撤銷 session */
export async function revokeSession(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}
/** 檢查同一 email 是否在 60 秒內已發送過驗證碼 */
export async function isCodeRateLimited(email) {
    const key = `code_limit:${email.toLowerCase()}`;
    const exists = await redis.get(key);
    if (exists)
        return true;
    await redis.setex(key, 60, '1');
    return false;
}
//# sourceMappingURL=userService.js.map