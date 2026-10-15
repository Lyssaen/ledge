import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Served by the daemon under /m/ (decision D12). The page entry and its assets go under assets/ (immutable, hashed).
// The service worker is built apart (vite.sw.config.ts) into a single classic script `sw.js` at the root, so its
// scope covers /m/ and it imports nothing at run time.
const build = String(Date.now());

export default defineConfig({
  define: { __BUILD__: JSON.stringify(build) },
  base: '/m/',
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 5299, strictPort: true, host: '127.0.0.1' },
  build: {
    outDir: '../../packages/ledge/dist/mobile',
    emptyOutDir: true,
    rollupOptions: {
      input: { index: 'index.html' }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}']
  }
});
