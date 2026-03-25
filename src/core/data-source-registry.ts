/**
 * core/data-source-registry.ts — 数据源适配器注册表
 *
 * 策略：
 *  - 按 AssetType 自动选取优先级最高的可用适配器
 *  - 支持手动覆盖（某类资产固定用某个源）
 *  - 适配器可用性缓存 30s（避免每次请求都探测）
 *  - 失败自动降级到下一个适配器
 */

import type { IDataSourceAdapter, DataSourceConfig, QuoteData } from './types';
import type { AssetType, StockData } from '../types';

const STORAGE_KEY    = 'datasource:config';
const AVAIL_TTL_MS   = 30_000;   // 30s 健康检查缓存
const PROBE_TIMEOUT  = 5_000;    // 单个适配器探活超时（防阻塞）

class DataSourceRegistry {
  private adapters = new Map<string, IDataSourceAdapter>();

  /** 可用性缓存: id → { available, expiresAt } */
  private availCache = new Map<string, { ok: boolean; expiresAt: number }>();

  private config: DataSourceConfig = { overrides: {}, disabled: [] };

  constructor() {
    this.loadConfig();
  }

  // ── 注册 / 注销 ────────────────────────────────────────────────────────────

  register(adapter: IDataSourceAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  unregister(id: string): void {
    this.adapters.delete(id);
    this.availCache.delete(id);
  }

  // ── 配置 ───────────────────────────────────────────────────────────────────

  getConfig(): DataSourceConfig {
    return { ...this.config, overrides: { ...this.config.overrides }, disabled: [...this.config.disabled] };
  }

  updateConfig(patch: Partial<DataSourceConfig>): void {
    this.config = { ...this.config, ...patch };
    this.saveConfig();
    this.availCache.clear();   // 配置变更后强制重新探测
  }

  setOverride(assetType: AssetType, adapterId: string | null): void {
    if (adapterId === null) {
      delete this.config.overrides[assetType];
    } else {
      this.config.overrides[assetType] = adapterId;
    }
    this.saveConfig();
  }

  setDisabled(adapterId: string, disabled: boolean): void {
    const set = new Set(this.config.disabled);
    disabled ? set.add(adapterId) : set.delete(adapterId);
    this.config.disabled = [...set];
    this.saveConfig();
    this.availCache.delete(adapterId);
  }

  // ── 选择适配器 ─────────────────────────────────────────────────────────────

  /**
   * 为给定 assetType 选出当前最优可用适配器列表（已排序，首选优先）。
   * 结果是一个有序列表，调用方按顺序尝试，直到成功为止（降级策略）。
   */
  async getAdapterChain(assetType: AssetType): Promise<IDataSourceAdapter[]> {
    // 手动覆盖：直接用指定适配器（仍然做可用性检查）
    const overrideId = this.config.overrides[assetType];
    if (overrideId) {
      const adapter = this.adapters.get(overrideId);
      if (adapter && !this.config.disabled.includes(overrideId)) {
        return [adapter];
      }
    }

    // 所有支持该 assetType 的适配器，按 priority 排序
    const candidates = [...this.adapters.values()]
      .filter(a => !this.config.disabled.includes(a.id))
      .filter(a => a.supportedAssetTypes.includes(assetType) || a.supportedAssetTypes.includes('other'))
      .sort((a, b) => a.priority - b.priority);

    // 并行探测可用性（缓存命中则跳过网络请求）
    const available: IDataSourceAdapter[] = [];
    await Promise.all(candidates.map(async (adapter) => {
      const ok = await this.checkAvailability(adapter);
      if (ok) available.push(adapter);
    }));

    // 重新按 priority 排序（Promise.all 顺序不保证）
    return available.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 便捷方法：自动降级，拉取历史数据。
   * 遍历适配器链，直到有一个成功返回数据。
   */
  async fetchHistory(symbol: string, assetType: AssetType): Promise<StockData[]> {
    const chain = await this.getAdapterChain(assetType);
    const errors: string[] = [];

    for (const adapter of chain) {
      try {
        const data = await adapter.fetchHistory(symbol);
        if (data.length > 0) return data;
      } catch (err) {
        errors.push(`${adapter.id}: ${err}`);
        this.invalidateAvailability(adapter.id);
      }
    }

    if (errors.length > 0) {
      console.warn(`[DataSourceRegistry] fetchHistory(${symbol}) all failed:`, errors);
    }
    return [];
  }

  /**
   * 便捷方法：自动降级，拉取最新报价。
   */
  async fetchQuote(symbol: string, assetType: AssetType): Promise<QuoteData | null> {
    const chain = await this.getAdapterChain(assetType);

    for (const adapter of chain) {
      try {
        const quote = await adapter.fetchQuote(symbol);
        if (quote) return quote;
      } catch (err) {
        console.warn(`[DataSourceRegistry] fetchQuote(${symbol}) ${adapter.id} failed:`, err);
        this.invalidateAvailability(adapter.id);
      }
    }
    return null;
  }

  /** 列出所有已注册适配器的状态摘要 */
  listAdapters(): { id: string; name: string; priority: number; disabled: boolean; assetTypes: AssetType[] }[] {
    return [...this.adapters.values()].map(a => ({
      id:         a.id,
      name:       a.name,
      priority:   a.priority,
      disabled:   this.config.disabled.includes(a.id),
      assetTypes: a.supportedAssetTypes,
    }));
  }

  // ── 内部 ───────────────────────────────────────────────────────────────────

  private async checkAvailability(adapter: IDataSourceAdapter): Promise<boolean> {
    const cached = this.availCache.get(adapter.id);
    if (cached && Date.now() < cached.expiresAt) return cached.ok;

    try {
      // 加超时，防止慢适配器拖慢整条链
      const timeoutP = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT),
      );
      const ok = await Promise.race([adapter.isAvailable(), timeoutP]);
      this.availCache.set(adapter.id, { ok, expiresAt: Date.now() + AVAIL_TTL_MS });
      return ok;
    } catch {
      this.availCache.set(adapter.id, { ok: false, expiresAt: Date.now() + AVAIL_TTL_MS });
      return false;
    }
  }

  private invalidateAvailability(id: string): void {
    this.availCache.delete(id);
  }

  private loadConfig(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.config = JSON.parse(raw);
    } catch { /* ignore */ }
  }

  private saveConfig(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch { /* ignore */ }
  }
}

export const dataSourceRegistry = new DataSourceRegistry();
