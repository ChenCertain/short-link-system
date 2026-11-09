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
    // 不使用自定义 manualChunks：强制拆包会造成 chunk 间的循环依赖，
    // 导致运行时报错（页面白屏）。依赖由 Rollup 自动合并进按需加载的路由 chunk。
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
