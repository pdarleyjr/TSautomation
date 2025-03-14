import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/skyvern/',
  server: {
    port: 3000,
    host: true,
    preview: {
      allowedHosts: ['skyvernui', 'localhost'],
    },
    proxy: {
      '/api/v2': {
        target: process.env.VITE_SKYVERN_API_URL || 'http://skyvern:8000',
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: process.env.VITE_SKYVERN_API_URL || 'http://skyvern:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});