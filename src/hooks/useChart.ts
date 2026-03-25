/**
 * useChart — lightweight-charts 图表生命周期管理
 *
 * 职责：
 *  - 监听容器 div ref，创建/销毁 chart 实例
 *  - 监听 selectedStock + refreshKey，更新 K 线 & MA 数据
 *
 * 用法：
 *  const { setChartContainer } = useChart({ selectedStock, refreshKey });
 *  <div ref={setChartContainer} />
 */

import { useState, useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, LineData, Time } from 'lightweight-charts';
import { stockService } from '../services/stockService';

interface UseChartOptions {
  selectedStock: string;
  refreshKey:    number;
}

export function useChart({ selectedStock, refreshKey }: UseChartOptions) {
  const [chartContainer, setChartContainer] = useState<HTMLDivElement | null>(null);

  // useRef 存儲 chart 實例引用，避免 closure 陳舊引用問題
  const chartRef        = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ma5SRef         = useRef<ISeriesApi<'Line'> | null>(null);
  const ma10SRef        = useRef<ISeriesApi<'Line'> | null>(null);
  const ma20SRef        = useRef<ISeriesApi<'Line'> | null>(null);

  // ─── 图表初始化（依赖容器 div）────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainer) return;

    const nc = createChart(chartContainer, {
      layout:          { background: { color: '#0f1419' }, textColor: '#8b949e' },
      grid:            { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
      timeScale:       { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
    });

    const cs  = nc.addCandlestickSeries({ upColor: '#52c41a', downColor: '#ff4d4f', borderUpColor: '#52c41a', borderDownColor: '#ff4d4f', wickUpColor: '#52c41a', wickDownColor: '#ff4d4f' });
    const m5  = nc.addLineSeries({ color: '#1890ff', lineWidth: 1, title: 'MA5' });
    const m10 = nc.addLineSeries({ color: '#faad14', lineWidth: 1, title: 'MA10' });
    const m20 = nc.addLineSeries({ color: '#722ed1', lineWidth: 1, title: 'MA20' });

    chartRef.current        = nc;
    candleSeriesRef.current = cs;
    ma5SRef.current         = m5;
    ma10SRef.current        = m10;
    ma20SRef.current        = m20;

    const onResize = () => nc.applyOptions({ width: chartContainer.clientWidth, height: 400 });
    window.addEventListener('resize', onResize);
    onResize();

    return () => {
      window.removeEventListener('resize', onResize);
      // 確保 chart 實例被正確銷毀，清空 DOM 避免孤立節點
      try { nc.remove(); } catch { /* 已銷毀則忽略 */ }
      chartContainer.innerHTML = '';
      chartRef.current        = null;
      candleSeriesRef.current = null;
      ma5SRef.current         = null;
      ma10SRef.current        = null;
      ma20SRef.current        = null;
    };
  }, [chartContainer]);

  // ─── K 线数据更新 ────────────────────────────────────────────────────────
  useEffect(() => {
    const chart        = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries || !selectedStock) return;

    const kd = stockService.getKLineData(selectedStock);
    if (!kd.length) return;

    // 修复：去除重复时间戳（lightweight-charts 要求时间升序且不重复）
    const deduped = kd
      .filter((item, idx, arr) => idx === 0 || item.time !== arr[idx - 1].time)
      .sort((a, b) => (a.time as number) - (b.time as number));

    candleSeries.setData(
      deduped.map(d => ({ time: d.time as Time, open: d.open, high: d.high, low: d.low, close: d.close })) as CandlestickData[],
    );

    const cls = deduped.map(d => d.close);
    const m5d: LineData[] = [], m10d: LineData[] = [], m20d: LineData[] = [];

    for (let i = 0; i < deduped.length; i++) {
      const t = deduped[i].time as Time;
      if (i >= 4)  m5d .push({ time: t, value: cls.slice(i - 4,  i + 1).reduce((a, b) => a + b) / 5  });
      if (i >= 9)  m10d.push({ time: t, value: cls.slice(i - 9,  i + 1).reduce((a, b) => a + b) / 10 });
      if (i >= 19) m20d.push({ time: t, value: cls.slice(i - 19, i + 1).reduce((a, b) => a + b) / 20 });
    }

    ma5SRef.current?.setData(m5d);
    ma10SRef.current?.setData(m10d);
    ma20SRef.current?.setData(m20d);
    chart.timeScale().fitContent();
  // chartContainer 加入依賴：確保容器更換後（chart 重建時）K 線數據也重新注入
  }, [selectedStock, refreshKey, chartContainer]);

  return { setChartContainer };
}
