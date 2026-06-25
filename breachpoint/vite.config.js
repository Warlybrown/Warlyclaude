import { defineConfig } from 'vite';

// Vite dev server / bundler config for BREACHPOINT.
// Keep it simple: serve from project root, open on `npm run dev`.
export default defineConfig({
  root: '.',
  server: {
    host: true,
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true,
  },
});
