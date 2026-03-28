import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * CQ-01: 包裝 async route handler，捕獲未處理的 Promise rejection
 * Express 4 不會自動捕獲 async 錯誤，需要顯式傳遞給 next()
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
