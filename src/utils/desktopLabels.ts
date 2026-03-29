import type { AssetType } from '../types';

export const DESKTOP_ASSET_TYPE_LABELS: Record<AssetType, string> = {
  equity: '股票',
  etf: 'ETF',
  futures: '期貨',
  index: '指數',
  crypto: '加密貨幣',
  other: '其他',
};

export function getDesktopAssetTypeLabel(assetType: AssetType): string {
  return DESKTOP_ASSET_TYPE_LABELS[assetType] ?? DESKTOP_ASSET_TYPE_LABELS.other;
}