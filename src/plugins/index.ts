/**
 * plugins/index.ts — 注册所有算法插件
 *
 * 新增插件步骤：
 *   1. 在此目录创建 my-strategy.ts，实现 IStrategyPlugin
 *   2. 在此文件 import 并 pluginRegistry.register(new MyStrategy())
 *   3. 重启 / 热更新后插件自动出现在 UI 选择器中
 */

import { pluginRegistry } from '../core/plugin-registry';
import { SMCGen3Plugin }  from './smc-gen3';
import { TrendFollowPlugin } from './trend-follow';
import { MeanReversionPlugin } from './mean-reversion';
import { VolumeBreakoutPlugin } from './volume-breakout';
import { MacdCrossoverPlugin } from './macd-crossover';
import { CompositeEnsemblePlugin } from './composite-ensemble';
import { SMCProPlugin } from './smc-pro';

// ── 注册所有插件 ──────────────────────────────────────────────────────────────
pluginRegistry.register(new SMCProPlugin());
pluginRegistry.register(new SMCGen3Plugin());
pluginRegistry.register(new TrendFollowPlugin());
pluginRegistry.register(new MeanReversionPlugin());
pluginRegistry.register(new VolumeBreakoutPlugin());
pluginRegistry.register(new MacdCrossoverPlugin());
pluginRegistry.register(new CompositeEnsemblePlugin());

// ── 从持久化恢复上次选中的插件 ──────────────────────────────────────────────
pluginRegistry.bootstrap();

export { pluginRegistry };
