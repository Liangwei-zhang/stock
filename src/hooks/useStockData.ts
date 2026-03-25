/**
 * useStockData — 股票数据轮询 + 预警触发
 *
 * 职责：
 *  - 初始化 stockService，完成后设置 initialized = true
 *  - 每 UPDATE_MS 毫秒拉一次最新报价，更新 stocks / watchlistItems
 *  - 检测信号状态变化，调用 alertService.createAlert()
 *  - 驱动模拟用户决策 & 止损巡检
 *
 * 不包含：图表逻辑、UI 渲染
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { alertService }       from '../services/alertService';
import { indicatorService }   from '../services/indicatorService';
import { stockService }       from '../services/stockService';
import { autoTradeService }   from '../services/autoTradeService';
import { tradingSimulator }   from '../services/tradingSimulator';
import { simulatedUserService } from '../services/simulatedUsers';
import { StockData, SignalResult, WatchlistItem, DataSource } from '../types';

const UPDATE_MS = 20_000;

export interface StockRow {
  stock:  StockData;
  buy?:   SignalResult;
  sell?:  SignalResult;
  source: DataSource;
}

export function useStockData() {
  const [initialized,    setInitialized]    = useState(false);
  const [stocks,         setStocks]         = useState<StockRow[]>([]);
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [refreshKey,     setRefreshKey]     = useState(0);

  // 追蹤信號狀態，避免重複觸發預警
  const prevSignals = useRef<Map<string, { buy: boolean; sell: boolean; pred: string }>>(new Map());

  // ─── 同步 UI 快照 ──────────────────────────────────────────────────────────
  const updateUI = useCallback(() => {
    indicatorService.invalidateCache();

    const wl = stockService.getWatchlist();
    setWatchlistItems(wl);

    const raw = stockService.getStocks();
    setStocks(raw.map(s => ({
      stock:  s,
      buy:    indicatorService.getBuySignal(s.symbol),
      sell:   indicatorService.getSellSignal(s.symbol),
      source: stockService.getSymbolMeta(s.symbol).source,
    })));

    // 批量预警 — 只在信號狀態從「無」→「有」時觸發
    for (const sym of stockService.getAvailableStocks()) {
      const a = indicatorService.analyzeStock(sym);
      if (!a) continue;

      const prev     = prevSignals.current.get(sym);
      const currBuy  = a.buySignal.signal;
      const currSell = a.sellSignal.signal;
      const currPred = a.prediction.type;

      if (currBuy && (!prev || !prev.buy) && a.buySignal.level && a.buySignal.level !== 'low') {
        alertService.createAlert(a, 'buy', a.buySignal);
      }
      if (currSell && (!prev || !prev.sell) && a.sellSignal.level && a.sellSignal.level !== 'low') {
        alertService.createAlert(a, 'sell', a.sellSignal);
      }
      if (currPred !== 'neutral' && (!prev || prev.pred !== currPred) && a.prediction.probability > 0.65) {
        alertService.createAlert(a, currPred, {
          signal:  true,
          level:   a.prediction.probability > 0.80 ? 'high' : 'medium',
          score:   Math.round(a.prediction.probability * 100),
          reasons: a.prediction.signals,
        });
      }

      prevSignals.current.set(sym, { buy: currBuy, sell: currSell, pred: currPred });
    }
    alertService.flush();

    // 驱动模拟用户决策
    const prices    = new Map<string, number>(stockService.getStocks().map(s => [s.symbol, s.price]));
    const analyses  = indicatorService.analyzeAllStocks(stockService.getAvailableStocks());
    simulatedUserService.onMarketUpdate(analyses, prices);

    setRefreshKey(k => k + 1);
  }, []);

  // ─── 初始化 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    stockService.init().then(() => {
      if (cancelled) return;
      const wl = stockService.getWatchlist();
      setWatchlistItems(wl);
      setInitialized(true);
      updateUI();
    });

    return () => { cancelled = true; };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 轮询（初始化后启动）──────────────────────────────────────────────────
  useEffect(() => {
    if (!initialized) return;
    updateUI();
    let mounted = true;

    autoTradeService.setOnChange(() => { if (mounted) setRefreshKey(k => k + 1); });
    tradingSimulator.setOnUpdate(() => { if (mounted) setRefreshKey(k => k + 1); });

    const tick = async () => {
      await stockService.updateStocks();
      if (!mounted) return;
      updateUI();

      const analyses = indicatorService.analyzeAllStocks(stockService.getAvailableStocks());
      await autoTradeService.onMarketUpdate(analyses);
      if (!mounted) return;

      const prices = new Map<string, number>(stockService.getStocks().map(s => [s.symbol, s.price]));
      await tradingSimulator.checkStopLossTakeProfit(prices);
      simulatedUserService.checkPositions(prices);
    };

    const id = setInterval(tick, UPDATE_MS);
    return () => {
      mounted = false;
      clearInterval(id);
      autoTradeService.setOnChange(() => {});
      tradingSimulator.setOnUpdate(() => {});
    };
  }, [initialized, updateUI]);

  // ─── 添加 / 移除 symbol ───────────────────────────────────────────────────
  const handleAdd = useCallback(async (result: { symbol: string; name: string; assetType: any; exchange: string }) => {
    const item: WatchlistItem = {
      symbol:    result.symbol,
      name:      result.name,
      addedAt:   Date.now(),
      assetType: result.assetType,
      exchange:  result.exchange,
    };
    await stockService.addSymbol(item);
    setWatchlistItems(stockService.getWatchlist());
    updateUI();
    // 后台真实历史通常 2-8s 后到达，分三波刷新
    setTimeout(updateUI, 2000);
    setTimeout(updateUI, 5000);
    setTimeout(updateUI, 10000);
  }, [updateUI]);

  const handleRemove = useCallback(async (symbol: string) => {
    await stockService.removeSymbol(symbol);
    setWatchlistItems(stockService.getWatchlist());
    updateUI();
  }, [updateUI]);

  return {
    initialized,
    stocks,
    watchlistItems,
    refreshKey,
    updateUI,
    handleAdd,
    handleRemove,
  };
}
