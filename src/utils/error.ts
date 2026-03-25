/**
 * error.ts — 統一錯誤處理工具
 *
 * 提供 Result<T> 型別、AppError 類別，以及安全執行異步/同步操作的輔助函數。
 * Service 層應使用 trySafe/trySafeSync 包裝關鍵操作，避免靜默吞錯。
 */

/** 應用級錯誤，攜帶錯誤碼、上下文和可恢復性標記 */
export class AppError extends Error {
  constructor(
    message: string,
    /** 錯誤碼，建議格式：SERVICE_OPERATION (e.g. STORAGE_SAVE) */
    public readonly code: string,
    /** 額外的上下文信息，用於調試 */
    public readonly context?: Record<string, unknown>,
    /** 是否可恢復（true = 業務邏輯可降級處理） */
    public readonly recoverable: boolean = true,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** 操作結果型別：成功時包含 data，失敗時包含 AppError */
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

/** 構造成功結果 */
export function Ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** 構造失敗結果 */
export function Err<T>(error: AppError): Result<T> {
  return { ok: false, error };
}

/**
 * 安全執行異步操作，失敗時返回 Err 而非拋出異常。
 * @param fn 要執行的異步函數
 * @param code 錯誤碼（失敗時用於構造 AppError）
 * @param context 額外的上下文信息（可選）
 */
export async function trySafe<T>(
  fn: () => Promise<T>,
  code: string,
  context?: Record<string, unknown>,
): Promise<Result<T>> {
  try {
    return Ok(await fn());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${code}]`, msg, context);
    return Err(new AppError(msg, code, context));
  }
}

/**
 * 安全執行同步操作，失敗時返回 Err 而非拋出異常。
 * @param fn 要執行的同步函數
 * @param code 錯誤碼（失敗時用於構造 AppError）
 * @param context 額外的上下文信息（可選）
 */
export function trySafeSync<T>(
  fn: () => T,
  code: string,
  context?: Record<string, unknown>,
): Result<T> {
  try {
    return Ok(fn());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${code}]`, msg, context);
    return Err(new AppError(msg, code, context));
  }
}
