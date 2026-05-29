import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..');
const uiRoot = path.resolve(__dirname);

/** Offline UI only — no imports from repo src/pages or src/services */
export default defineConfig({
  root: uiRoot,
  plugins: [react()],
  publicDir: false,
  css: {
    postcss: path.join(uiRoot, 'postcss.config.cjs'),
  },
  resolve: {
    alias: {
      react: path.join(repoRoot, 'node_modules/react'),
      'react-dom': path.join(repoRoot, 'node_modules/react-dom'),
      'react-router-dom': path.join(repoRoot, 'node_modules/react-router-dom'),
      'socket.io-client': path.join(repoRoot, 'node_modules/socket.io-client'),
    },
  },
  server: {
    host: '0.0.0.0',
  },
  build: {
    outDir: path.resolve(uiRoot, 'dist'),
    emptyOutDir: true,
  },
});
