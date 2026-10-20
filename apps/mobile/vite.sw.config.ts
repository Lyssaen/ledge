import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// The service worker, built after the app into the same dist: `sw.js` carries the hash of every file the app build
// wrote (`__MANIFEST__`) and the version of packages/ledge (`__VERSION__`).
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VERSION = (JSON.parse(readFileSync(path.join(ROOT, '../../packages/ledge/package.json'), 'utf8')) as { version: string }).version;

/** Every file of `dir` but the worker and build.json, as `/path` and the SHA-256 of its bytes. */
function manifestOf(dir: string): { path: string; sha256: string }[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => '/' + path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .filter((p) => p !== '/sw.js' && p !== '/build.json')
    .sort()
    .map((p) => ({ path: p, sha256: createHash('sha256').update(readFileSync(path.join(dir, p))).digest('hex') }));
}

/** The manifest of the outDir in use, `--outDir` included. */
const pinned = (): Plugin => ({
  name: 'ledge-sw-manifest',
  config(config) {
    const outDir = path.resolve(config.root ?? ROOT, config.build?.outDir ?? 'dist');
    return { define: { __MANIFEST__: JSON.stringify(manifestOf(outDir)), __VERSION__: JSON.stringify(VERSION) } };
  }
});

export default defineConfig({
  root: ROOT,
  publicDir: false,
  clearScreen: false,
  plugins: [pinned()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: path.join(ROOT, 'src/sw/sw.ts'), formats: ['iife'], name: 'ledgeSw', fileName: () => 'sw.js' }
  }
});
