import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  esbuild: {
    // Prevent jsxDEV from embedding absolute file paths (fileName) in production bundles.
    jsxDev: mode === 'development',
  },
  server: {
    host: '0.0.0.0', // Listen on all network interfaces (allows access from other computers)
    port: 3003,
    strictPort: true, // Fail if 3003 is in use instead of switching to 3004
    open: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // Never publish source maps — they embed absolute dev machine paths (IT/security).
    sourcemap: false,
    minify: 'esbuild',
  },
}))

