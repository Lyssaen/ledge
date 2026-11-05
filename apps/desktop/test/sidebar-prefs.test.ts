import { afterEach, expect, it } from 'vitest';
import { loadSidebarPrefs, saveSidebarPrefs, SIDEBAR_KEY } from '../src/shell/sidebar/prefs';

afterEach(() => localStorage.removeItem(SIDEBAR_KEY));

it('defaults to hiding finished sessions, not dense, grouped by branch', () => {
  expect(loadSidebarPrefs()).toEqual({ hideDone: true, dense: false, byBranch: true });
});

it('round-trips and survives a broken value', () => {
  saveSidebarPrefs({ hideDone: false, dense: true, byBranch: false });
  expect(loadSidebarPrefs()).toEqual({ hideDone: false, dense: true, byBranch: false });
  localStorage.setItem(SIDEBAR_KEY, '{');
  expect(loadSidebarPrefs()).toEqual({ hideDone: true, dense: false, byBranch: true });
});

it('reads a preference saved before byBranch existed as grouped by branch', () => {
  localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ hideDone: false, dense: true }));
  expect(loadSidebarPrefs()).toEqual({ hideDone: false, dense: true, byBranch: true });
});
