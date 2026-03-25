import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = process.env.VITE_SERVER_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api':       SERVER,
      '/alerts':    SERVER,
      '/db':        SERVER,
      '/health':    SERVER,
      '/binance-api': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/binance-api/, '')
      },
    },
  },
});
