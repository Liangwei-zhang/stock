/**
 * core/data-source-registry.ts — 数据源适配器注册表
 *
 * 策略：
 *  - 按 AssetType 自动选取优先级最高的可用适配器
 *  - 支持手动覆盖（某类资产固定用某个源）
 *  - 适配器可用性缓存 30s（避免每次请求都探测）
 *  - 失败自动降级到下一个适配器
 */
const STORAGE_KEY = 'datasource:config';
const AVAIL_TTL_MS = 30000; // 30s 健康检查缓存
class DataSourceRegistry {
    constructor() {
        this.adapters = new Map();
        /** 可用性缓存: id → { available, expiresAt } */
        this.availCache = new Map();
        this.config = { overrides: {}, disabled: [] };
        this.loadConfig();
    }
    // ── 注册 / 注销 ────────────────────────────────────────────────────────────
    register(adapter) {
        this.adapters.set(adapter.id, adapter);
    }
    unregister(id) {
        this.adapters.delete(id);
        this.availCache.delete(id);
    }
    // ── 配置 ───────────────────────────────────────────────────────────────────
    getConfig() {
        return { ...this.config, overrides: { ...this.config.overrides }, disabled: [...this.config.disabled] };
    }
    updateConfig(patch) {
        this.config = { ...this.config, ...patch };
        this.saveConfig();
        this.availCache.clear(); // 配置变更后强制重新探测
    }
    setOverride(assetType, adapterId) {
        if (adapterId === null) {
            delete this.config.overrides[assetType];
        }
        else {
            this.config.overrides[assetType] = adapterId;
        }
        this.saveConfig();
    }
    setDisabled(adapterId, disabled) {
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
    async getAdapterChain(assetType) {
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
        const available = [];
        await Promise.all(candidates.map(async (adapter) => {
            const ok = await this.checkAvailability(adapter);
            if (ok)
                available.push(adapter);
        }));
        // 重新按 priority 排序（Promise.all 顺序不保证）
        return available.sort((a, b) => a.priority - b.priority);
    }
    /**
     * 便捷方法：自动降级，拉取历史数据。
     * 遍历适配器链，直到有一个成功返回数据。
     */
    async fetchHistory(symbol, assetType) {
        const chain = await this.getAdapterChain(assetType);
        const errors = [];
        for (const adapter of chain) {
            try {
                const data = await adapter.fetchHistory(symbol);
                if (data.length > 0)
                    return data;
            }
            catch (err) {
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
    async fetchQuote(symbol, assetType) {
        const chain = await this.getAdapterChain(assetType);
        for (const adapter of chain) {
            try {
                const quote = await adapter.fetchQuote(symbol);
                if (quote)
                    return quote;
            }
            catch (err) {
                console.warn(`[DataSourceRegistry] fetchQuote(${symbol}) ${adapter.id} failed:`, err);
                this.invalidateAvailability(adapter.id);
            }
        }
        return null;
    }
    /** 列出所有已注册适配器的状态摘要 */
    listAdapters() {
        return [...this.adapters.values()].map(a => ({
            id: a.id,
            name: a.name,
            priority: a.priority,
            disabled: this.config.disabled.includes(a.id),
            assetTypes: a.supportedAssetTypes,
        }));
    }
    // ── 内部 ───────────────────────────────────────────────────────────────────
    async checkAvailability(adapter) {
        const cached = this.availCache.get(adapter.id);
        if (cached && Date.now() < cached.expiresAt)
            return cached.ok;
        try {
            const ok = await adapter.isAvailable();
            this.availCache.set(adapter.id, { ok, expiresAt: Date.now() + AVAIL_TTL_MS });
            return ok;
        }
        catch {
            this.availCache.set(adapter.id, { ok: false, expiresAt: Date.now() + AVAIL_TTL_MS });
            return false;
        }
    }
    invalidateAvailability(id) {
        this.availCache.delete(id);
    }
    loadConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw)
                this.config = JSON.parse(raw);
        }
        catch { /* ignore */ }
    }
    saveConfig() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
        }
        catch { /* ignore */ }
    }
}
export const dataSourceRegistry = new DataSourceRegistry();
