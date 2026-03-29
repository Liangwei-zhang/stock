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

import 'dotenv/config';
import express from 'express';
import path    from 'path';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { createServer as createNetServer } from 'net';

const app  = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const DIST_PATH = path.join(process.cwd(), 'dist');
const ROOT_INDEX_PATH = path.join(process.cwd(), 'index.html');
const FRONTEND_EXCLUDED_PREFIXES = ['/api', '/db', '/alerts', '/alerts-stream', '/health'];

let viteDevServer: any = null;

// ─── CORS ─────────────────────────────────────────────────────────────────────
// 前後端已整合為單一服務，CORS 僅需支援本機開發的各種慣用 port
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
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
// 本機迴環位址（127.0.0.1 / ::1）直接放行，僅對外部 IP 計數
const _rlMap = new Map<string, { count: number; reset: number }>();
app.use((req, res, next) => {
  const clientIp = (req.socket.remoteAddress ?? '').replace('::ffff:', '');
  if (clientIp === '127.0.0.1' || clientIp === '::1') { next(); return; }

  const key  = clientIp;
  const now  = Date.now();
  const slot = _rlMap.get(key);
  if (!slot || now > slot.reset) {
    _rlMap.set(key, { count: 1, reset: now + 60_000 });
    next();
  } else if (slot.count < 300) {
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

// ─── 整合啟動（DB + Vite middleware + HTTP 監聽）────────────────────────────

async function setupFrontend() {
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const hmrPort = await findFreePort(24678); // HMR WebSocket 用獨立 port
      viteDevServer = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: { port: hmrPort },
        },
        appType: 'custom',
      });
      app.use(viteDevServer.middlewares);
      console.log('⚡  Vite dev middleware 已掛載（支援 HMR 熱更新）');
    } catch (e: any) {
      console.warn('⚠️  Vite middleware 掛載失敗，僅提供 API 服務:', e.message);
    }
  } else {
    // 生產模式：serve dist/ 靜態資源
    if (existsSync(DIST_PATH)) {
      app.use(express.static(DIST_PATH, { index: false }));
      console.log('📦 生產模式：服務 dist/ 靜態資源');
    } else {
      console.warn('⚠️  dist/ 不存在，請先執行 npm run build');
    }
  }
}

async function start() {
  // 初始化資料庫
  await initDB();

  // 從 SQLite 恢復持久化預警（伺服器重啟後不丟失）
  if (db) {
    try {
      const rows = db.prepare(
        `SELECT data FROM alerts ORDER BY created_at DESC LIMIT ${MAX_ALERTS}`
      ).all() as { data: string }[];
      alerts = rows.map(r => JSON.parse(r.data)).reverse();
      console.log(`📋 已從資料庫恢復 ${alerts.length} 條預警`);
    } catch (err: any) {
      console.warn('⚠️  恢復預警失敗:', err?.message);
    }
  }

  // 掛載前端（Vite dev 或 static dist）
  await setupFrontend();

  // 自動尋找空閒 port（從 PORT 開始往上找）
  const actualPort = await findFreePort(PORT);
  if (actualPort !== PORT) {
    console.log(`⚠️  Port ${PORT} 已被佔用，改用 ${actualPort}`);
  }

  app.listen(actualPort, () => {
    const isDev = process.env.NODE_ENV !== 'production';
    console.log(`\n🚀 服務已啟動 → http://localhost:${actualPort}`);
    console.log(`  模式：${isDev ? '開發（前後端合一，HMR 已啟用）' : '生產（serve dist/）'}`);
    console.log(`  Alerts SSE  → GET  /alerts-stream`);
    console.log(`  OHLCV write → POST /db/ohlcv`);
    console.log(`  OHLCV read  → GET  /db/ohlcv/:symbol`);
    console.log(`  Yahoo proxy → GET  /api/yahoo/:symbol`);
    console.log(`  Telegram    → POST /api/telegram`);
    console.log(`  Health      → GET  /health\n`);

    if (!process.env.API_KEY) {
      console.warn('⚠️  [安全警告] API_KEY 未設定 — 寫入端點僅允許本機迴環訪問');
    }
    const tgTargets = getTelegramTargets();
    if (tgTargets.length === 0) {
      console.warn('⚠️  Telegram 未設定 — 請在 .env 配置 TELEGRAM_TARGETS 或 TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID');
    } else {
      console.log(`📱 Telegram 已設定 ${tgTargets.length} 個推播目標：${tgTargets.map(t => t.name ?? t.chatId).join('、')}`);
    }
  });
}

/** 從 startPort 開始尋找第一個可用的 port */
function findFreePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.listen(startPort, () => {
      server.close(() => resolve(startPort));
    });
    server.on('error', () => resolve(findFreePort(startPort + 1)));
  });
}

start().catch(console.error);

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

app.get(/^\/api\/binance\/(.+)$/, async (req, res) => {
  const upstreamPath = String(req.params[0] ?? '');
  const query        = new URLSearchParams(req.query as Record<string, string>).toString();
  const url          = `https://api.binance.com/${upstreamPath}${query ? `?${query}` : ''}`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: `Binance returned ${response.status}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ─── Telegram 通知代理（支援多目標）────────────────────────────────────────
// 支援兩種設定方式（向下相容）：
//   方式一（多目標）：TELEGRAM_TARGETS='[{"botToken":"xxx","chatId":"yyy","name":"主帳號"},{...}]'
//   方式二（單目標）：TELEGRAM_BOT_TOKEN=xxx  +  TELEGRAM_CHAT_ID=yyy

interface TelegramTarget {
  botToken: string;
  chatId:   string;
  name?:    string;
}

function getTelegramTargets(): TelegramTarget[] {
  // 優先讀取多目標設定
  const raw = process.env.TELEGRAM_TARGETS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter(
          (t): t is TelegramTarget =>
            typeof t?.botToken === 'string' && t.botToken.length > 0 &&
            typeof t?.chatId   === 'string' && t.chatId.length   > 0,
        );
      }
    } catch {
      console.error('❌ TELEGRAM_TARGETS JSON 解析失敗，請確認格式正確');
    }
  }
  // 向下相容：回退到單目標設定
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.TELEGRAM_CHAT_ID;
  if (botToken && chatId) return [{ botToken, chatId, name: 'default' }];
  return [];
}

async function sendToOneTelegramTarget(
  target: TelegramTarget,
  message: string,
): Promise<{ name: string; ok: boolean; reason?: string }> {
  const label = target.name ?? target.chatId;
  try {
    const url = `https://api.telegram.org/bot${target.botToken}/sendMessage`;
    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: target.chatId, text: message, parse_mode: 'Markdown' }),
    });
    if (!response.ok) {
      const body = await response.text();
      return { name: label, ok: false, reason: body };
    }
    return { name: label, ok: true };
  } catch (err: any) {
    return { name: label, ok: false, reason: err.message };
  }
}

app.post('/api/telegram', requireApiKey, async (req, res) => {
  const targets = getTelegramTargets();
  if (targets.length === 0) {
    res.json({ success: false, reason: 'not_configured' });
    return;
  }

  const { message } = req.body ?? {};
  if (!message || typeof message !== 'string') {
    res.status(400).json({ success: false, reason: 'missing message' });
    return;
  }
  const safeMessage = message.slice(0, 4096);

  // 並行發送給所有目標，任一失敗不影響其他
  const results = await Promise.all(
    targets.map(t => sendToOneTelegramTarget(t, safeMessage)),
  );

  const allOk   = results.every(r => r.ok);
  const anyOk   = results.some(r => r.ok);
  res.status(allOk ? 200 : anyOk ? 207 : 502).json({
    success: anyOk,
    results,
  });
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

// 使用 app.use（非 app.get）以攔截所有 HTTP 方法，
// 確保 POST/PUT/DELETE 打到不存在的 API 路由時也回傳 JSON，而非 SPA HTML。
app.use('*', async (req, res) => {
  // 後端路徑（/api /db /alerts 等）一律回 JSON 404
  if (FRONTEND_EXCLUDED_PREFIXES.some(prefix => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // 非 GET/HEAD 請求不應打到前端 SPA 路由
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  if (viteDevServer) {
    try {
      const template = readFileSync(ROOT_INDEX_PATH, 'utf-8');
      const html = await viteDevServer.transformIndexHtml(req.originalUrl, template);
      res.status(200).setHeader('Content-Type', 'text/html');
      res.end(html);
      return;
    } catch (err: any) {
      viteDevServer?.ssrFixStacktrace?.(err);
      res.status(500).end(err?.message ?? 'Failed to render app');
      return;
    }
  }

  if (existsSync(path.join(DIST_PATH, 'index.html'))) {
    res.sendFile(path.join(DIST_PATH, 'index.html'));
    return;
  }

  res.status(404).json({ error: 'Frontend not built' });
});


