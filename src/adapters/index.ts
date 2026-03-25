/**
 * adapters/index.ts — 注册所有数据源适配器
 *
 * 导入此文件一次即可完成所有适配器的注册。
 * App 入口（main.tsx 或 App.tsx）调用：
 *   import '../adapters';
 */

import { dataSourceRegistry } from '../core/data-source-registry';
import { BinanceAdapter }     from './binance';
import { PolygonAdapter }     from './polygon';
import { YahooAdapter }       from './yahoo';

dataSourceRegistry.register(new BinanceAdapter());
dataSourceRegistry.register(new PolygonAdapter());
dataSourceRegistry.register(new YahooAdapter());

export { dataSourceRegistry };
