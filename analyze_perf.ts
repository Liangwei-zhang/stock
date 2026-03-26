import './setup_env';
import Database from 'better-sqlite3';
import { pluginRegistry } from './src/plugins/index';
import { calculateAllIndicators } from './src/utils/indicators';
import { tradingSimulator } from './src/services/tradingSimulator';
import type { StockData } from './src/types';

const db = new Database('./data/market.db');

(global as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
};
(global as any).window = { localStorage: (global as any).localStorage };

async function analyze() {
    const symbols = db.prepare("SELECT DISTINCT symbol FROM ohlcv").all() as any[];
    console.log('Symbols: ' + symbols.map((s: any) => s.symbol).join(', '));
    for (const plugin of pluginRegistry.list()) {
        let totalTrades = 0;
        let totalWins = 0;
        for (const { symbol } of symbols) {
            const rows = db.prepare("SELECT * FROM ohlcv WHERE symbol = ? ORDER BY timestamp ASC").all(symbol) as any[];
            if (rows.length < 50) continue;
            const data: any[] = rows.map(r => ({
                t: new Date(r.timestamp),
                timestamp: r.timestamp,
                price: r.close,
                close: r.close,
                open: r.open,
                high: r.high,
                low: r.low,
                volume: r.volume
            }));
            const indicators = calculateAllIndicators(data, symbol);
            const config = (plugin.config && Array.isArray(plugin.config)) ? Object.fromEntries(plugin.config.map((c:any) => [c.id, c.default])) : {};
            // try {
                tradingSimulator.run(data, { ...plugin, defaultConfig: config } as any, indicators);
                const stats = tradingSimulator.getStats();
                totalTrades += stats.totalTrades;
                totalWins += stats.winningTrades;
            // } catch (e) {
            //     // Ignore
            // }
        }
        const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
        console.log(`[${plugin.name}] Trades: ${totalTrades}, Win%: ${winRate.toFixed(2)}%`);
    }
}
analyze().catch(console.error);