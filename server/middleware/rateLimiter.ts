import type { Request, Response, NextFunction } from 'express';
import { redis } from '../core/cache.js';

/**
 * 基於 Redis ZSET 的滑動窗口限流中間件
 * 修復 SmartClean Bug #2：原版使用 defaultdict(list) 導致內存泄漏
 * 升級：從 INCR 固定窗口 → ZSET 滑動窗口（與 SmartClean rate_limit.py 對齊）
 *
 * 原理：
 *   ZREMRANGEBYSCORE 清除過期記錄 →
 *   ZCARD 取當前窗口計數 →
 *   ZADD 寫入本次請求時間戳 →
 *   EXPIRE 設置 key 過期
 */
export function rateLimiter(limit: number, windowSec = 60) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip   = (req.ip ?? req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
    const seg  = req.path.replace(/\//g, ':');
    const key  = `rl:${ip}${seg}`;
    const nowMs = Date.now();
    const windowMs = windowSec * 1000;

    try {
      // 滑動窗口 pipeline（原子操作，線性可擴展）
      const [, count] = await redis
        .pipeline()
        .zremrangebyscore(key, 0, nowMs - windowMs)   // 移除過期成員
        .zcard(key)                                    // 當前窗口計數
        .zadd(key, nowMs, `${nowMs}-${Math.random()}`) // 寫入本次請求
        .expire(key, windowSec + 5)                    // 設置 key 過期
        .exec() as [null, number, any, any][];

      if ((count as unknown as number) >= limit) {
        return res.status(429).json({
          error: '請求過於頻繁，請稍後再試',
          retryAfter: windowSec,
        });
      }
    } catch (err) {
      // Redis 異常時放行（降級，不因緩存故障影響正常請求）
      console.warn('[限流] Redis 錯誤，降級放行：', (err as Error).message);
    }
    next();
  };
}

/** 檢查 IP 是否在黑名單 */
export async function checkBlacklist(ip: string): Promise<boolean> {
  try {
    const blocked = await redis.get(`blacklist:${ip}`);
    return blocked !== null;
  } catch {
    return false;
  }
}

/** 黑名單中間件 */
export async function blacklistMiddleware(req: Request, res: Response, next: NextFunction) {
  const ip = (req.ip ?? req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
  if (await checkBlacklist(ip)) {
    return res.status(403).json({ error: '訪問被拒絕' });
  }
  next();
}
