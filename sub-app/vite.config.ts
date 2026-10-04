import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { qiankun } from '@qiankunjs/bundler-plugin/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), qiankun()],
  server: {
    port: 7101,
    strictPort: true,
  },
})
