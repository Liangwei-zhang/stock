/**
 * constants.ts — 共享常量
 */

export const SOURCE_CONFIG = {
  real:      { label: '实时', dot: '🟢' },
  database:  { label: '缓存', dot: '🟡' },
  simulated: { label: '模拟', dot: '⚪' },
} as const;
