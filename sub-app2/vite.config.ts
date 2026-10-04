import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { qiankun } from '@qiankunjs/bundler-plugin/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), qiankun()],
  server: {
    // 每个微应用必须使用固定且唯一的端口,主应用在 entry 里硬引用
    port: 7102,
    strictPort: true,
  },
})
