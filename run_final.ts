import './setup_env';
import Database from 'better-sqlite3';
import { pluginRegistry } from './src/plugins/index';
import { rankPluginsByTradeBacktest, rankPluginsByBacktest } from './src/services/backtestStats';

const db = new Database('./data/market.db');

async function analyze() {
    const symbols = db.prepare("SELECT DISTINCT symbol FROM ohlcv").all() as any[];
    console.log(`Analyzing over symbols: ${symbols.map((s:any) => s.symbol).join(', ')}`);

    type ResultAgg = {
        name: string;
        trades: number;
        wins: number;
        profit: number;
    };
    
    const agg: Record<string, ResultAgg> = {};
    for (const p of pluginRegistry.list()) {
        agg[p.name] = { name: p.name, trades: 0, wins: 0, profit: 0 };
    }

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
        
        const results = await rankPluginsByTradeBacktest(pluginRegistry.list(), data, symbol);
        for (const r of results as any[]) {
            const stats = r.tradeStats || r.stats;
            const pName = r.pluginName || (r.plugin && r.plugin.name);
            if (!agg[pName]) continue;
            agg[pName].trades += stats.totalTrades;
            agg[pName].wins += stats.winningTrades;
            agg[pName].profit += stats.totalPnL || stats.netProfit || 0;
        }
    }

    console.log('\n--- Final Aggregated Win Rates ---');
    Object.values(agg).sort((a,b) => (b.wins/Math.max(1,b.trades)) - (a.wins/Math.max(1,a.trades))).forEach(a => {
        const winRate = a.trades > 0 ? (a.wins / a.trades) * 100 : 0;
        console.log(`[${a.name.padEnd(10)}] Trades: ${a.trades.toString().padStart(4)}, WinRate: ${winRate.toFixed(2)}%, Net Profit: $${a.profit.toFixed(2)}`);
    });
}
analyze();