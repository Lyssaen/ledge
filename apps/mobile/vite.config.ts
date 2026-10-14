import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Served by the daemon under /m/ (decision D12). The service worker is a second entry emitted at the root as
// `sw.js` so its scope can cover /m/; the page entry and its assets go under assets/ (immutable, hashed).
export default defineConfig({
  base: '/m/',
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 5299, strictPort: true, host: '127.0.0.1' },
  build: {
    outDir: '../../packages/ledge/dist/mobile',
    emptyOutDir: true,
    rollupOptions: {
      input: { index: 'index.html', sw: 'src/sw.ts' },
      output: {
        entryFileNames: chunk => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js')
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}']
  }
});
