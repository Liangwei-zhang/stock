import { Router } from 'express';
import { z } from 'zod';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
  generateCode,
  saveEmailCode,
  verifyEmailCode,
  upsertUser,
  createSession,
  revokeSession,
  isCodeRateLimited,
} from '../services/userService.js';
import { sendVerificationCode } from '../services/emailService.js';

const router = Router();

// ── Schema ──
const sendCodeSchema = z.object({
  email: z.string().email('請輸入有效的郵箱地址'),
});

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, '驗證碼為 6 位數字'),
});

/**
 * POST /api/auth/send-code
 * 發送登入驗證碼（60 秒限流，同 email）
 */
router.post(
  '/send-code',
  rateLimiter(10, 60), // 同 IP 每分鐘最多 10 次
  validate(sendCodeSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string };
    const ip = (req.ip ?? '').replace(/^::ffff:/, '');

    // 同 email 60 秒限流
    if (await isCodeRateLimited(email)) {
      return res.status(429).json({
        error: '驗證碼已發送，請等待 60 秒後再試',
      });
    }

    const code = generateCode();
    await saveEmailCode(email, code, ip || null);
    await sendVerificationCode(email, code);

    res.json({ message: '驗證碼已發送，請查收郵件' });
  })
);

/**
 * POST /api/auth/verify
 * 驗證碼登入（自動創建新用戶）
 */
router.post(
  '/verify',
  rateLimiter(20, 60),
  validate(verifySchema),
  asyncHandler(async (req, res) => {
    const { email, code } = req.body as { email: string; code: string };

    const valid = await verifyEmailCode(email, code);
    if (!valid) {
      return res.status(400).json({ error: '驗證碼錯誤或已過期' });
    }

    const user = await upsertUser(email);
    if (!user.is_active) {
      return res.status(403).json({ error: '帳號已被停用' });
    }

    const deviceInfo = {
      userAgent: req.headers['user-agent'] ?? '',
      ip: (req.ip ?? '').replace(/^::ffff:/, ''),
    };
    const token = await createSession(user.id, deviceInfo);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        locale: user.locale,
        timezone: user.timezone,
        isNew: !user.last_login_at,
      },
    });
  }
);

/**
 * POST /api/auth/logout
 * 登出（撤銷 session）
 */
router.post('/logout', authMiddleware, asyncHandler(async (req, res) => {
  const token = req.headers.authorization!.slice(7);
  await revokeSession(token);
  res.json({ message: '已登出' });
}));

export default router;
