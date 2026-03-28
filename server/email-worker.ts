import { query, queryOne, transaction } from '../db/pool.js';
import { sendEmail } from '../services/emailService.js';

const BATCH_SIZE = 50;
const POLL_INTERVAL_MS = 2_000;
const WORKER_ID = `worker_${process.pid}`;

let running = false;

/** 消費 email_queue，批量發送郵件 */
async function processEmailBatch(): Promise<void> {
  // 原子性鎖定一批待發郵件（SKIP LOCKED 防止多進程重複取）
  const emails = await query<{
    id: number;
    user_id: string;
    email: string;
    subject: string;
    body_html: string;
    priority: number;
    attempts: number;
    max_attempts: number;
  }>(
    `UPDATE email_queue SET status = 'sending', locked_by = $1, locked_at = now()
     WHERE id IN (
       SELECT id FROM email_queue
       WHERE status = 'pending'
       ORDER BY priority, created_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, user_id, email, subject, body_html, priority, attempts, max_attempts`,
    [WORKER_ID, BATCH_SIZE]
  );

  if (emails.length === 0) return;

  await Promise.allSettled(
    emails.map(async (mail) => {
      try {
        await sendEmail({
          to: mail.email,
          subject: mail.subject,
          html: mail.body_html,
        });
        await query(
          `UPDATE email_queue SET status = 'sent', sent_at = now(), locked_by = NULL
           WHERE id = $1`,
          [mail.id]
        );
      } catch (err) {
        const attempts = mail.attempts + 1;
        const newStatus = attempts >= mail.max_attempts ? 'failed' : 'pending';
        await query(
          `UPDATE email_queue SET
             status = $1, attempts = $2, error = $3,
             locked_by = NULL, locked_at = NULL
           WHERE id = $4`,
          [newStatus, attempts, (err as Error).message, mail.id]
        );
      }
    })
  );
}

/** 清理卡死的 sending 狀態（超過 5 分鐘未完成）*/
async function releaseStaleLocks(): Promise<void> {
  await query(
    `UPDATE email_queue SET status = 'pending', locked_by = NULL, locked_at = NULL
     WHERE status = 'sending'
       AND locked_at < now() - interval '5 minutes'`
  );
}

/** 啟動 Email Worker */
export async function startEmailWorker(): Promise<void> {
  if (running) return;
  running = true;
  console.log(`📬 Email Worker 啟動 [${WORKER_ID}]`);

  // 每 5 分鐘清理一次卡死鎖
  const cleanupInterval = setInterval(releaseStaleLocks, 5 * 60 * 1000);

  const loop = async () => {
    if (!running) return;
    try {
      await processEmailBatch();
    } catch (err) {
      console.error('[EmailWorker] 批次處理失敗：', (err as Error).message);
    }
    setTimeout(loop, POLL_INTERVAL_MS);
  };

  loop();

  // 優雅關閉
  const shutdown = () => {
    running = false;
    clearInterval(cleanupInterval);
    console.log('📬 Email Worker 關閉');
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

// 若直接執行此文件則啟動 worker
if (process.argv[1]?.endsWith('email-worker.ts') || process.argv[1]?.endsWith('email-worker.js')) {
  import('../db/pool.js').then(() => startEmailWorker());
}
