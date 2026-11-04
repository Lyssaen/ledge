import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';

/**
 * The daemon's suite runs on Windows too (spec 2026-11-03 §4.2.8). What cannot run there is skipped through these guards
 * only, each with its reason, which the skipped test's name carries. On Linux they change nothing.
 *   tmux              the agents' panes are tmux sessions (Windows uses ConPTY panes, tested by panes-*.test.ts)
 *   posix-signals     SIGTERM/SIGKILL semantics Windows does not have
 *   posix-modes       file modes (0600…) Windows does not keep
 *   posix-names       file names Windows changes or refuses (a trailing space or dot)
 *   symlinks          creating links needs Developer Mode or admin rights on Windows (CI runners have them)
 *   hidden-in-native  a feature outside native Windows' first round (spec §1): its Windows paths wait for its round
 *   linux-flow        the test pins a Linux-only flow (systemd, a login shell) the code takes no platform for
 */
export type SkipReason = 'tmux' | 'posix-signals' | 'posix-modes' | 'posix-names' | 'symlinks' | 'hidden-in-native' | 'linux-flow';

export const isWindows = process.platform === 'win32';

export const skipName = (name: string, reason: SkipReason): string => `${name} [skipped on Windows: ${reason}]`;

/** `it`, skipped on Windows for `reason`. */
export function linuxOnly(reason: SkipReason): typeof it {
  if (!isWindows) return it;
  return ((name: string, ...rest: unknown[]) => (it.skip as (...a: unknown[]) => void)(skipName(name, reason), ...rest)) as unknown as typeof it;
}

/** `describe`, skipped on Windows for `reason`. */
export function linuxOnlySuite(reason: SkipReason): typeof describe {
  if (!isWindows) return describe;
  return ((name: string, ...rest: unknown[]) => (describe.skip as (...a: unknown[]) => void)(skipName(name, reason), ...rest)) as unknown as typeof describe;
}

/** Whether this machine lets the tests make links (probed once, in the OS temp folder, then removed). */
export const canSymlink: boolean = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-link-probe-'));
  try { writeFileSync(join(dir, 'a'), ''); symlinkSync(join(dir, 'a'), join(dir, 'b')); return true; } catch { return false; } finally { rmSync(dir, { recursive: true, force: true }); }
})();

/** `it`, skipped where links cannot be made (a Windows PC without Developer Mode). */
export const needsSymlinks: typeof it = canSymlink ? it : (((name: string, ...rest: unknown[]) => (it.skip as (...a: unknown[]) => void)(`${name} [skipped: no symlinks here]`, ...rest)) as unknown as typeof it);
