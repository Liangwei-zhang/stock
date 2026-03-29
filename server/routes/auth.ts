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

const supportedLocales = ['en-US', 'zh-CN', 'zh-TW'] as const;

// ── Schema ──
const sendCodeSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, 'Verification code must be 6 digits'),
  locale: z.enum(supportedLocales).optional(),
  timezone: z.string().optional(),
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
        error: 'A code was already sent. Please wait 60 seconds before trying again.',
      });
    }

    const code = generateCode();
    await saveEmailCode(email, code, ip || null);
    const { devCode } = await sendVerificationCode(email, code);

    res.json({
      message: devCode ? 'Verification code generated (email service not configured)' : 'Verification code sent. Please check your inbox.',
      ...(devCode ? { devCode } : {}),
    });
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
    const { email, code, locale, timezone } = req.body as {
      email: string;
      code: string;
      locale?: (typeof supportedLocales)[number];
      timezone?: string;
    };

    const valid = await verifyEmailCode(email, code);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    const user = await upsertUser(email, { locale, timezone });
    if (!user.is_active) {
      return res.status(403).json({ error: 'This account has been disabled' });
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
  })
);

/**
 * POST /api/auth/logout
 * 登出（撤銷 session）
 */
router.post('/logout', authMiddleware, asyncHandler(async (req, res) => {
  const token = req.headers.authorization!.slice(7);
  await revokeSession(token);
  res.json({ message: 'Signed out successfully' });
}));

export default router;
