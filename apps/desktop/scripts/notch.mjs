import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the overlay's vite (`build` or `dev`) with its base under /notch/, where Desktop serves it. An env var set on
 * the command line (`FOO=1 cmd`) does not work in PowerShell, hence this script rather than a package.json one-liner.
 * The build goes to dist-notch: the overlay's own dist stays untouched, so `pnpm -r build` has no two builds writing it.
 */
const mode = process.argv[2];
if (mode !== 'build' && mode !== 'dev') {
  console.error('usage: node scripts/notch.mjs build|dev');
  process.exit(2);
}
const overlay = fileURLToPath(new URL('../../overlay', import.meta.url));
// vite's `exports` hides bin/vite.js, so find the package by its package.json and take the bin beside it.
const vite = join(dirname(createRequire(`${overlay}/package.json`).resolve('vite/package.json')), 'bin', 'vite.js');
const args = mode === 'build' ? ['build', '--outDir', 'dist-notch', '--emptyOutDir'] : [];
const res = spawnSync(process.execPath, [vite, ...args], {
  cwd: overlay,
  stdio: 'inherit',
  env: { ...process.env, LEDGE_NOTCH_BASE: '/notch/' }
});
process.exit(res.status ?? 1);
