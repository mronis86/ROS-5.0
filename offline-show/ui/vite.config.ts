import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const uiRoot = path.resolve(__dirname);

/** Offline UI only — no imports from repo src/pages or src/services */
export default defineConfig({
  root: uiRoot,
  plugins: [react()],
  publicDir: false,
  css: {
    postcss: path.join(uiRoot, 'postcss.config.cjs'),
  },
  server: {
    host: '0.0.0.0',
  },
  build: {
    outDir: path.resolve(uiRoot, 'dist'),
    emptyOutDir: true,
  },
});
