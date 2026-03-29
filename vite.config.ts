import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 獨立執行 Vite dev server（npm run dev:vite-only）時，
 * 攔截 /api /db /alerts /health 等後端路徑，
 * 回傳 JSON 而非 SPA index.html，避免前端拿到 HTML 後 JSON.parse 失敗。
 */
function apiNotFoundPlugin(): Plugin {
  const BACKEND_PREFIXES = ['/api', '/db', '/alerts', '/health'];
  return {
    name: 'api-not-found-in-standalone',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0];
        const isBackend = BACKEND_PREFIXES.some(
          p => pathname === p || pathname.startsWith(p + '/'),
        );
        if (!isBackend) { next(); return; }
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          error: 'Backend not running. Use `npm run dev` (server.ts) instead of standalone Vite.',
        }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiNotFoundPlugin()],
  server: {
    port: 3000,
    // proxy 已移除：前後端由 server.ts 整合為單一服務（port 3000）
    proxy: {
      '/binance-api': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/binance-api/, ''),
      },
    },
  },
});
