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

import { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, LineData, Time } from 'lightweight-charts';
import { stockService } from '../services/stockService';

interface UseChartOptions {
  selectedStock: string;
  refreshKey:    number;
}

export function useChart({ selectedStock, refreshKey }: UseChartOptions) {
  const [chartContainer, setChartContainer] = useState<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ma5Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ma10Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ma20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const disposedRef = useRef(false);

  // ─── 图表初始化（依赖容器 div）────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainer) return;

    disposedRef.current = false;

    const nc = createChart(chartContainer, {
      layout:          { background: { color: '#ffffff' }, textColor: '#5f7a6a' },
      grid:            { vertLines: { color: 'rgba(103, 201, 138, 0.08)' }, horzLines: { color: 'rgba(103, 201, 138, 0.08)' } },
      timeScale:       { borderColor: 'rgba(103, 201, 138, 0.18)', timeVisible: true },
      rightPriceScale: { borderColor: 'rgba(103, 201, 138, 0.18)' },
    });

    const cs  = nc.addCandlestickSeries({ upColor: '#52c41a', downColor: '#ff4d4f', borderUpColor: '#52c41a', borderDownColor: '#ff4d4f', wickUpColor: '#52c41a', wickDownColor: '#ff4d4f' });
    const m5  = nc.addLineSeries({ color: '#77d7a2', lineWidth: 1, title: 'MA5' });
    const m10 = nc.addLineSeries({ color: '#faad14', lineWidth: 1, title: 'MA10' });
    const m20 = nc.addLineSeries({ color: '#722ed1', lineWidth: 1, title: 'MA20' });

    chartRef.current = nc;
    candleSeriesRef.current = cs;
    ma5Ref.current = m5;
    ma10Ref.current = m10;
    ma20Ref.current = m20;

    const onResize = () => {
      if (disposedRef.current || !chartRef.current || !chartContainer.isConnected) return;
      chartRef.current.applyOptions({ width: chartContainer.clientWidth, height: 400 });
    };

    window.addEventListener('resize', onResize);
    onResize();

    return () => {
      disposedRef.current = true;
      window.removeEventListener('resize', onResize);

      chartRef.current = null;
      candleSeriesRef.current = null;
      ma5Ref.current = null;
      ma10Ref.current = null;
      ma20Ref.current = null;

      nc.remove();
    };
  }, [chartContainer]);

  // ─── K 线数据更新 ────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const ma5S = ma5Ref.current;
    const ma10S = ma10Ref.current;
    const ma20S = ma20Ref.current;

    if (!chart || !candleSeries || !selectedStock || disposedRef.current || !chartContainer?.isConnected) return;

    const kd = stockService.getKLineData(selectedStock);
    if (!kd.length) return;

    // 修复：去除重复时间戳（lightweight-charts 要求时间升序且不重复）
    const deduped = kd
      .filter((item, idx, arr) => idx === 0 || item.time !== arr[idx - 1].time)
      .sort((a, b) => (a.time as number) - (b.time as number));

    try {
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

      if (disposedRef.current) return;

      ma5S?.setData(m5d);
      ma10S?.setData(m10d);
      ma20S?.setData(m20d);
      chart.timeScale().fitContent();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Object is disposed')) {
        throw error;
      }
    }
  }, [selectedStock, refreshKey, chartContainer]);

  return { setChartContainer };
}
