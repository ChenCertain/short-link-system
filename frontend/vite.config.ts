import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: true,
    // 构建速度：跳过 gzip 体积统计（CDN 会自动压缩）
    reportCompressedSize: false,
    // 依赖按包拆分，命中浏览器长缓存，避免每次发版重复下载
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
          if (id.includes('qrcode')) return 'qrcode'
          if (id.includes('lucide-react')) return 'icons'
          if (
            id.includes('react/') ||
            id.includes('react-dom') ||
            id.includes('react-router') ||
            id.includes('scheduler')
          ) {
            return 'react'
          }
          return 'vendor'
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
