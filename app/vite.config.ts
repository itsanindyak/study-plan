import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // don't silently drift to 5174 — the worker's CORS allowlist is origin+port
    // specific, and a drifted port makes every cloud request fail
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
