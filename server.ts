/**
 * server.ts — Express API 服务器 (v2)
 *
 * 新增功能：
 *   /db/ohlcv          — SQLite 历史 K 线持久化（双向同步）
 *   /api/yahoo/:symbol — Yahoo Finance 代理（P4 修复：不再依赖第三方 CORS）
 *   /api/report        — 服务端分析摘要（纯文本，供外部系统集成）
 *
 * 数据库：better-sqlite3（同步 SQLite，无需 ORM）
 * 安装：  npm install better-sqlite3 @types/better-sqlite3
 */

import express from 'express';
import path    from 'path';
import { existsSync, mkdirSync } from 'fs';

const app  = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// ─── CORS ─────────────────────────────────────────────────────────────────────
// 仅允许本地开发来源，防止跨站请求伪造
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// ─── API Key 鉴权（用于写入/删除等敏感端点）──────────────────────────────────
const API_KEY = process.env.API_KEY ?? '';

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  // 若未配置 API_KEY，则仅允许本地回环地址访问
  const clientIp = (req.socket.remoteAddress ?? '').replace('::ffff:', '');
  if (!API_KEY) {
    if (clientIp === '127.0.0.1' || clientIp === '::1') { next(); return; }
    res.status(403).json({ error: 'API_KEY not configured — only loopback allowed' });
    return;
  }
  const provided = req.headers['x-api-key'];
  if (provided !== API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

app.use(express.json({ limit: '10mb' }));

// ─── 速率限制（防暴力請求 / DoS）────────────────────────────────────────────
// 每個 IP 60 秒內最多 120 次請求（約 2 req/s），超限回 429
const _rlMap = new Map<string, { count: number; reset: number }>();
app.use((req, res, next) => {
  const key  = String(req.ip ?? 'unknown');
  const now  = Date.now();
  const slot = _rlMap.get(key);
  if (!slot || now > slot.reset) {
    _rlMap.set(key, { count: 1, reset: now + 60_000 });
    next();
  } else if (slot.count < 120) {
    slot.count++;
    next();
  } else {
    res.status(429).json({ error: 'Too many requests — please slow down' });
  }
});

// ─── SQLite 初始化（可选：如果 better-sqlite3 未安装则退化为内存模式）────────

let db: any = null;

async function initDB() {
  try {
    // 使用动态 import 避免 better-sqlite3 未安装时启动崩溃
    const Database = (await import('better-sqlite3')).default;
    const dbDir    = path.join(process.cwd(), 'data');
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    db = new Database(path.join(dbDir, 'market.db'));

    // 启用 WAL 模式提升写入性能，FULL 同步防止崩溃时数据损坏
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS ohlcv (
        symbol    TEXT    NOT NULL,
        timestamp INTEGER NOT NULL,
        open      REAL,
        high      REAL,
        low       REAL,
        close     REAL,
        volume    REAL,
        source    TEXT    DEFAULT 'unknown',
        PRIMARY KEY (symbol, timestamp)
      );
      CREATE INDEX IF NOT EXISTS idx_ohlcv_symbol ON ohlcv(symbol);

      CREATE TABLE IF NOT EXISTS symbols (
        symbol     TEXT PRIMARY KEY,
        name       TEXT,
        asset_type TEXT,
        exchange   TEXT,
        added_at   INTEGER
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id         TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      );
    `);

    console.log('✅ SQLite database ready: data/market.db');
  } catch (err: any) {
    console.error('❌ DB init error:', err?.message || err);
    console.warn('⚠️  better-sqlite3 not installed — DB features disabled.');
    console.warn('   Run: npm install better-sqlite3 @types/better-sqlite3');
    db = null;
  }
}

initDB().then(() => {
  // 從 SQLite 恢復持久化預警（伺服器重啟後不丟失）
  if (db) {
    try {
      const rows = db.prepare(
        `SELECT data FROM alerts ORDER BY created_at DESC LIMIT ${MAX_ALERTS}`
      ).all() as { data: string }[];
      alerts = rows.map(r => JSON.parse(r.data)).reverse();
      console.log(`📋 Restored ${alerts.length} alert(s) from DB.`);
    } catch (err: any) {
      console.warn('⚠️  Failed to restore alerts from DB:', err?.message);
    }
  }
}).catch(console.error);

// ─── SSE 预警广播 ─────────────────────────────────────────────────────────────

const MAX_ALERTS = 200;
let   alerts: any[]          = [];
const sseClients = new Set<express.Response>();

function broadcast(payload: object): void {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch { sseClients.delete(client); }
  }
}

app.get('/alerts-stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'init', alerts })}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/alerts', (_req, res) => res.json(alerts));

app.post('/alerts', (req, res) => {
  const alert = req.body;
  if (alert?.id) {
    alerts = [alert, ...alerts].slice(0, MAX_ALERTS);
    broadcast({ type: 'update', alert });
    if (db) {
      try {
        db.prepare('INSERT OR REPLACE INTO alerts (id, data) VALUES (?, ?)').run(
          alert.id,
          JSON.stringify(alert),
        );
        // 保留最近 MAX_ALERTS 筆，清理舊資料
        db.prepare(
          `DELETE FROM alerts WHERE id NOT IN (
            SELECT id FROM alerts ORDER BY created_at DESC LIMIT ${MAX_ALERTS}
          )`
        ).run();
      } catch { /* DB write failure is non-critical */ }
    }
  }
  res.json({ success: true });
});

app.delete('/alerts/:id', (req, res) => {
  alerts = alerts.filter(a => a.id !== req.params.id);
  broadcast({ type: 'delete', id: req.params.id });
  if (db) {
    try { db.prepare('DELETE FROM alerts WHERE id = ?').run(req.params.id); } catch { /* ignore */ }
  }
  res.json({ success: true });
});

// ─── OHLCV 数据库 API ─────────────────────────────────────────────────────────

/** 批量写入 K 线（幂等，重复 (symbol,timestamp) 忽略） */
app.post('/db/ohlcv', requireApiKey, (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB not available' });

  const records: any[] = req.body;
  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: 'records must be a non-empty array' });
  }

  // 校验每条 K 线记录的必要字段，防止注入或残缺数据写入
  for (const r of records) {
    if (typeof r.symbol !== 'string' || !r.symbol.trim()) {
      return res.status(400).json({ error: 'Each record must have a non-empty string symbol' });
    }
    if (typeof r.timestamp !== 'number' || !isFinite(r.timestamp) || r.timestamp <= 0) {
      return res.status(400).json({ error: 'Each record must have a positive numeric timestamp' });
    }
    if (r.close !== undefined && (typeof r.close !== 'number' || !isFinite(r.close) || r.close < 0)) {
      return res.status(400).json({ error: 'close must be a non-negative finite number' });
    }
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO ohlcv (symbol, timestamp, open, high, low, close, volume, source)
    VALUES (@symbol, @timestamp, @open, @high, @low, @close, @volume, @source)
  `);
  const bulk = db.transaction((rows: any[]) => {
    for (const r of rows) stmt.run(r);
  });

  try {
    bulk(records);
    res.json({ saved: records.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 查询指定标的历史 K 线 */
app.get('/db/ohlcv/:symbol', (req, res) => {
  if (!db) return res.json([]);

  const { symbol } = req.params;
  const from  = Number(req.query.from ?? 0);

  const rows = db.prepare(
    'SELECT * FROM ohlcv WHERE symbol = ? AND timestamp >= ? ORDER BY timestamp ASC'
  ).all(symbol, from);

  res.json(rows);
});

/** 删除指定标的数据 */
app.post('/db/ohlcv/:symbol/delete', requireApiKey, (req, res) => {
  if (!db) return res.json({ deleted: 0 });
  const count = db.prepare('DELETE FROM ohlcv WHERE symbol = ?').run(req.params.symbol);
  res.json({ deleted: count.changes });
});

/** 查询所有已存储标的列表 */
app.get('/db/symbols', (_req, res) => {
  if (!db) return res.json([]);
  const rows = db.prepare('SELECT DISTINCT symbol FROM ohlcv ORDER BY symbol').all();
  res.json(rows.map((r: any) => r.symbol));
});

/** 统计各标的数据量 */
app.get('/db/stats', (_req, res) => {
  if (!db) return res.json({ available: false });
  const rows = db.prepare(
    'SELECT symbol, COUNT(*) as rows, MIN(timestamp) as from_ts, MAX(timestamp) as to_ts FROM ohlcv GROUP BY symbol'
  ).all();
  res.json({ available: true, symbols: rows });
});

// ─── Yahoo Finance 搜尋代理 ───────────────────────────────────────────────────
// 前端搜尋改由此端點代理，不再依賴第三方 corsproxy.io

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  if (!q) { res.status(400).json({ error: 'Missing query' }); return; }

  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${
    encodeURIComponent(q)
  }&quotesCount=12&newsCount=0&listsCount=0&region=US&lang=en-US`;

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 6000);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal:  ctrl.signal,
    });
    if (!response.ok) { res.status(502).json({ error: `Yahoo returned ${response.status}` }); return; }
    res.json(await response.json());
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  } finally {
    clearTimeout(tid);
  }
});

// ─── Yahoo Finance 代理（P4 修复）─────────────────────────────────────────────
// 服务端发起请求，无 CORS 问题，不依赖任何第三方代理

app.get('/api/yahoo/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const params     = new URLSearchParams(req.query as Record<string, string>).toString();
  const url        = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo returned ${response.status}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ─── Telegram 通知代理 ────────────────────────────────────────────────────────
// Server 端統一發送，避免 CORS 問題，且 Token 不暴露於前端

app.post('/api/telegram', requireApiKey, async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    res.json({ success: false, reason: 'not_configured' });
    return;
  }

  const { message } = req.body ?? {};
  if (!message || typeof message !== 'string') {
    res.status(400).json({ success: false, reason: 'missing message' });
    return;
  }
  // 限制消息长度（Telegram 最大 4096 字符）
  const safeMessage = message.slice(0, 4096);

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text: safeMessage, parse_mode: 'Markdown' }),
    });
    if (!response.ok) {
      const body = await response.text();
      res.status(502).json({ success: false, reason: body });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(502).json({ success: false, reason: err.message });
  }
});

// ─── 健康检查 ─────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  let dbStats = { available: false as boolean, totalRows: 0 };
  if (db) {
    try {
      const r = db.prepare('SELECT COUNT(*) as n FROM ohlcv').get() as any;
      dbStats = { available: true, totalRows: r?.n ?? 0 };
    } catch { /* ignore */ }
  }
  res.json({
    status:     'ok',
    timestamp:  Date.now(),
    alerts:     alerts.length,
    sseClients: sseClients.size,
    db:         dbStats,
  });
});

// ─── 启动 ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 API server ready on http://localhost:${PORT}`);
  console.log(`  Alerts SSE  → GET  /alerts-stream`);
  console.log(`  OHLCV write → POST /db/ohlcv`);
  console.log(`  OHLCV read  → GET  /db/ohlcv/:symbol`);
  console.log(`  Yahoo proxy → GET  /api/yahoo/:symbol`);
  console.log(`  DB stats    → GET  /db/stats`);
  console.log(`  Health      → GET  /health\n`);

  // 啟動時檢查關鍵環境變數，提早發現配置問題
  if (!process.env.API_KEY) {
    console.warn('⚠️  [安全警告] API_KEY 未設定 — 寫入端點僅允許本機迴環訪問');
    console.warn('   生產環境請在 .env 設定 API_KEY（建議使用 openssl rand -hex 32 產生）');
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN 未設定 — Telegram 通知已停用');
  }
});
