import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api':       'http://localhost:3001',
      '/alerts':    'http://localhost:3001',
      '/db':        'http://localhost:3001',
      '/health':    'http://localhost:3001',
      '/binance-api': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/binance-api/, '')
      },
    },
  },
});
