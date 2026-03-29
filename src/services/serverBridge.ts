/**
 * serverBridge.ts — 前端 → 后端单向推送桥
 *
 * 设计原则：
 *  - 前端是数据源，后端是广播中继。
 *  - alertService 每次 createAlert() 后调用 pushAlertToServer()，
 *    后端收到后立刻通过 SSE 广播给所有已连接的外部监听端（如移动端、监控面板）。
 *  - 推送是 fire-and-forget：失败不会影响前端正常运行。
 */

import { readJsonIfAvailable } from '../utils/http';

// 前後端已整合為單一服務，使用相對路徑，自動適配任何端口
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';

/** 从环境变量读取 API Key（VITE_API_KEY），用于需要鉴权的写入接口 */
const API_KEY = import.meta.env.VITE_API_KEY ?? '';

function writeHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) h['X-API-Key'] = API_KEY;
  return h;
}

/** 将新预警推送给后端（非阻塞，失败静默） */
export function pushAlertToServer(alert: unknown): void {
  fetch(`${SERVER_URL}/alerts`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(alert),
  }).catch(() => {
    // Server not running — silently ignore.
    // The frontend operates fully standalone without the server.
  });
}

/** 從服務端發送 Telegram 通知（非阻塞，失敗靜默） */
export function sendTelegramViaServer(message: string): void {
  fetch(`${SERVER_URL}/api/telegram`, {
    method:  'POST',
    headers: writeHeaders(),
    body:    JSON.stringify({ message }),
  }).catch(() => {
    // Server not running or Telegram not configured — silently ignore.
  });
}

export { SERVER_URL, writeHeaders };

/** 从后端拉取当前预警列表（可选，用于初始化时同步外部数据） */
export async function getAlertsFromServer(): Promise<unknown[]> {
  try {
    const res = await fetch(`${SERVER_URL}/alerts`);
    if (!res.ok) return [];
    return await readJsonIfAvailable<unknown[]>(res) ?? [];
  } catch {
    return [];
  }
}
