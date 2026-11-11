// The run's temporary folder (test/global-tmpdir.ts): tests write under it, and a run killed before its teardown is swept by the next,
// but only when it is provably one of our runs.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeRun, RUN_MARKER, RUN_PREFIX, RUNS_ROOT, runsRoot, sweepStaleRuns } from './global-tmpdir.js';

const deadPid = () => Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
const mark = (pid: number) => JSON.stringify({ mark: 'ledge-vitest-run/1', pid });

describe('the run\'s temporary folder', () => {
  it('every tmpdir() of a test, and of a process it starts, is inside this run\'s marked folder', () => {
    // In the runs' root, or beside it when that root is not this user's own folder.
    const inRoot = basename(tmpdir()).startsWith(RUN_PREFIX) && basename(dirname(tmpdir())) === RUNS_ROOT;
    expect(inRoot || basename(tmpdir()).startsWith(`${RUNS_ROOT}-${RUN_PREFIX}`)).toBe(true);
    expect(existsSync(join(tmpdir(), RUN_MARKER))).toBe(true);
    // Windows reads TEMP then TMP: the three point at the run.
    expect([process.env.TMPDIR, process.env.TEMP, process.env.TMP]).toEqual([tmpdir(), tmpdir(), tmpdir()]);
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("node:os").tmpdir())'], { encoding: 'utf8' });
    expect(child.stdout).toBe(tmpdir());
  });

  it('only a marked run whose vitest is gone is removed; a live run, a bad or missing marker, a link or another name stay', () => {
    const root = runsRoot(mkdtempSync(join(tmpdir(), 'sweep-')))!;
    const dead = deadPid();
    const folder = (name: string, marker?: string) => { const d = join(root, name); mkdirSync(d); if (marker !== undefined) writeFileSync(join(d, RUN_MARKER), marker); writeFileSync(join(d, 'data'), 'x'); return d; };
    const gone = folder(`${RUN_PREFIX}gone`, mark(dead));
    const live = folder(`${RUN_PREFIX}live`, mark(process.pid));
    const none = folder(`${RUN_PREFIX}none`);
    const bad = folder(`${RUN_PREFIX}bad`, 'invalid');
    const oldPid = folder(`${RUN_PREFIX}oldpid`); writeFileSync(join(oldPid, '.pid'), String(dead));
    const foreign = folder(`${RUN_PREFIX}foreign`, JSON.stringify({ pid: dead }));
    const other = folder('notes', mark(dead));
    const target = folder('elsewhere-target', mark(dead));
    const link = join(root, `${RUN_PREFIX}link`); symlinkSync(target, link);
    expect(sweepStaleRuns(root)).toEqual([gone]);
    expect([gone, live, none, bad, oldPid, foreign, other, target, link].map(existsSync)).toEqual([false, true, true, true, true, true, true, true, true]);
  });

  it('a root that is a link, or not a folder, is not ours: not used', () => {
    const base = mkdtempSync(join(tmpdir(), 'root-'));
    const real = mkdtempSync(join(tmpdir(), 'real-'));
    symlinkSync(real, join(base, RUNS_ROOT));
    expect(runsRoot(base)).toBeNull();
    const file = mkdtempSync(join(tmpdir(), 'root-'));
    writeFileSync(join(file, RUNS_ROOT), 'x');
    expect(runsRoot(file)).toBeNull();
    expect(runsRoot(mkdtempSync(join(tmpdir(), 'root-')))).not.toBeNull();
  });

  it('a run sits in the root when it is ours, and beside it, marked, when it is not; what is there is left alone', () => {
    const ok = mkdtempSync(join(tmpdir(), 'run-base-'));
    const inRoot = makeRun(ok);
    expect(dirname(inRoot)).toBe(join(ok, RUNS_ROOT));
    expect(basename(inRoot).startsWith(RUN_PREFIX)).toBe(true);
    const taken = mkdtempSync(join(tmpdir(), 'run-base-'));
    writeFileSync(join(taken, RUNS_ROOT), 'not ours');
    const beside = makeRun(taken);
    expect(dirname(beside)).toBe(taken);
    expect(basename(beside).startsWith(`${RUNS_ROOT}-${RUN_PREFIX}`)).toBe(true);
    expect(existsSync(join(beside, RUN_MARKER))).toBe(true);
    expect(readFileSync(join(taken, RUNS_ROOT), 'utf8')).toBe('not ours');
  });
});
