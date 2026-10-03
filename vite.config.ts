import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 部署到不同平台需要不同的资源基础路径：
//   GitHub Pages  → /agent-atlas/（仓库名即子路径）
//   Cloudflare Pages → /（域名根路径）
//   本地开发      → /
// 用显式的 BASE_PATH 覆盖，避免依赖 CI 环境变量做隐式判断
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  plugins: [react()],
  base,
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
