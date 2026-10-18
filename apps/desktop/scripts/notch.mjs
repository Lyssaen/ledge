import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Runs the overlay's vite (`build` or `dev`) with its base under /notch/, where Desktop serves it. An env var set on
 * the command line (`FOO=1 cmd`) does not work in PowerShell, hence this script rather than a package.json one-liner.
 */
const mode = process.argv[2];
if (mode !== 'build' && mode !== 'dev') {
  console.error('usage: node scripts/notch.mjs build|dev');
  process.exit(2);
}
const overlay = fileURLToPath(new URL('../../overlay', import.meta.url));
const res = spawnSync('pnpm', ['exec', 'vite', ...(mode === 'build' ? ['build'] : [])], {
  cwd: overlay,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, LEDGE_NOTCH_BASE: '/notch/' }
});
process.exit(res.status ?? 1);
