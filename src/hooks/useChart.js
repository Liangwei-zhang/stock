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
import { useState, useEffect } from 'react';
import { createChart } from 'lightweight-charts';
import { stockService } from '../services/stockService';
export function useChart({ selectedStock, refreshKey }) {
    const [chartContainer, setChartContainer] = useState(null);
    const [chart, setChart] = useState(null);
    const [candleSeries, setCandleSeries] = useState(null);
    const [ma5S, setMa5S] = useState(null);
    const [ma10S, setMa10S] = useState(null);
    const [ma20S, setMa20S] = useState(null);
    // ─── 图表初始化（依赖容器 div）────────────────────────────────────────────
    useEffect(() => {
        if (!chartContainer)
            return;
        const nc = createChart(chartContainer, {
            layout: { background: { color: '#0f1419' }, textColor: '#8b949e' },
            grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
            timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true },
            rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
        });
        const cs = nc.addCandlestickSeries({ upColor: '#52c41a', downColor: '#ff4d4f', borderUpColor: '#52c41a', borderDownColor: '#ff4d4f', wickUpColor: '#52c41a', wickDownColor: '#ff4d4f' });
        const m5 = nc.addLineSeries({ color: '#1890ff', lineWidth: 1, title: 'MA5' });
        const m10 = nc.addLineSeries({ color: '#faad14', lineWidth: 1, title: 'MA10' });
        const m20 = nc.addLineSeries({ color: '#722ed1', lineWidth: 1, title: 'MA20' });
        setChart(nc);
        setCandleSeries(cs);
        setMa5S(m5);
        setMa10S(m10);
        setMa20S(m20);
        const onResize = () => nc.applyOptions({ width: chartContainer.clientWidth, height: 400 });
        window.addEventListener('resize', onResize);
        onResize();
        return () => {
            window.removeEventListener('resize', onResize);
            nc.remove();
        };
    }, [chartContainer]);
    // ─── K 线数据更新 ────────────────────────────────────────────────────────
    useEffect(() => {
        if (!chart || !candleSeries || !selectedStock)
            return;
        const kd = stockService.getKLineData(selectedStock);
        if (!kd.length)
            return;
        // 修复：去除重复时间戳（lightweight-charts 要求时间升序且不重复）
        const deduped = kd
            .filter((item, idx, arr) => idx === 0 || item.time !== arr[idx - 1].time)
            .sort((a, b) => a.time - b.time);
        candleSeries.setData(deduped.map(d => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close })));
        const cls = deduped.map(d => d.close);
        const m5d = [], m10d = [], m20d = [];
        for (let i = 0; i < deduped.length; i++) {
            const t = deduped[i].time;
            if (i >= 4)
                m5d.push({ time: t, value: cls.slice(i - 4, i + 1).reduce((a, b) => a + b) / 5 });
            if (i >= 9)
                m10d.push({ time: t, value: cls.slice(i - 9, i + 1).reduce((a, b) => a + b) / 10 });
            if (i >= 19)
                m20d.push({ time: t, value: cls.slice(i - 19, i + 1).reduce((a, b) => a + b) / 20 });
        }
        ma5S?.setData(m5d);
        ma10S?.setData(m10d);
        ma20S?.setData(m20d);
        chart.timeScale().fitContent();
    }, [selectedStock, refreshKey, chart, candleSeries, ma5S, ma10S, ma20S]);
    return { setChartContainer };
}
