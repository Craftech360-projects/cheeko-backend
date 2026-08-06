import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Production stacks are otherwise unreadable minified frames.
  build: {
    sourcemap: true,
  },
  server: {
    proxy: {
      '/toy': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
    },
  },
})
