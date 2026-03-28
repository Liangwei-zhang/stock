import { query, pool } from '../db/pool.js';
import { processBuySignal } from './buyScanner.js';
import { processSellSignal } from './sellScanner.js';

const SCANNER_INTERVAL_MS = 5 * 60 * 1000; // 5 分鐘

/**
 * 獲取所有活躍標的（從物化視圖）
 */
async function getActiveSymbols(): Promise<string[]> {
  try {
    // 嘗試刷新物化視圖
    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY active_symbols');
  } catch (err) {
    console.warn('[Scanner] 物化視圖刷新失敗，使用舊數據：', (err as Error).message);
  }

  const rows = await query<{ symbol: string }>(
    'SELECT symbol FROM active_symbols'
  );
  return rows.map(r => r.symbol);
}

/**
 * 模擬獲取標的最新價格（實際項目應調用行情 API）
 * 這裡提供接口，外部注入實際數據源
 */
async function fetchPrice(symbol: string): Promise<number | null> {
  // TODO: 接入 Yahoo Finance / Polygon / Binance
  // 目前返回 null（跳過無行情的標的）
  return null;
}

/**
 * 分析標的，生成信號
 * 實際項目調用 src/services/indicatorService 的算法
 */
async function analyzeSymbol(symbol: string, price: number): Promise<{
  buyScore: number;
  reasons: string[];
  smcTopProb: number;
} | null> {
  // TODO: 接入 SMC Gen 3.0 分析
  return null;
}

/**
 * 主掃描循環
 */
async function runScanCycle(): Promise<void> {
  const start = Date.now();
  console.log(`[Scanner] 開始掃描 ${new Date().toISOString()}`);

  const symbols = await getActiveSymbols();
  console.log(`[Scanner] 活躍標的: ${symbols.length} 個`);

  let buySignals = 0;
  let sellChecks = 0;

  for (const symbol of symbols) {
    try {
      const price = await fetchPrice(symbol);
      if (!price) continue;

      const analysis = await analyzeSymbol(symbol, price);
      if (!analysis) continue;

      // 買入信號（score >= 60）
      if (analysis.buyScore >= 60) {
        await processBuySignal({
          symbol,
          score: analysis.buyScore,
          price,
          reasons: analysis.reasons,
          analysis: {},
        });
        buySignals++;
      }

      // 賣出信號（每個有持倉的標的都需要檢查）
      await processSellSignal({
        symbol,
        currentPrice: price,
        smcTopProbability: analysis.smcTopProb,
      });
      sellChecks++;

    } catch (err) {
      console.error(`[Scanner] ${symbol} 處理失敗：`, (err as Error).message);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `[Scanner] 掃描完成：${symbols.length} 個標的，` +
    `${buySignals} 個買入信號，${sellChecks} 個賣出檢查，耗時 ${elapsed}s`
  );
}

/** 啟動 Scanner */
async function startScanner(): Promise<void> {
  console.log('🔍 Scanner 啟動');

  // 首次立即執行
  await runScanCycle().catch(err =>
    console.error('[Scanner] 首次掃描失敗：', err.message)
  );

  // 定時循環
  setInterval(async () => {
    await runScanCycle().catch(err =>
      console.error('[Scanner] 掃描失敗：', err.message)
    );
  }, SCANNER_INTERVAL_MS);

  // 優雅關閉
  const shutdown = () => {
    console.log('🔍 Scanner 關閉');
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

startScanner();
