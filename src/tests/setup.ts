// Test setup - mock browser APIs not available in jsdom
import { vi } from 'vitest';

// Mock IndexedDB
const indexedDB = {
  open: vi.fn(() => ({
    result: null,
    error: null,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
  })),
};
vi.stubGlobal('indexedDB', indexedDB);

// Mock localStorage
const localStorageData: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => localStorageData[k] ?? null,
  setItem: (k: string, v: string) => { localStorageData[k] = v; },
  removeItem: (k: string) => { delete localStorageData[k]; },
  clear: () => { Object.keys(localStorageData).forEach(k => delete localStorageData[k]); },
});

// Mock fetch
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network not available in tests'))));
