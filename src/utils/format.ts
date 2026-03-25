/**
 * format.ts — 共享格式化工具函數
 */

/**
 * 根據價格大小自動選擇合適的小數位數
 * - >= $100: 2位小數 (BTC, ETH, 股票等)
 * - >= $1:   4位小數 (中低價資產)
 * - >= $0.1: 4位小數 (如 DOGE)
 * - >= $0.001: 6位小數 (次分錢代幣)
 * - < $0.001: 8位小數 (微型代幣如 SHIB)
 */
export const fmtPrice = (p: number): string =>
  p >= 100   ? p.toFixed(2)
  : p >= 1   ? p.toFixed(4)
  : p >= 0.1 ? p.toFixed(4)
  : p >= 0.001 ? p.toFixed(6)
  : p.toFixed(8);
