import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Alternative config using esbuild instead of terser
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3003,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild', // Use esbuild instead of terser
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          utils: ['moment', 'socket.io-client']
        }
      }
    }
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom']
  }
})
