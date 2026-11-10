// One temporary folder per test run: every mkdtemp of the suite lands in it, and the run removes it at the end, failed tests included.
// /tmp is a tmpfs on the team's machine: tests that left their folders behind filled it until writes failed (EDQUOT).
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const RUN_PREFIX = 'ledge-vitest-';
const PID_FILE = '.pid';

/** A run's folder is stale when the vitest that made it is gone (killed before its teardown, or out of memory). */
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

/** Removes the folders of earlier runs that never reached their teardown; a run still going keeps its own. */
export function sweepStaleRuns(base: string): string[] {
  const removed: string[] = [];
  for (const name of readdirSync(base)) {
    if (!name.startsWith(RUN_PREFIX)) continue;
    const dir = join(base, name);
    let pid = Number.NaN;
    try { pid = Number(readFileSync(join(dir, PID_FILE), 'utf8')); } catch { /* no pid file: not a run folder we can judge */ continue; }
    if (Number.isInteger(pid) && pid > 0 && alive(pid)) continue;
    rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  return removed;
}

/** vitest's globalSetup: TMPDIR points at this run's folder before any worker starts, so `os.tmpdir()` returns it in every test. */
export default function setup(): () => void {
  const base = tmpdir();
  sweepStaleRuns(base);
  const dir = mkdtempSync(join(base, RUN_PREFIX));
  writeFileSync(join(dir, PID_FILE), String(process.pid));
  const before = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  return () => {
    if (before === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = before;
    rmSync(dir, { recursive: true, force: true });
  };
}
