/**
 * poi-state.ts — POI 狀態機 (Point of Interest State Machine)
 * 
 * 核心邏輯：追蹤支撐/阻力位的狀態
 * - Fresh: 尚未被觸碰過的 POI
 * - Mitigated: 已被價格穿過，消耗完畢
 * - Testing: 價格正在測試該區域
 * 
 * 狀態轉換：
 *   Fresh ──(價格觸及)──> Testing ──(價格穿越)──> Mitigated
 *   Fresh ──(距離過遠)──> Stale (可忽略)
 */

import { StockData } from '../types';
import { StoredPOI, savePOIs, loadPOIs } from '../services/storageService';

export type POIState = 'fresh' | 'testing' | 'mitigated' | 'stale';

export interface POI {
  id: string;
  symbol?: string;          // 所屬股票（用於持久化）
  type: 'support' | 'resistance';
  level: number;           // 價格水平
  state: POIState;         // 當前狀態
  createdAt: number;       // 創建時間（timestamp）
  testedAt: number | null; // 最後一次測試時間
  mitigatedAt: number | null; // 被穿透時間
  touches: number;         // 被測試次數
  strength: number;        // 原始強度（1-10）
  reason: string;          // 創建原因
}

/**
 * POI 狀態管理器（支持 IndexedDB 持久化）
 */
export class POIManager {
  private pois: Map<string, POI> = new Map();
  private maxPOIs: number = 50;  // 最多保留多少 POI
  private stalenessDistance: number = 0.03; // 超過 3% 視為 stale
  private currentSymbol: string = '';
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 初始化：從 IndexedDB 載入 POI
   */
  async init(symbol: string): Promise<void> {
    this.currentSymbol = symbol;
    const stored = await loadPOIs(symbol);
    
    for (const s of stored) {
      this.pois.set(s.id, {
        ...s,
        symbol,
      });
    }
    // [POI] 載入 ${this.pois.size} 個 POI for ${symbol}`);
  }

  /**
   * 設定當前股票標的
   */
  setSymbol(symbol: string): void {
    if (this.currentSymbol !== symbol) {
      this.currentSymbol = symbol;
      this.pois.clear(); // 切換標的時清空（實際應該分別載入）
    }
  }

  /**
   * 添加新的 POI
   */
  addPOI(
    type: 'support' | 'resistance',
    level: number,
    strength: number,
    reason: string
  ): POI {
    const id = `poi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const poi: POI = {
      id,
      symbol: this.currentSymbol,
      type,
      level,
      state: 'fresh',
      createdAt: Date.now(),
      testedAt: null,
      mitigatedAt: null,
      touches: 0,
      strength,
      reason,
    };

    this.pois.set(id, poi);
    this.cleanup();
    this.debouncedSave();
    
    return poi;
  }

  /**
   * 更新 POI 狀態
   * @param currentPrice 當前價格
   */
  updateStates(currentPrice: number): void {
    const now = Date.now();

    for (const poi of this.pois.values()) {
      if (poi.state === 'mitigated') continue;

      // 計算距離
      const distance = Math.abs(currentPrice - poi.level) / currentPrice;

      // 價格觸及 POI（距離小於 0.5%）
      if (distance < 0.005) {
        if (poi.state === 'fresh') {
          poi.state = 'testing';
          poi.testedAt = now;
        }
        poi.touches++;
      }
      // 價格穿越 POI
      else if (poi.state === 'testing') {
        if ((poi.type === 'support' && currentPrice < poi.level) ||
            (poi.type === 'resistance' && currentPrice > poi.level)) {
          // 向不利方向穿越 → Mitigated
          poi.state = 'mitigated';
          poi.mitigatedAt = now;
        }
      }
      // 價格距離過遠 → Stale
      else if (poi.state === 'fresh' && distance > this.stalenessDistance) {
        poi.state = 'stale';
      }
    }
  }

  /**
   * 獲取有效的 POI（Fresh + Testing）
   */
  getActivePOIs(): POI[] {
    return Array.from(this.pois.values())
      .filter(p => p.state === 'fresh' || p.state === 'testing')
      .sort((a, b) => b.strength - a.strength);
  }

  /**
   * 獲取最近的支撐/阻力
   */
  getNearestPOI(type: 'support' | 'resistance', currentPrice: number): POI | null {
    const active = this.getActivePOIs().filter(p => p.type === type);
    
    if (active.length === 0) return null;

    let nearest: POI | null = null;
    let minDist = Infinity;

    for (const poi of active) {
      const dist = Math.abs(currentPrice - poi.level) / currentPrice;
      if (dist < minDist) {
        minDist = dist;
        nearest = poi;
      }
    }

    return nearest;
  }

  /**
   * 檢查是否有臨近的 POI（用於評分加成）
   */
  checkProximity(currentPrice: number, threshold: number = 0.02): {
    hasSupport: boolean;
    hasResistance: boolean;
    supportStrength: number;
    resistanceStrength: number;
  } {
    const support = this.getNearestPOI('support', currentPrice);
    const resistance = this.getNearestPOI('resistance', currentPrice);

    const hasSupport = support !== null && 
      Math.abs(currentPrice - support.level) / currentPrice < threshold;
    const hasResistance = resistance !== null && 
      Math.abs(currentPrice - resistance.level) / currentPrice < threshold;

    return {
      hasSupport,
      hasResistance,
      supportStrength: support?.strength ?? 0,
      resistanceStrength: resistance?.strength ?? 0,
    };
  }

  /**
   * 清理過期/過多的 POI
   */
  private cleanup(): void {
    // 移除 stale 或過舊的
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 天

    for (const [id, poi] of this.pois.entries()) {
      if (poi.state === 'stale' || 
          (poi.state === 'mitigated' && now - (poi.mitigatedAt ?? 0) > maxAge)) {
        this.pois.delete(id);
      }
    }

    // 如果還是太多，移除最舊的
    if (this.pois.size > this.maxPOIs) {
      const sorted = Array.from(this.pois.values())
        .sort((a, b) => a.createdAt - b.createdAt);
      
      const toRemove = sorted.slice(0, this.pois.size - this.maxPOIs);
      for (const poi of toRemove) {
        this.pois.delete(poi.id);
      }
    }
  }

  /**
   * 從歷史數據初始化 POI
   */
  initFromHistory(data: StockData[]): void {
    if (data.length < 20) return;

    // 掃描歷史高低點作為 POI
    for (let i = 10; i < data.length - 5; i++) {
      const isHigh = data[i].high > data[i-1].high && 
                     data[i].high > data[i-2].high &&
                     data[i].high > data[i+1].high &&
                     data[i].high > data[i+2].high;
      
      const isLow = data[i].low < data[i-1].low && 
                    data[i].low < data[i-2].low &&
                    data[i].low < data[i+1].low &&
                    data[i].low < data[i+2].low;

      if (isHigh) {
        this.addPOI('resistance', data[i].high, 8, `歷史高點 $${data[i].high.toFixed(2)}`);
      }
      if (isLow) {
        this.addPOI('support', data[i].low, 8, `歷史低點 $${data[i].low.toFixed(2)}`);
      }
    }
  }

  /**
   * 獲取所有 POI（調試用）
   */
  getAllPOIs(): POI[] {
    return Array.from(this.pois.values());
  }

  /**
   * 清空 POI
   */
  clear(): void {
    this.pois.clear();
    this.debouncedSave();
  }

  /**
   * 延遲保存（Debounced）- 避免頻繁寫入
   */
  private debouncedSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveToDB();
    }, 2000); // 2 秒延遲
  }

  /**
   * 保存到 IndexedDB
   */
  private async saveToDB(): Promise<void> {
    if (!this.currentSymbol || this.pois.size === 0) return;
    
    const poisToSave: StoredPOI[] = Array.from(this.pois.values()).map(p => ({
      id: p.id,
      symbol: p.symbol || this.currentSymbol,
      type: p.type,
      level: p.level,
      state: p.state,
      createdAt: p.createdAt,
      testedAt: p.testedAt,
      mitigatedAt: p.mitigatedAt,
      touches: p.touches,
      strength: p.strength,
      reason: p.reason,
    }));

    await savePOIs(this.currentSymbol, poisToSave);
    // [POI] 已保存 ${poisToSave.length} 個 POI for ${this.currentSymbol}`);
  }
}

// 單例實例
export const poiManager = new POIManager();
