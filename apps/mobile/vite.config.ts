import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The relay serves the built files at the root of its own origin.
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 5299, strictPort: true, host: '127.0.0.1' },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['test/**/*.test.{ts,tsx}']
  }
});
