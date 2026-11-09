import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
/** A root icon of public/, as the manifest and index.html cite it. */
const ICON = /^\/((?:icon|favicon)[\w-]*\.(?:png|svg))$/;

/** `/icon-192.png` → `/icon-192.png?v=<8 hex of its bytes>`; any other URL as is. */
function versioned(url: string): string {
  const name = ICON.exec(url)?.[1];
  if (name === undefined) return url;
  return `${url}?v=${createHash('sha256').update(readFileSync(path.join(PUBLIC, name))).digest('hex').slice(0, 8)}`;
}

/**
 * The icons' URLs carry a hash of their bytes. An installed app redraws its icon only when the URLs of the manifest
 * change (Chrome compares them when it checks the manifest again), so a new drawing under the same name would stay
 * unseen until the app is installed again. The worker and the relay match on the path alone: the query is free.
 */
const iconVersions = (): Plugin => ({
  name: 'ledge-icon-versions',
  transformIndexHtml: (html) => html.replace(/(<link[^>]*\bhref=")([^"]+)(")/g, (_, a: string, url: string, b: string) => a + versioned(url) + b),
  writeBundle(opts) {
    const file = path.join(opts.dir ?? path.join(ROOT, 'dist'), 'manifest.webmanifest');
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as { icons: { src: string }[] };
    for (const icon of manifest.icons) icon.src = versioned(icon.src);
    writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  }
});

// The relay serves the built files at the root of its own origin.
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss(), iconVersions()],
  clearScreen: false,
  server: { port: 5299, strictPort: true, host: '127.0.0.1' },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['test/**/*.test.{ts,tsx}']
  }
});
