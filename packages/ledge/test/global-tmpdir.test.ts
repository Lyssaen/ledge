// The run's temporary folder (test/global-tmpdir.ts): tests write under it, and a run killed before its teardown is swept by the next.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RUN_PREFIX, sweepStaleRuns } from './global-tmpdir.js';

describe('the run\'s temporary folder', () => {
  it('every tmpdir() of a test, and of a process it starts, is inside this run\'s folder', () => {
    expect(basename(tmpdir()).startsWith(RUN_PREFIX)).toBe(true);
    expect(existsSync(join(tmpdir(), '.pid'))).toBe(true);
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("node:os").tmpdir())'], { encoding: 'utf8' });
    expect(child.stdout).toBe(tmpdir());
  });

  it('a folder whose vitest is gone is removed; one whose vitest still runs, or that is not a run folder, stays', () => {
    const base = mkdtempSync(join(tmpdir(), 'sweep-'));
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
    const run = (name: string, pid?: string) => { const d = join(base, name); mkdirSync(d); if (pid !== undefined) writeFileSync(join(d, '.pid'), pid); return d; };
    const gone = run(`${RUN_PREFIX}gone`, dead);
    const live = run(`${RUN_PREFIX}live`, String(process.pid));
    const odd = run(`${RUN_PREFIX}nopid`);
    const other = run('ledge-other', dead);
    expect(sweepStaleRuns(base)).toEqual([gone]);
    expect([gone, live, odd, other].map(existsSync)).toEqual([false, true, true, true]);
    expect(dirname(gone)).toBe(base);
  });
});
