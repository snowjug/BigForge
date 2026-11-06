import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = process.env.BIGFORGE_API_PORT ?? '4747';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
});
