// One temporary folder per test run: every mkdtemp of the suite lands in it, and the run removes it at the end, failed tests included.
// /tmp is a tmpfs on the team's machine: tests that left their folders behind filled it until writes failed (EDQUOT).
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The runs' own root under the system temporary folder: only what is inside it, and marked as a run, is ever swept. */
export const RUNS_ROOT = 'ledge-vitest';
export const RUN_PREFIX = 'run-';
/** The file that proves a folder is a run this code made, and names the vitest that made it. */
export const RUN_MARKER = '.ledge-vitest-run';
const MARK = 'ledge-vitest-run/1';
/** The variables `os.tmpdir()` reads: TMPDIR on Linux and macOS, TEMP then TMP on Windows. */
const TMP_VARS = ['TMPDIR', 'TEMP', 'TMP'] as const;

const uid = () => process.getuid?.();
/** A real folder (not a link) that belongs to this user: anything else under the temporary folder is not ours to touch. */
const ownFolder = (path: string): boolean => {
  try {
    const s = lstatSync(path);
    return s.isDirectory() && !s.isSymbolicLink() && (uid() === undefined || s.uid === uid());
  } catch { return false; }
};

/** A run's folder is stale when the vitest that made it is gone (killed before its teardown, or out of memory). */
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

/** The pid a run's marker names, or null when the folder is not provably one of our runs. */
function runPid(dir: string): number | null {
  try {
    const m = JSON.parse(readFileSync(join(dir, RUN_MARKER), 'utf8')) as { mark?: unknown; pid?: unknown };
    return m.mark === MARK && Number.isInteger(m.pid) && (m.pid as number) > 0 ? m.pid as number : null;
  } catch { return null; }
}

/** The runs' root, made private on first use; null when the path exists and is not this user's own folder. */
export function runsRoot(base: string): string | null {
  const root = join(base, RUNS_ROOT);
  try { mkdirSync(root, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return null; }
  return ownFolder(root) ? root : null;
}

/** Removes the folders of earlier runs that never reached their teardown, inside `root` only, and only those whose marker proves
 *  they are runs and names a vitest that is gone. A folder without a valid marker, a link, or another user's folder stays. */
export function sweepStaleRuns(root: string): string[] {
  const removed: string[] = [];
  for (const name of readdirSync(root)) {
    if (!name.startsWith(RUN_PREFIX)) continue;
    const dir = join(root, name);
    if (!ownFolder(dir)) continue;
    const pid = runPid(dir);
    if (pid === null || alive(pid)) continue;
    rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  return removed;
}

/** vitest's globalSetup: the temporary variables point at this run's folder before any worker starts, so `os.tmpdir()` returns it in
 *  every test and in every process a test starts. */
export default function setup(): () => void {
  const root = runsRoot(tmpdir());
  // A root that is not provably ours is neither swept nor used: the run then sits beside it, and is still removed at its end.
  if (root) sweepStaleRuns(root);
  const dir = mkdtempSync(join(root ?? tmpdir(), root ? RUN_PREFIX : `${RUNS_ROOT}-${RUN_PREFIX}`));
  writeFileSync(join(dir, RUN_MARKER), JSON.stringify({ mark: MARK, pid: process.pid }));
  const before = TMP_VARS.map(k => [k, process.env[k]] as const);
  for (const k of TMP_VARS) process.env[k] = dir;
  return () => {
    for (const [k, v] of before) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true });
  };
}
