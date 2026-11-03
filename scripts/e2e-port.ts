import { createHash } from 'node:crypto';

/**
 * The port an app's Playwright run serves Vite on, its own per worktree: two trees running their e2e at once no longer share one
 * server (with `reuseExistingServer`, one tree tested the other's app). `LEDGE_E2E_PORT` forces it; otherwise it is `base` plus a
 * number drawn from the app's folder (the worktree), stable from run to run. Each app has its own `base`, 500 ports wide.
 */
export function e2ePort(base: number, folder = process.cwd()): number {
  const forced = Number(process.env.LEDGE_E2E_PORT);
  if (Number.isInteger(forced) && forced > 0) return forced;
  return base + (createHash('sha1').update(folder).digest().readUInt32BE(0) % 500);
}

/** A server already on the port is reused only when asked (`LEDGE_E2E_REUSE=1`): one left by another tree is never taken for this
 *  tree's; `--strictPort` then fails loudly instead. */
export const e2eReuse = (): boolean => process.env.LEDGE_E2E_REUSE === '1';
