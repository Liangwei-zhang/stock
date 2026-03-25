# Stock Alert System (stock-fix)

股票智能預警系統 - 採用 SMC (Smart Money Concepts) 頂底預測算法

---

## 📁 項目結構

```
stock-fix/
├── src/
│   ├── main.tsx                 # React 入口
│   ├── App.tsx                  # 主應用組件
│   ├── App.css                  # 樣式
│   │
│   ├── services/                # 數據服務層
│   │   ├── stockService.ts      # 股票數據管理（多數據源）
│   │   ├── indicatorService.ts  # 技術指標計算
│   │   ├── alertService.ts     # 預警管理
│   │   ├── searchService.ts     # 股票搜索
│   │   ├── storageService.ts    # IndexedDB 持久化
│   │   ├── polygonService.ts    # Polygon.io API
│   │   └── cryptoService.ts     # Binance 加密貨幣 API
│   │
│   ├── utils/                   # 算法模組
│   │   ├── indicators.ts        # 技術指標計算（MA/EMA/RSI/MACD/KDJ/布林帶）
│   │   ├── signals.ts           # 買賣信號檢測
│   │   ├── prediction.ts         # Gen 3.0 頂底預測算法
│   │   ├── sfp.ts               # SFP（假突破流動性掠奪）
│   │   ├── choch.ts             # CHOCH（結構轉變）
│   │   ├── cvd.ts               # CVD（成交量背離）
│   │   ├── poi.ts               # POI（興趣區）
│   │   ├── poi-state.ts         # POI 狀態機（持久化）
│   │   ├── fvg.ts               # FVG（公平價值缺口）
│   │   └── liquidation.ts        # Gen 3.1 清算檢測
│   │
│   ├── components/              # React 組件
│   │   └── SearchModal.tsx     # 股票搜索模態框
│   │
│   └── types/
│       └── index.ts             # TypeScript 類型定義
│
├── scripts/
│   └── smc-strategy.pine       # TradingView Pine Script
│
├── dist/                        # 構建輸出
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🛠️ 技術棧

| 類別 | 技術 |
|------|------|
| **框架** | React 18 + TypeScript |
| **構建** | Vite 5 |
| **UI** | Ant Design 5 |
| **圖表** | lightweight-charts |
| **樣式** | CSS Modules |
| **存儲** | IndexedDB |
| **數據源** | Yahoo Finance, Polygon.io, Binance |

---

## 🔄 數據源優先順序

```
1. 加密貨幣 → Binance API（實時，無限流）
2. 美股 → Polygon.io（需 API Key）
3. Fallback → Yahoo Finance（有 API 限流）
4. 緩存 → IndexedDB
5. 模擬數據 → 系統生成
```

---

## 🧠 算法版本演進

### Gen 1.0：傳統技術指標
- RSI, MACD, KDJ, 布林帶
- 問題：指標準確性低，無法適應市場結構

### Gen 2.0：SMC 基礎架構
| 模組 | 權重 |
|------|------|
| SFP（假突破） | 35 分 |
| CHOCH（結構轉變） | 30 分 |
| CVD（成交量背離） | 20 分 |
| POI（興趣區） | 15 分 |

### Gen 3.0：微觀訂單流
| 新增功能 | 說明 |
|----------|------|
| **FVG 檢測** | 公平價值缺口 |
| **ATR 動態閾值** | 波動率自適應 |
| **POI 狀態機** | Fresh/Testing/Mitigated/Stale |
| **Veto Filters** | 強趨勢 + FVG 回補否決 |
| **POI 持久化** | IndexedDB 存儲 |

### Gen 3.1：加密貨幣支持
| 新增功能 | 說明 |
|----------|------|
| **Order Book 分析** | 買賣盤失衡 |
| **Whale 檢測** | 大單識別 |
| **清算位估算** | 杠桿清算區間 |
| **多數據源** | Binance 實時數據 |

---

## 📊 算法評分機制

### Sigmoid 概率函數
```
Probability = 1 / (1 + e^(-k × (score - threshold)))
```

- **k**: 曲線斜率（默認 0.15，高波動時 0.12）
- **threshold**: 動態閾值（47-65，根據 ATR 調整）

### 觸發條件
- **弱信號**: score ≥ 55
- **強信號**: score ≥ 75 + probability > 80%
- **三重確認**: SFP + CHOCH + FVG 同時觸發

---

## 🔧 配置文件

### Polygon.io API Key
```javascript
localStorage.setItem('POLYGON_API_KEY', 'your_api_key')
```

### 環境變量（未來支持）
```env
POLYGON_API_KEY=xxx
REDIS_HOST=localhost
REDIS_PORT=6379
```

---

## 📦 已實現功能

- [x] 自選股監控
- [x] 實時報價（多數據源）
- [x] K 線圖表（MA5/10/20）
- [x] 技術指標儀表板
- [x] 買賣信號檢測
- [x] 頂底預測（Gen 3.0）
- [x] POI 狀態追蹤
- [x] FVG 檢測
- [x] 預警通知
- [x] 加密貨幣支持
- [x] 清算檢測
- [x] IndexedDB 持久化

---

## 🚀 部署

```bash
# 開發模式
npm run dev

# 生產構建
npm run build

# 啟動服務
cd dist && python3 -m http.server 3000
```

---

## 📝 更新日誌

### 2026-03-21
- 模擬交易系統升級
- IndexedDB 持久化（刷新不丟失數據）
- 完整交易面板（買入/賣出/持倉/歷史）
- 標的自動交易設置
- Gen 3.1 加密貨幣支持
- 新增 cryptoService.ts (Binance)
- 新增 liquidation.ts (清算檢測)
- 新增 Order Book 分析
- POI 狀態持久化

### 2026-03-21
- Gen 3.0 發布
- 新增 FVG 檢測
- 新增 POI 狀態機
- 實現 ATR 動態閾值
- 實現 Veto Filters

### 2026-03-21
- Gen 2.0 發布
- SMC 架構基礎
- SFP, CHOCH, CVD, POI 模組

---

## 🎮 模擬交易系統

### 功能
- 模擬帳戶餘額管理（預設 100,000 CAD）
- 根據預警信號執行模擬交易
- 持倉追蹤
- 交易歷史記錄
- 盈虧計算
- 0.1% 交易費用
- **IndexedDB 持久化** - 刷新頁面不會丟失數據

### 使用方式
```javascript
// 執行交易
tradingSimulator.executeTrade({
  symbol: 'BTC',
  type: 'buy',
  price: 50000,
  reason: '買入信號',
  confidence: 80
}, 0.1);

// 獲取帳戶資訊
tradingSimulator.getAccount();
tradingSimulator.getPositions();
tradingSimulator.getTrades();

// 重置帳戶
tradingSimulator.reset(100000);
```

---

## 🔗 相關資源

- [Polygon.io](https://polygon.io)
- [Binance API](https://developers.binance.com)
- [TradingView Pine Script](https://www.tradingview.com/pine-script-docs/)
