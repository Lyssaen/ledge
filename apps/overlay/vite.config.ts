import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Desktop serves the notch under /notch/ (LEDGE_NOTCH_BASE, set by its scripts); alone, the overlay stays at the root.
  base: process.env.LEDGE_NOTCH_BASE ?? '/',
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    env: { VITE_LEDGE_MOTION: '0' }
  }
});
