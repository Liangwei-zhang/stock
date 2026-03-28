/**
 * server/core/monitoring.ts — Layer 6 監控觀測層
 *
 * 對應 SmartClean: app/core/monitoring.py
 * 修復 Bug #10：_data 改為實例變量（非類變量），避免跨實例共享
 *
 * 功能：
 *   - Metrics：各端點請求數、錯誤數、p95 延遲
 *   - logger：結構化 JSON 日誌，同時輸出 console + logs/app.log
 *   - requestLogger：Express 中間件，自動記錄每個請求
 *   - logEvent：業務事件日誌
 */

import fs from 'fs';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';

// ─── 日誌目錄 ──────────────────────────────────────────────────────────────
const LOG_DIR = 'logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const logStream = fs.createWriteStream(path.join(LOG_DIR, 'app.log'), { flags: 'a' });

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function write(level: LogLevel, message: string, data?: unknown): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(data !== undefined ? { data } : {}),
  });
  logStream.write(line + '\n');
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level === 'debug') {
    if (process.env.NODE_ENV !== 'production') console.debug(line);
  } else console.log(line);
}

/** 結構化 JSON 日誌（對應 SmartClean logger = logging.getLogger(...)） */
export const logger = {
  info:  (message: string, data?: unknown) => write('info',  message, data),
  warn:  (message: string, data?: unknown) => write('warn',  message, data),
  error: (message: string, data?: unknown) => write('error', message, data),
  debug: (message: string, data?: unknown) => write('debug', message, data),
};

// ─── Metrics 收集器 ────────────────────────────────────────────────────────

interface EndpointStat {
  requests:  number;
  errors:    number;
  durations: number[]; // ms
}

/** 內存指標收集器（單進程）
 *  Fix Bug #10：使用 Map 實例變量，非類靜態變量
 */
class Metrics {
  private readonly data = new Map<string, EndpointStat>();
  private readonly start = Date.now();

  recordRequest(endpoint: string, durationMs: number, status: number): void {
    let stat = this.data.get(endpoint);
    if (!stat) {
      stat = { requests: 0, errors: 0, durations: [] };
      this.data.set(endpoint, stat);
    }
    stat.requests++;
    if (status >= 400) stat.errors++;
    stat.durations.push(durationMs);
    // 只保留最近 1000 條，防止無限增長
    if (stat.durations.length > 1000) stat.durations.splice(0, stat.durations.length - 1000);
  }

  getStats(): {
    uptime_seconds: number;
    endpoints: Record<string, unknown>;
    timestamp: string;
  } {
    const endpoints: Record<string, unknown> = {};
    for (const [ep, stat] of this.data) {
      const sorted = [...stat.durations].sort((a, b) => a - b);
      const avg = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
      const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
      endpoints[ep] = {
        requests:         stat.requests,
        errors:           stat.errors,
        error_rate:       stat.requests > 0 ? +((stat.errors / stat.requests) * 100).toFixed(2) : 0,
        avg_duration_ms:  +avg.toFixed(2),
        p95_duration_ms:  +p95.toFixed(2),
      };
    }
    return {
      uptime_seconds: Math.floor((Date.now() - this.start) / 1000),
      endpoints,
      timestamp: new Date().toISOString(),
    };
  }

  /** Prometheus 文本格式（對應 SmartClean /api/monitoring/metrics） */
  prometheusFormat(appName = 'stock_signal'): string {
    const name  = appName.toLowerCase().replace(/\s+/g, '_');
    const stats = this.getStats();
    const lines: string[] = [
      `# HELP ${name}_http_requests_total Total HTTP requests`,
      `# TYPE ${name}_http_requests_total counter`,
    ];
    for (const [ep, d] of Object.entries(stats.endpoints as Record<string, any>)) {
      lines.push(`${name}_http_requests_total{endpoint="${ep}"} ${d.requests}`);
    }
    lines.push(
      '',
      `# HELP ${name}_uptime_seconds Process uptime`,
      `# TYPE ${name}_uptime_seconds gauge`,
      `${name}_uptime_seconds ${stats.uptime_seconds}`,
    );
    return lines.join('\n');
  }

  reset(): void {
    this.data.clear();
  }
}

/** 全局單例 */
export const metrics = new Metrics();

// ─── Express 請求日誌中間件 ────────────────────────────────────────────────

/**
 * requestLogger — 自動記錄每個 HTTP 請求
 * 掛在 express.json() 之後，路由之前
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startMs = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startMs;
    // 優先用 route.path（有 params 時更易讀），fallback 到 req.path
    const endpoint = `${req.method} ${req.route?.path ?? req.path}`;
    metrics.recordRequest(endpoint, durationMs, res.statusCode);

    if (res.statusCode >= 500) {
      logger.error(`${endpoint} ${res.statusCode}`, { durationMs, ip: req.ip });
    } else if (res.statusCode >= 400) {
      logger.warn(`${endpoint} ${res.statusCode}`, { durationMs, ip: req.ip });
    } else {
      logger.info(`${endpoint} ${res.statusCode} ${durationMs}ms`);
    }
  });
  next();
}

// ─── 業務事件日誌 ──────────────────────────────────────────────────────────

/** 記錄業務事件（對應 SmartClean log_event）*/
export function logEvent(eventType: string, data?: Record<string, unknown>): void {
  logger.info(`[Event] ${eventType}`, data);
}
