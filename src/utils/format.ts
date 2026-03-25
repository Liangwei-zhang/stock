/**
 * 根據價格大小自動選擇小數位數
 * >= 100:   2位 (如 $150.25)
 * >= 0.1:   4位 (如 $0.1500)
 * >= 0.001: 6位 (如 $0.001500)
 * < 0.001:  8位 (如 $0.00001500)
 */
export function fmtPrice(p: number): string {
  if (p >= 100) return p.toFixed(2);
  if (p >= 0.1) return p.toFixed(4);
  if (p >= 0.001) return p.toFixed(6);
  return p.toFixed(8);
}
