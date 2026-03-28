import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const envSchema = z.object({
  NODE_ENV:            z.enum(['development', 'production', 'test']).default('development'),
  PORT:                z.coerce.number().default(3000),
  APP_URL:             z.string().default('http://localhost:3000'),
  DATABASE_URL:        z.string(),
  REDIS_URL:           z.string().default('redis://localhost:6379/0'),
  JWT_SECRET:          z.string().min(32, 'JWT_SECRET 至少需要 32 字元'),
  JWT_EXPIRES_IN:      z.coerce.number().default(604800), // 7 天（秒）
  TRADE_LINK_SECRET:   z.string().min(16, 'TRADE_LINK_SECRET 至少需要 16 字元'),
  SES_REGION:          z.string().default('us-east-1'),
  SES_ACCESS_KEY:      z.string().optional(),
  SES_SECRET_KEY:      z.string().optional(),
  RESEND_API_KEY:      z.string().optional(),
  EMAIL_FROM:          z.string().email().default('noreply@example.com'),
  EMAIL_FROM_NAME:     z.string().default('Stock Signal'),
  CORS_ORIGINS:        z.string().default(''),
});

function parseConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ 環境變數配置錯誤：');
    result.error.errors.forEach(e => {
      console.error(`  ${e.path.join('.')}: ${e.message}`);
    });
    process.exit(1);
  }
  return result.data;
}

export const config = parseConfig();

export const corsOrigins: string[] = config.CORS_ORIGINS
  ? config.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:3000'];
