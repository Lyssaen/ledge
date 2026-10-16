import { defineConfig } from 'vite';

// The service worker alone, as one self-contained classic script (a registration without `type: 'module'` cannot import).
export default defineConfig({
  define: { __BUILD__: JSON.stringify(String(Date.now())) },
  publicDir: false,
  build: {
    outDir: '../../packages/ledge/dist/mobile',
    emptyOutDir: false,
    lib: { entry: 'src/sw.ts', formats: ['iife'], name: 'ledgeSw', fileName: () => 'sw.js' }
  }
});
