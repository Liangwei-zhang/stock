// Mock localStorage
(global as any).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import { plugins } from './src/plugins';
import { marketDb } from './src/db/market-db';
import { getTechnicalIndicators } from './src/utils/indicators';
import { TradingSimulator } from './src/services/tradingSimulator';

const symbols = marketDb.getStoredSymbols();
console.log('Stored symbols:', symbols);

for (const p of plugins) {
  let totalWins = 0;
  let totalTrades = 0;
  let netProfit = 0;
  
  for (const sym of symbols) {
    const data = marketDb.getSymbolData(sym);
    if (!data || data.length < 50) continue;
    
    const indicators = getTechnicalIndicators(data, 14, 20, 50, 200, 12, 26, 9);
    
    // Default config values
    const config = Object.fromEntries(p.config.map(c => [c.id, c.default]));
    
    let sim;
    try {
      sim = new TradingSimulator(10000, 0.001);
      sim.run(data, { ...p, defaultConfig: config }, indicators);
      const stats = sim.getStats();
      totalTrades += stats.totalTrades;
      totalWins += stats.winningTrades;
      netProfit += stats.netProfit;
    } catch {
      continue;
    }
  }
  
  const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
  console.log(`${p.name}: Trades: ${totalTrades}, Win Rate: ${winRate.toFixed(2)}%, Net Profit: $${netProfit.toFixed(2)}`);
}
