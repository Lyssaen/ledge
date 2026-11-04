import { describe, expect, it } from 'vitest';
import { canSymlink, isWindows, linuxOnly, skipName } from './platform.js';

// The suite runs on Windows too (spec 2026-11-03 §4.2.8): what cannot run there is skipped by name, with its reason.
describe('test/platform', () => {
  it('a skipped test says why in its name', () => {
    expect(skipName('starts tmux', 'tmux')).toBe('starts tmux [skipped on Windows: tmux]');
  });
  it('knows where it runs', () => {
    expect(isWindows).toBe(process.platform === 'win32');
  });
  if (!isWindows) {
    it('Linux runs every guarded test and can make links', () => { expect(canSymlink).toBe(true); });
    let ran = false;
    linuxOnly('tmux')('a linuxOnly test runs on Linux', () => { ran = true; });
    it('…and it did', () => { expect(ran).toBe(true); });
  }
});
