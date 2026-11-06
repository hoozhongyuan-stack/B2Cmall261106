import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 部署到子路径时用 ADMIN_BASE=/admin/ 构建，本地开发保持根路径
  base: process.env.ADMIN_BASE ?? '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // 本地开发直连 API；生产由网关同源转发
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
