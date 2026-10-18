import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,  // the daemon allows this origin (spec §5.4)
    // The notch's page lives under /notch/ in the build; in dev the overlay's server (built with that base) answers for it.
    proxy: { '/notch/': { target: 'http://localhost:1420', ws: true } }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    env: { VITE_LEDGE_MOTION: '0' },
    // The suite drives the whole app in jsdom (a fake daemon, real timers): on a loaded machine a test takes a few seconds, and
    // one worker per core makes them fight for it. Half the cores and a 15 s ceiling keep the default `pnpm test` green.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    maxWorkers: '50%'
  }
});
