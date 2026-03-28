import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { Resend } from 'resend';
import { config } from '../core/config.js';

// ── 根據配置選擇郵件驅動 ──
const useResend = Boolean(config.RESEND_API_KEY);
const useSES = Boolean(config.SES_ACCESS_KEY && config.SES_SECRET_KEY);

const sesClient = useSES
  ? new SESClient({
    region: config.SES_REGION,
    credentials: {
      accessKeyId: config.SES_ACCESS_KEY!,
      secretAccessKey: config.SES_SECRET_KEY!,
    },
  })
  : null;

const resend = useResend ? new Resend(config.RESEND_API_KEY!) : null;

interface SendParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/** 發送郵件（開發環境印到 console，生產環境用 SES/Resend） */
export async function sendEmail(params: SendParams): Promise<void> {
  if (config.NODE_ENV === 'development' && !useResend && !useSES) {
    console.log('📧 [Dev 郵件模擬]');
    console.log(`  To: ${params.to}`);
    console.log(`  Subject: ${params.subject}`);
    console.log(`  ---`);
    console.log(params.text ?? params.html.replace(/<[^>]+>/g, ''));
    console.log(`  ---`);
    return;
  }

  if (useSES && sesClient) {
    await sesClient.send(new SendEmailCommand({
      Source: `${config.EMAIL_FROM_NAME} <${config.EMAIL_FROM}>`,
      Destination: { ToAddresses: [params.to] },
      Message: {
        Subject: { Data: params.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: params.html, Charset: 'UTF-8' },
          ...(params.text ? { Text: { Data: params.text, Charset: 'UTF-8' } } : {}),
        },
      },
    }));
    return;
  }

  if (useResend && resend) {
    await resend.emails.send({
      from: `${config.EMAIL_FROM_NAME} <${config.EMAIL_FROM}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
    return;
  }

  throw new Error('未配置郵件服務，請設置 SES_ACCESS_KEY 或 RESEND_API_KEY');
}

/** 發送驗證碼郵件 */
export async function sendVerificationCode(email: string, code: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: `您的登入驗證碼 ${code}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1a1a1a">Stock Signal — 登入驗證碼</h2>
        <p>您正在登入 <strong>Stock Signal</strong> 系統，驗證碼為：</p>
        <div style="background:#f5f5f5;border-radius:8px;padding:20px;text-align:center;
                    font-size:36px;font-weight:bold;letter-spacing:8px;color:#333;margin:20px 0">
          ${code}
        </div>
        <p style="color:#666;font-size:14px">5 分鐘內有效，請勿洩露給他人。</p>
        <p style="color:#999;font-size:12px">如非本人操作，請忽略此郵件。</p>
      </div>
    `,
    text: `您的 Stock Signal 登入驗證碼：${code}\n\n5 分鐘內有效，請勿洩露給他人。`,
  });
}
