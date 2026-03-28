import pg from 'pg';
import { config } from '../core/config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 50,                       // PM2 4 進程 × 50 = 200 併發 DB 連接
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: false,        // 空閒時不讓進程自動退出
  maxUses: 7_500,                // 對應 Python pool_recycle=1800，防長連接洩漏
});

pool.on('error', (err) => {
  console.error('[DB] 未預期的連接錯誤：', err.message);
});

// ── graceful shutdown（對應 Python FastAPI lifespan 上下文）──
async function shutdownDb(): Promise<void> {
  console.log('[DB] 正在關閉連接池...');
  await pool.end();
  console.log('[DB] 連接池已關閉');
}
process.once('SIGTERM', () => void shutdownDb().then(() => process.exit(0)));
process.once('SIGINT',  () => void shutdownDb().then(() => process.exit(0)));

/** 執行查詢，返回結果行數組 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const { rows } = await pool.query(text, params);
  return rows as T[];
}

/** 執行單行查詢，不存在時返回 null */
export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** 在事務中執行多個操作 */
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** 健康檢查 */
export async function checkDbHealth(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
