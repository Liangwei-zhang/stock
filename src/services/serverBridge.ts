/**
 * serverBridge.ts — 前端 → 后端单向推送桥
 *
 * 设计原则：
 *  - 前端是数据源，后端是广播中继。
 *  - alertService 每次 createAlert() 后调用 pushAlertToServer()，
 *    后端收到后立刻通过 SSE 广播给所有已连接的外部监听端（如移动端、监控面板）。
 *  - 推送是 fire-and-forget：失败不会影响前端正常运行。
 */

const SERVER_URL = 'http://localhost:3001';

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

/** 从后端拉取当前预警列表（可选，用于初始化时同步外部数据） */
export async function getAlertsFromServer(): Promise<unknown[]> {
  try {
    const res = await fetch(`${SERVER_URL}/alerts`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * 通过服务端中继发送 Telegram 消息（fire-and-forget，失败静默）
 *
 * 由服务端读取 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 环境变量并发送，
 * 避免直接从浏览器调用 api.telegram.org（CORS 封锁 + Token 暴露风险）。
 */
export function sendTelegramViaServer(message: string): void {
  fetch(`${SERVER_URL}/api/telegram`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message }),
  }).catch(() => {
    // Server not running — silently ignore.
  });
}
