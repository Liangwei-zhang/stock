/**
 * core/plugin-registry.ts — 算法插件注册表
 *
 * 功能：
 *  - 注册/注销插件
 *  - 运行时热切换激活插件（无需重启）
 *  - 插件配置持久化（localStorage）
 *  - 统一分析入口：registry.analyze(data, symbol)
 */

import type { IStrategyPlugin, StrategyResult, PluginRegistrySnapshot } from './types';
import type { StockData } from '../types';

const STORAGE_KEY_ACTIVE  = 'plugin:active';
const STORAGE_KEY_CONFIGS = 'plugin:configs';

class PluginRegistry {
  private plugins  = new Map<string, IStrategyPlugin>();
  private activeId = '';
  private onChange: (() => void) | null = null;

  /** 启动时从 localStorage 恢复上次选择的插件 */
  bootstrap(): void {
    const saved = localStorage.getItem(STORAGE_KEY_ACTIVE);
    if (saved && this.plugins.has(saved)) {
      this.activeId = saved;
    } else if (this.plugins.size > 0) {
      this.activeId = [...this.plugins.keys()][0];
    }

    // 恢复各插件配置
    try {
      const cfgs = JSON.parse(localStorage.getItem(STORAGE_KEY_CONFIGS) ?? '{}');
      for (const [id, cfg] of Object.entries(cfgs)) {
        this.plugins.get(id)?.setConfig?.(cfg as Record<string, unknown>);
      }
    } catch { /* ignore */ }
  }

  /** 注册一个插件。同 id 重复注册 → 覆盖 */
  register(plugin: IStrategyPlugin): void {
    this.plugins.set(plugin.id, plugin);
    if (!this.activeId) this.activeId = plugin.id;
  }

  /** 注销插件。如果是激活插件，自动切换到第一个可用插件 */
  unregister(id: string): void {
    this.plugins.delete(id);
    if (this.activeId === id) {
      this.activeId = [...this.plugins.keys()][0] ?? '';
    }
    this.notifyChange();
  }

  /**
   * 热切换激活插件。
   * 如果插件有 init() 方法，会对当前 symbol 执行初始化。
   */
  async setActive(id: string, currentSymbol?: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Plugin "${id}" not registered`);

    this.activeId = id;
    localStorage.setItem(STORAGE_KEY_ACTIVE, id);

    if (plugin.init && currentSymbol) {
      await plugin.init(currentSymbol);
    }

    this.notifyChange();
  }

  getActive(): IStrategyPlugin | null {
    return this.plugins.get(this.activeId) ?? null;
  }

  getActiveId(): string {
    return this.activeId;
  }

  getPlugin(id: string): IStrategyPlugin | undefined {
    return this.plugins.get(id);
  }

  list(): IStrategyPlugin[] {
    return [...this.plugins.values()];
  }

  snapshot(): PluginRegistrySnapshot {
    return {
      active:  this.activeId,
      plugins: this.list().map(p => ({
        id:          p.id,
        name:        p.name,
        version:     p.version,
        description: p.description,
      })),
    };
  }

  /**
   * 核心分析入口 —— 委托给当前激活插件。
   * 调用者不需要知道具体用的是哪个插件。
   */
  analyze(data: StockData[], symbol: string): StrategyResult | null {
    const plugin = this.getActive();
    if (!plugin || data.length < 10) return null;
    try {
      return plugin.analyze(data, symbol);
    } catch (err) {
      console.error(`[PluginRegistry] ${plugin.id} analysis error:`, err);
      return null;
    }
  }

  /** 保存某个插件的配置 */
  savePluginConfig(id: string, config: Record<string, unknown>): void {
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY_CONFIGS) ?? '{}');
      all[id] = config;
      localStorage.setItem(STORAGE_KEY_CONFIGS, JSON.stringify(all));
      this.plugins.get(id)?.setConfig?.(config);
    } catch { /* ignore */ }
  }

  setOnChange(cb: () => void): void { this.onChange = cb; }
  private notifyChange(): void { this.onChange?.(); }
}

export const pluginRegistry = new PluginRegistry();
