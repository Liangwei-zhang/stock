import { describe, it } from 'vitest';
import { pluginRegistry } from '../src/core/plugin-registry';
import { rankPluginsByTradeBacktest, rankPluginsByBacktest } from '../src/services/backtestStats';

describe('Win Rate Analysis', () => {
    it('Calculate', async () => {
        // 此測試需要瀏覽器環境（IndexedDB）與已載入的市場資料，
        // 在 Node.js 測試環境中自動跳過（無 expect 斷言，純分析輸出）
        if (typeof indexedDB === 'undefined') {
            console.log('跳過：IndexedDB 不可用（非瀏覽器環境）');
            return;
        }

        const data: any[] = [];
        console.log('No data available for testing');
        
        if (!data || data.length === 0) {
            console.log('No data available for testing');
            return;
        }

        const plugins = pluginRegistry.getAllPlugins();
        console.log('\n--- Trade Simulation Results ---');
        const tradeResults = await rankPluginsByTradeBacktest(plugins, data);
        tradeResults.forEach(r => {
            console.log(`${r.plugin.name} - Win Rate: ${(r.stats.winRate * 100).toFixed(2)}%, Trades: ${r.stats.totalTrades}, Max Drawdown: ${(r.stats.maxDrawdown * 100).toFixed(2)}%, Net Profit: $${r.stats.netProfit.toFixed(2)}`);
        });

        console.log('\n--- Signal Prediction Results ---');
        const signalResults = await rankPluginsByBacktest(plugins, data);
        signalResults.forEach(r => {
            console.log(`${r.pluginName} - Win Rate: ${(r.winRate * 100).toFixed(2)}%, Signals: ${r.totalSignals}, Expected Value: ${(r.expectedValue * 100).toFixed(2)}%`);
        });
    });
});
