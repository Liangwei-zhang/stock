/**
 * src/tests/export.test.ts — 報表導出測試
 *
 * 覆蓋：
 *  - export/report-exporter.ts  exportCSV(), exportJSON(), exportHTML(), exportReport()
 *  - export/report-service.ts   generateAndExport() (mocked dependencies)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnalysisReport, OHLCVRecord } from '../core/types';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeOHLCV(n: number, symbol = 'TEST'): OHLCVRecord[] {
  const records: OHLCVRecord[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price += (Math.random() - 0.5) * 2;
    records.push({
      symbol,
      timestamp: Date.now() - (n - i) * 86400000,
      open:   price * 0.999,
      high:   price * 1.01,
      low:    price * 0.99,
      close:  price,
      volume: 1000000,
      source: 'test',
    });
  }
  return records;
}

function makeReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    generatedAt: Date.now(),
    symbol:      'TEST',
    name:        'Test Asset',
    pluginId:    'smc-gen3',
    pluginName:  'SMC Gen 3.1',
    price:       100,
    priceChange: 1.5,
    indicators: {
      ma5: 100, ma10: 99, ma20: 98, ma60: 96,
      ema9: 99, ema21: 97,
      kdjK: 52, kdjD: 50, kdjJ: 56,
      rsi6: 55, rsi9: 53, rsi12: 51, rsi14: 50, rsi24: 48,
      adx: 22,
      macdDif: 0.5, macdDea: 0.3, macdHistogram: 0.2,
      bollUp: 105, bollMb: 100, bollDn: 95,
      bollWidth: 0.10,
      bollSqueezing: false,
      valueAreaHigh: 103, valueAreaLow: 97, poc: 100,
      diPlus: 24, diMinus: 18,
      rsiBullDiv: false, rsiBearDiv: false,
      atr14: 0, swingHigh: 0, swingLow: 0, prevSwingHigh: 0, prevSwingLow: 0,
      bullOBHigh: 0, bullOBLow: 0, bearOBHigh: 0, bearOBLow: 0,
      liqHigh: 0, liqLow: 0,
    },
    buySignal: {
      signal: true,
      level: 'high',
      score: 80,
      reasons: ['RSI oversold', 'EMA cross', 'CHoCH confirmed', 'Volume surge'],
    },
    sellSignal: {
      signal: false,
      level: null,
      score: 20,
      reasons: [],
    },
    prediction: {
      type: 'bottom',
      probability: 0.72,
      signals: ['RSI divergence', 'Price at support'],
      recommendation: '考慮買入',
    },
    history:  makeOHLCV(40),
    metadata: { dataLen: 40 },
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  1. exportCSV
// ══════════════════════════════════════════════════════════════════════════════

describe('report-exporter.ts — exportCSV', () => {
  let createdContent = '';
  let createdFilename = '';

  beforeEach(() => {
    // Mock DOM APIs used by downloadBlob
    const mockA = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => mockA),
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        // Read content
        return 'blob:mock-url';
      }),
      revokeObjectURL: vi.fn(),
    });

    // Capture Blob content
    vi.stubGlobal('Blob', vi.fn((parts: string[], options: any) => {
      createdContent = parts[0];
      createdFilename = options?.type ?? '';
      return { size: parts[0].length, type: options?.type ?? '' };
    }));
  });

  it('generates CSV with header row', async () => {
    const { exportCSV } = await import('../export/report-exporter');
    const report = makeReport();
    exportCSV(report);
    expect(createdContent).toContain('Date,Open,High,Low,Close,Volume,Source');
  });

  it('CSV has correct number of data rows', async () => {
    const { exportCSV } = await import('../export/report-exporter');
    const report = makeReport({ history: makeOHLCV(5) });
    exportCSV(report);
    const lines = createdContent.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(6);   // 1 header + 5 data rows
  });

  it('uses CSV MIME type', async () => {
    const { exportCSV } = await import('../export/report-exporter');
    exportCSV(makeReport());
    expect(createdFilename).toContain('text/csv');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  2. exportJSON
// ══════════════════════════════════════════════════════════════════════════════

describe('report-exporter.ts — exportJSON', () => {
  let createdContent = '';

  beforeEach(() => {
    const mockA = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => mockA) });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('Blob', vi.fn((parts: string[]) => {
      createdContent = parts[0];
      return { size: parts[0].length };
    }));
  });

  it('generates valid JSON', async () => {
    const { exportJSON } = await import('../export/report-exporter');
    exportJSON(makeReport());
    expect(() => JSON.parse(createdContent)).not.toThrow();
  });

  it('JSON contains symbol and price info', async () => {
    const { exportJSON } = await import('../export/report-exporter');
    const report = makeReport({ symbol: 'BTC', price: 50000 });
    exportJSON(report);
    const parsed = JSON.parse(createdContent);
    expect(parsed.meta.symbol).toBe('BTC');
    expect(parsed.price.current).toBe(50000);
  });

  it('JSON includes buySignal and sellSignal', async () => {
    const { exportJSON } = await import('../export/report-exporter');
    exportJSON(makeReport());
    const parsed = JSON.parse(createdContent);
    expect(parsed.buySignal).toBeDefined();
    expect(parsed.sellSignal).toBeDefined();
  });

  it('JSON includes prediction', async () => {
    const { exportJSON } = await import('../export/report-exporter');
    exportJSON(makeReport());
    const parsed = JSON.parse(createdContent);
    expect(parsed.prediction).toBeDefined();
    expect(parsed.prediction.type).toBe('bottom');
  });

  it('JSON includes historyRows count', async () => {
    const { exportJSON } = await import('../export/report-exporter');
    const report = makeReport({ history: makeOHLCV(30) });
    exportJSON(report);
    const parsed = JSON.parse(createdContent);
    expect(parsed.historyRows).toBe(30);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  3. exportHTML
// ══════════════════════════════════════════════════════════════════════════════

describe('report-exporter.ts — exportHTML', () => {
  let createdContent = '';

  beforeEach(() => {
    const mockA = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => mockA) });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('Blob', vi.fn((parts: string[]) => {
      createdContent = parts[0];
      return { size: parts[0].length };
    }));
  });

  it('generates HTML starting with DOCTYPE', async () => {
    const { exportHTML } = await import('../export/report-exporter');
    exportHTML(makeReport());
    expect(createdContent.trimStart()).toMatch(/^<!DOCTYPE html>/i);
  });

  it('HTML contains symbol in title or heading', async () => {
    const { exportHTML } = await import('../export/report-exporter');
    const report = makeReport({ symbol: 'AAPL', name: 'Apple Inc' });
    exportHTML(report);
    expect(createdContent).toContain('AAPL');
    expect(createdContent).toContain('Apple Inc');
  });

  it('HTML contains indicator table', async () => {
    const { exportHTML } = await import('../export/report-exporter');
    exportHTML(makeReport());
    expect(createdContent).toContain('EMA9');
    expect(createdContent).toContain('RSI14');
  });

  it('HTML contains price value', async () => {
    const { exportHTML } = await import('../export/report-exporter');
    exportHTML(makeReport({ price: 12345.67 }));
    expect(createdContent).toContain('12345.67');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  4. exportReport() unified entry
// ══════════════════════════════════════════════════════════════════════════════

describe('report-exporter.ts — exportReport', () => {
  let blobCallCount = 0;
  let lastBlobContent = '';
  let lastMimeType = '';

  beforeEach(() => {
    blobCallCount = 0;
    const mockA = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => mockA) });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('Blob', vi.fn((parts: string[], opts: any) => {
      blobCallCount++;
      lastBlobContent = parts[0];
      lastMimeType = opts?.type ?? '';
      return { size: parts[0].length, type: opts?.type ?? '' };
    }));
  });

  it('csv format creates CSV content', async () => {
    const { exportReport } = await import('../export/report-exporter');
    exportReport(makeReport(), 'csv');
    expect(blobCallCount).toBe(1);
    expect(lastBlobContent).toContain('Date,Open,High,Low,Close,Volume,Source');
  });

  it('json format creates JSON content', async () => {
    const { exportReport } = await import('../export/report-exporter');
    exportReport(makeReport(), 'json');
    expect(blobCallCount).toBe(1);
    expect(() => JSON.parse(lastBlobContent)).not.toThrow();
  });

  it('html format creates HTML content', async () => {
    const { exportReport } = await import('../export/report-exporter');
    exportReport(makeReport(), 'html');
    expect(blobCallCount).toBe(1);
    expect(lastBlobContent).toContain('<!DOCTYPE html>');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  5. generateAndExport() from report-service.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('report-service.ts — generateAndExport', () => {
  beforeEach(() => {
    vi.resetModules();
    const mockA = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => mockA) });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('Blob', vi.fn(() => ({})));
  });

  it('throws when no active plugin', async () => {
    vi.doMock('../core/plugin-registry', () => ({
      pluginRegistry: { getActive: () => null, analyze: () => null },
    }));
    vi.doMock('../services/stockService', () => ({
      stockService: {
        getStockHistory: () => [],
        getWatchlist:    () => [],
        getSymbolMeta:   () => ({ source: 'test' }),
      },
    }));
    vi.doMock('../db/market-db', () => ({
      marketDB: { queryOHLCV: async () => [] },
    }));
    const { generateAndExport } = await import('../export/report-service');
    await expect(generateAndExport('TEST', 'csv')).rejects.toThrow('No active strategy plugin');
  });

  it('throws when no history data', async () => {
    vi.doMock('../core/plugin-registry', () => ({
      pluginRegistry: {
        getActive:  () => ({ id: 'p', name: 'P' }),
        analyze:    () => null,
      },
    }));
    vi.doMock('../services/stockService', () => ({
      stockService: {
        getStockHistory: () => [],
        getWatchlist:    () => [],
        getSymbolMeta:   () => ({ source: 'test' }),
      },
    }));
    vi.doMock('../db/market-db', () => ({
      marketDB: { queryOHLCV: async () => [] },
    }));
    const { generateAndExport } = await import('../export/report-service');
    await expect(generateAndExport('TEST', 'csv')).rejects.toThrow('No data');
  });
});
