import { Redis } from 'ioredis';
import crypto from 'crypto';
import { config } from './config.js';
export const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
});
redis.on('error', (err) => {
    console.error('[Redis] 連接錯誤：', err.message);
});
// ── L1 記憶體緩存（5 秒）──
const l1 = new Map();
const L1_TTL_MS = 5_000;
// 定期清理過期的 L1 緩存條目
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of l1.entries()) {
        if (v.exp <= now)
            l1.delete(k);
    }
}, 30_000);
/** 從前綴和參數生成緩存 key */
export function cacheKey(prefix, params) {
    const hash = crypto.createHash('md5')
        .update(JSON.stringify(params))
        .digest('hex')
        .slice(0, 12);
    return `${prefix}:${hash}`;
}
/** 取緩存（L1 → L2）— Redis 異常時降級返回 null，由 L1 兜底 */
export async function getCache(key) {
    const l1Entry = l1.get(key);
    if (l1Entry && l1Entry.exp > Date.now())
        return l1Entry.data;
    l1.delete(key);
    try {
        const raw = await redis.get(key);
        if (raw) {
            const data = JSON.parse(raw);
            l1.set(key, { data, exp: Date.now() + L1_TTL_MS });
            return data;
        }
    }
    catch (err) {
        console.warn('[Cache] Redis 讀取降級：', err.message);
    }
    return null;
}
/** 設置緩存（L1 + L2）— Redis 異常時僅寫 L1 */
export async function setCache(key, value, ttlSec = 300) {
    l1.set(key, { data: value, exp: Date.now() + L1_TTL_MS });
    try {
        await redis.setex(key, ttlSec, JSON.stringify(value));
    }
    catch (err) {
        console.warn('[Cache] Redis 寫入降級：', err.message);
    }
}
/** 刪除緩存（L1 + L2） */
export async function delCache(key) {
    l1.delete(key);
    try {
        await redis.del(key);
    }
    catch (err) {
        console.warn('[Cache] Redis 刪除降級：', err.message);
    }
}
// shutdown 由 server/api.ts 統一編排（REL-01），此處不再各自 exit
/**
 * 帶防擊穿分布式鎖的緩存查詢
 * 修復 SmartClean Bug #1：內存鎖在多進程下無效 → 改用 Redis SETNX
 */
export async function cacheWithLock(key, fetchFn, ttlSec = 300) {
    const cached = await getCache(key);
    if (cached !== null)
        return cached;
    const lockKey = `lock:${key}`;
    const locked = await redis.set(lockKey, '1', 'EX', 10, 'NX');
    if (!locked) {
        // 等待其他請求完成（最多等 5 秒）
        for (let i = 0; i < 50; i++) {
            await new Promise(r => setTimeout(r, 100));
            const result = await getCache(key);
            if (result !== null)
                return result;
        }
        // 超時兜底：直接查詢
        return fetchFn();
    }
    try {
        const data = await fetchFn();
        await setCache(key, data, ttlSec);
        return data;
    }
    finally {
        await redis.del(lockKey);
    }
}
/** Redis 健康檢查 */
export async function checkRedisHealth() {
    try {
        await redis.ping();
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=cache.js.map