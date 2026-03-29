/**
 * server/middleware/idempotency.ts — Layer 5 冪等性保護
 *
 * 對應 SmartClean: app/core/idempotency.py
 * 修復 Bug #4：import 移到頂部（原版在末尾）
 *
 * 用法：掛在需要防重複提交的 POST/PUT 路由上
 *   router.post('/trade/:id/confirm', idempotencyMiddleware, handler)
 *
 * 流程：
 *   1. 讀取請求頭 Idempotency-Key
 *   2. 若 Redis 已有結果 → 直接返回（防重複）
 *   3. 用 Redis SETNX 搶分布式鎖
 *   4. 攔截 res.json，成功後存入 Redis（TTL 24h）
 *   5. Redis 異常時降級放行（不影響正常請求）
 */
import { redis } from '../core/cache.js';
const IDEMPOTENCY_TTL = 86_400; // 24 小時
export function idempotencyMiddleware(req, res, next) {
    const key = req.headers['idempotency-key'];
    if (!key)
        return next();
    const redisKey = `idempotency:${key}`;
    const lockKey = `idempotency:lock:${key}`;
    void (async () => {
        try {
            // 1. 已有快取結果 → 直接返回
            const cached = await redis.get(redisKey);
            if (cached) {
                res.status(200).json(JSON.parse(cached));
                return;
            }
            // 2. 搶分布式鎖（防併發重複執行）
            const locked = await redis.set(lockKey, '1', 'EX', 10, 'NX');
            if (!locked) {
                // 等待最多 5 秒看是否有結果
                for (let i = 0; i < 50; i++) {
                    await new Promise(r => setTimeout(r, 100));
                    const result = await redis.get(redisKey);
                    if (result) {
                        res.status(200).json(JSON.parse(result));
                        return;
                    }
                }
                res.status(409).json({ error: '請求處理中，請稍後再試' });
                return;
            }
            // 3. 攔截 res.json，成功後存入 Redis
            const originalJson = res.json.bind(res);
            res.json = (body) => {
                if (res.statusCode < 400) {
                    void redis.setex(redisKey, IDEMPOTENCY_TTL, JSON.stringify(body))
                        .finally(() => void redis.del(lockKey));
                }
                else {
                    void redis.del(lockKey);
                }
                return originalJson(body);
            };
            next();
        }
        catch {
            // Redis 異常降級放行
            next();
        }
    })();
}
//# sourceMappingURL=idempotency.js.map