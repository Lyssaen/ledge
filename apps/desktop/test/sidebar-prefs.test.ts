import { afterEach, expect, it } from 'vitest';
import { loadSidebarPrefs, saveSidebarPrefs, SIDEBAR_KEY } from '../src/shell/sidebar/prefs';

afterEach(() => localStorage.removeItem(SIDEBAR_KEY));

it('defaults to hiding finished sessions, not dense', () => {
  expect(loadSidebarPrefs()).toEqual({ hideDone: true, dense: false });
});

it('round-trips and survives a broken value', () => {
  saveSidebarPrefs({ hideDone: false, dense: true });
  expect(loadSidebarPrefs()).toEqual({ hideDone: false, dense: true });
  localStorage.setItem(SIDEBAR_KEY, '{');
  expect(loadSidebarPrefs()).toEqual({ hideDone: true, dense: false });
});
