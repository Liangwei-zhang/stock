/**
 * storage.ts — 安全的 localStorage 包裝工具
 *
 * 防禦以下不穩定場景：
 *  - 隱私模式下 setItem 拋 QuotaExceededError
 *  - 用戶手動篡改 JSON 導致 JSON.parse 失敗
 *  - SSR / Worker 環境下 localStorage 不存在
 */

/**
 * 安全讀取 localStorage 中的 JSON 值。
 * 若 key 不存在、JSON 解析失敗或 localStorage 不可用，返回 fallback。
 * @param key localStorage 鍵名
 * @param fallback 讀取失敗時的默認值
 */
export function safeGetItem<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`[storage] Failed to read "${key}", using fallback`);
    return fallback;
  }
}

/**
 * 安全寫入 JSON 值到 localStorage。
 * 若 localStorage 不可用或配額不足，靜默失敗並返回 false。
 * @param key localStorage 鍵名
 * @param value 要序列化並存儲的值
 * @returns 寫入成功返回 true，失敗返回 false
 */
export function safeSetItem(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`[storage] Failed to write "${key}":`, e);
    return false;
  }
}

/**
 * 安全刪除 localStorage 中的鍵。
 * 若 localStorage 不可用，靜默失敗並返回 false。
 * @param key localStorage 鍵名
 * @returns 刪除成功返回 true，失敗返回 false
 */
export function safeRemoveItem(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
