import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailableUpdate } from '../src/update/bridge';
import { createUpdater, UPDATE_EVERY_MS, updateReady } from '../src/update/store';

function release(version = '0.6.0') {
  let finish!: () => void; let fail!: (e: Error) => void;
  const done = new Promise<void>((res, rej) => { finish = res; fail = rej; });
  const u: AvailableUpdate = { version, notes: 'Fixes', downloadAndInstall: vi.fn(async (progress: (d: number, t: number | null) => void) => { progress(50, 100); await done; }) };
  return { u, finish, fail };
}
function deps(check: () => Promise<AvailableUpdate | null>) {
  const ticks: Array<() => void> = [];
  const d = { check: vi.fn(check), relaunch: vi.fn(async () => {}), version: vi.fn(async () => '0.5.0'), now: () => 42, every: vi.fn((fn: () => void, ms: number) => { expect(ms).toBe(UPDATE_EVERY_MS); ticks.push(fn); return () => {}; }) };
  return { d, ticks };
}

beforeEach(() => localStorage.clear());

describe('nothing is installed without a click (Review Focus 5)', () => {
  it('the start-up and the 6-hour checks only check', async () => {
    const r = release();
    const { d, ticks } = deps(async () => r.u);
    localStorage.setItem('desktop.update.attempted', '0.6.0');
    const up = createUpdater(d);
    await up.start();
    expect(localStorage.getItem('desktop.update.attempted')).toBeNull();
    expect(up.get().phase).toEqual({ kind: 'available', version: '0.6.0', notes: 'Fixes' });
    expect(updateReady(up.get())).toBe(true);
    expect(localStorage.getItem('desktop.update.checkedAt')).toBe('42');
    ticks[0]!(); await vi.waitFor(() => expect(d.check).toHaveBeenCalledTimes(2));
    expect(r.u.downloadAndInstall).not.toHaveBeenCalled();
    expect(d.relaunch).not.toHaveBeenCalled();
  });

  it('automatic checks off: no check at start nor every 6 hours, a manual check still works', async () => {
    localStorage.setItem('desktop.update.auto', '0');
    const { d, ticks } = deps(async () => null);
    const up = createUpdater(d);
    await up.start();
    ticks.forEach(t => t());
    expect(d.check).not.toHaveBeenCalled();
    expect(up.get().auto).toBe(false);
    await up.check();
    expect(up.get().phase).toEqual({ kind: 'current' });
  });

  it('a double click downloads once, notes the version it came from, then relaunches', async () => {
    const r = release();
    const { d } = deps(async () => r.u);
    const up = createUpdater(d);
    await up.start();
    const a = up.install(); const b = up.install();
    expect(up.get().phase).toEqual({ kind: 'installing', version: '0.6.0', percent: 50 });
    r.finish(); await Promise.all([a, b]);
    expect(r.u.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('desktop.update.from')).toBe('0.5.0');
    expect(d.relaunch).toHaveBeenCalledTimes(1);
  });

  it('a check asked during the install is ignored', async () => {
    const r = release();
    const { d, ticks } = deps(async () => r.u);
    const up = createUpdater(d);
    await up.start();
    const installing = up.install();
    await up.check(); ticks[0]!();
    expect(d.check).toHaveBeenCalledTimes(1);
    expect(up.get().phase.kind).toBe('installing');
    r.finish(); await installing;
  });
});

describe('failures are shown, and can be retried', () => {
  it('no network: the check fails, the next one succeeds', async () => {
    const { d } = deps(async () => { throw new Error('offline'); });
    const up = createUpdater(d);
    await up.start();
    expect(up.get().phase).toEqual({ kind: 'failed', during: 'check' });
    expect(up.get().checkedAt).toBeNull();
    d.check.mockResolvedValueOnce(null);
    await up.check();
    expect(up.get().phase).toEqual({ kind: 'current' });
  });

  it('a broken download: failed, then the same version installs on the next click', async () => {
    const r = release();
    const { d } = deps(async () => r.u);
    const up = createUpdater(d);
    await up.start();
    const first = up.install(); r.fail(new Error('broken')); await first;
    expect(up.get().phase).toEqual({ kind: 'failed', during: 'install' });
    expect(d.relaunch).not.toHaveBeenCalled();
    vi.mocked(r.u.downloadAndInstall).mockResolvedValueOnce(undefined);
    await up.install();
    expect(d.relaunch).toHaveBeenCalledTimes(1);
  });

  it('turning automatic checks back on checks at once and is remembered', async () => {
    localStorage.setItem('desktop.update.auto', '0');
    const { d } = deps(async () => null);
    const up = createUpdater(d);
    await up.start();
    up.setAuto(true);
    await vi.waitFor(() => expect(d.check).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('desktop.update.auto')).toBe('1');
    up.setAuto(false);
    expect(localStorage.getItem('desktop.update.auto')).toBe('0');
  });
});

describe('a recheck keeps a previously found update (M1)', () => {
  it('in progress or failed: still available; up to date: cleared', async () => {
    const r = release();
    let mode: 'found' | 'fail' | 'none' = 'found';
    let gate: Promise<void> | null = null;
    const { d } = deps(async () => { if (gate) await gate; if (mode === 'fail') throw new Error('offline'); return mode === 'found' ? r.u : null; });
    const up = createUpdater(d);
    await up.start();
    const avail = { kind: 'available', version: '0.6.0', notes: 'Fixes' };
    expect(up.get().phase).toEqual(avail);
    let open!: () => void; gate = new Promise<void>(res => { open = res; });
    mode = 'fail';
    const p = up.check();
    expect(up.get().phase).toEqual(avail);
    open(); await p;
    expect(up.get().phase).toEqual(avail);
    expect(updateReady(up.get())).toBe(true);
    gate = null; mode = 'none';
    await up.check();
    expect(up.get().phase).toEqual({ kind: 'current' });
  });
});

describe('an install clicked during a recheck (round 2)', () => {
  it('the recheck result does not bring the button back nor replace the held update', async () => {
    const r = release();
    let gate: Promise<void> | null = null;
    const { d } = deps(async () => { if (gate) await gate; return r.u; });
    const up = createUpdater(d);
    await up.start();
    let open!: () => void; gate = new Promise<void>(res => { open = res; });
    const p = up.check();
    const i = up.install();
    expect(up.get().phase.kind).toBe('installing');
    open(); await p;
    expect(up.get().phase.kind).toBe('installing');
    await up.install();
    r.finish(); await i;
    expect(r.u.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(d.relaunch).toHaveBeenCalledTimes(1);
  });
});
