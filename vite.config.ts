import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Listen on all network interfaces (allows local network access)
    port: 3003,
    open: true
  },
  build: {
    outDir: 'dist'
  }
})

