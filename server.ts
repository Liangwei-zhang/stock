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
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.use(express.json({ limit: '10mb' }));

// ─── SQLite 初始化（可选：如果 better-sqlite3 未安装则退化为内存模式）────────

let db: any = null;

async function initDB() {
  try {
    // 使用动态 import 避免 better-sqlite3 未安装时启动崩溃
    const Database = (await import('better-sqlite3')).default;
    const dbDir    = path.join(process.cwd(), 'data');
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    db = new Database(path.join(dbDir, 'market.db'));

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
    `);

    console.log('✅ SQLite database ready: data/market.db');
  } catch (err: any) {
    console.error('❌ DB init error:', err?.message || err);
    console.warn('⚠️  better-sqlite3 not installed — DB features disabled.');
    console.warn('   Run: npm install better-sqlite3 @types/better-sqlite3');
    db = null;
  }
}

initDB().catch(console.error);

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
  }
  res.json({ success: true });
});

app.delete('/alerts/:id', (req, res) => {
  alerts = alerts.filter(a => a.id !== req.params.id);
  broadcast({ type: 'delete', id: req.params.id });
  res.json({ success: true });
});

// ─── OHLCV 数据库 API ─────────────────────────────────────────────────────────

/** 批量写入 K 线（幂等，重复 (symbol,timestamp) 忽略） */
app.post('/db/ohlcv', (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB not available' });

  const records: any[] = req.body;
  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: 'records must be a non-empty array' });
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
app.post('/db/ohlcv/:symbol/delete', (req, res) => {
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

app.post('/api/telegram', async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    res.json({ success: false, reason: 'not_configured' });
    return;
  }

  const { message } = req.body ?? {};
  if (!message) {
    res.status(400).json({ success: false, reason: 'missing message' });
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
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
});
