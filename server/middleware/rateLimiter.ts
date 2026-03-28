import type { Request, Response, NextFunction } from 'express';
import { redis } from '../core/cache.js';

/**
 * 基於 Redis 的滑動窗口限流中間件
 * 修復 SmartClean Bug #2：原版使用 defaultdict(list) 導致內存泄漏
 */
export function rateLimiter(limit: number, windowSec = 60) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.ip ?? req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
    const path = req.path.replace(/\//g, ':');
    const key = `rl:${ip}${path}`;

    try {
      const current = await redis.incr(key);
      if (current === 1) await redis.expire(key, windowSec);

      if (current > limit) {
        return res.status(429).json({
          error: '請求過於頻繁，請稍後再試',
          retryAfter: windowSec,
        });
      }
    } catch (err) {
      // Redis 異常時放行（降級處理，不因緩存服務影響正常請求）
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
