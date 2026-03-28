import type { Request, Response, NextFunction } from 'express';
import { verifySession } from '../services/userService.js';

// 擴展 Express Request 類型
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/** JWT 認證中間件，失敗回 401 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授權，請先登入' });
  }

  const token = header.slice(7);
  try {
    req.userId = await verifySession(token);
    next();
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'TOKEN_REVOKED') {
      return res.status(401).json({ error: 'Session 已失效，請重新登入' });
    }
    return res.status(401).json({ error: 'Token 無效或已過期' });
  }
}

/** 可選認證（不強制要求登入，但解析 token） */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.userId = await verifySession(header.slice(7));
    } catch {
      // 靜默忽略，userId 保持 undefined
    }
  }
  next();
}
