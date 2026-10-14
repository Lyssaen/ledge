import { describe, it, expect, beforeEach, vi } from 'vitest';
import { updateAtStartup } from '../src/update/startup';

const release = (version = '0.6.0') => {
  const install = vi.fn(async (p: (d: number, t: number | null) => void) => { p(5, 10); p(10, 10); });
  return { install, check: vi.fn(async () => ({ version, notes: '- One', downloadAndInstall: install })) };
};
beforeEach(() => localStorage.clear());

describe('updateAtStartup', () => {
  it('installs a newer release and relaunches, remembering the check and the version it came from', async () => {
    const { check, install } = release(); const relaunch = vi.fn(async () => {});
    expect(await updateAtStartup({ check, relaunch, version: async () => '0.5.2', now: () => 1234 })).toBe('installed');
    expect(check).toHaveBeenCalledOnce(); expect(install).toHaveBeenCalledOnce(); expect(relaunch).toHaveBeenCalledOnce();
    expect(localStorage.getItem('desktop.update.checkedAt')).toBe('1234');
    expect(localStorage.getItem('desktop.update.from')).toBe('0.5.2');
  });
  it('does nothing more when no release is newer', async () => {
    const relaunch = vi.fn(async () => {});
    expect(await updateAtStartup({ check: async () => null, relaunch, version: async () => '0.5.2', now: () => 99 })).toBe('none');
    expect(relaunch).not.toHaveBeenCalled();
    expect(localStorage.getItem('desktop.update.checkedAt')).toBe('99');
    expect(localStorage.getItem('desktop.update.from')).toBeNull();
  });
  it('never relaunches when the download fails, and a failed check is swallowed', async () => {
    const relaunch = vi.fn(async () => {});
    const broken = { version: '0.6.0', notes: '', downloadAndInstall: vi.fn(async () => { throw new Error('network'); }) };
    expect(await updateAtStartup({ check: async () => broken, relaunch, version: async () => '0.5.2' })).toBe('failed');
    expect(await updateAtStartup({ check: async () => { throw new Error('offline'); }, relaunch, version: async () => '0.5.2' })).toBe('failed');
    expect(relaunch).not.toHaveBeenCalled();
    expect(localStorage.getItem('desktop.update.checkedAt')).not.toBeNull(); // the first check did answer
  });
  it('is skipped when automatic checks are off', async () => {
    localStorage.setItem('desktop.update.auto', '0');
    const { check } = release();
    expect(await updateAtStartup({ check, relaunch: async () => {}, version: async () => '0.5.2' })).toBe('skipped');
    expect(check).not.toHaveBeenCalled();
  });
  it('outside the app (browser, tests) the real bridge finds nothing to install', async () => {
    expect(await updateAtStartup()).toBe('none');
  });
  it('remembers the version it installs and does not reinstall it when the binary still is not that version', async () => {
    const { check, install } = release('0.6.0'); const relaunch = vi.fn(async () => {});
    expect(await updateAtStartup({ check, relaunch, version: async () => '0.5.2' })).toBe('installed');
    expect(localStorage.getItem('desktop.update.attempted')).toBe('0.6.0');
    expect(await updateAtStartup({ check, relaunch, version: async () => '0.5.2' })).toBe('skipped');
    expect(install).toHaveBeenCalledOnce(); expect(relaunch).toHaveBeenCalledOnce();
  });
  it('still installs a newer release than the one attempted before', async () => {
    localStorage.setItem('desktop.update.attempted', '0.6.0');
    const { check, install } = release('0.7.0');
    expect(await updateAtStartup({ check, relaunch: async () => {}, version: async () => '0.5.2' })).toBe('installed');
    expect(install).toHaveBeenCalledOnce();
  });
  it('records the attempt before downloading, so a crash during install is not retried either', async () => {
    const broken = { version: '0.6.0', notes: '', downloadAndInstall: vi.fn(async () => { throw new Error('network'); }) };
    expect(await updateAtStartup({ check: async () => broken, relaunch: async () => {}, version: async () => '0.5.2' })).toBe('failed');
    expect(localStorage.getItem('desktop.update.attempted')).toBe('0.6.0');
  });
});
