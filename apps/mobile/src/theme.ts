import { useSyncExternalStore } from 'react';
import { localStore } from './state/storage';

/** What the user chose: the phone's setting, or one of the two themes of @ledge/ui's tokens. */
export type ThemeChoice = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'ledge.theme';
const CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
/** The status bar and the splash take the page's background: tokens.css's --background of each theme. */
const BACKGROUND: Record<Theme, string> = { light: '#ffffff', dark: '#0a0a0a' };

const listeners = new Set<() => void>();
const darkQuery = (): MediaQueryList | null => globalThis.matchMedia?.('(prefers-color-scheme: dark)') ?? null;

export function readChoice(storage?: Storage): ThemeChoice {
  try {
    const v = localStore(storage)?.getItem(KEY);
    return CHOICES.find(c => c === v) ?? 'system';
  } catch { return 'system'; }
}

const resolve = (choice: ThemeChoice): Theme => choice !== 'system' ? choice : darkQuery()?.matches === false ? 'light' : 'dark';

let choice: ThemeChoice = 'system';
let theme: Theme = 'dark';

/** Puts the theme on the root (tokens.css reads `data-theme`), the native controls and the status bar. */
function apply(): void {
  theme = resolve(choice);
  const root = globalThis.document?.documentElement;
  if (root) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }
  globalThis.document?.querySelector('meta[name="theme-color"]')?.setAttribute('content', BACKGROUND[theme]);
  listeners.forEach(l => l());
}

/** Reads the stored choice and follows the phone's setting while the choice is « Système »; called once, before the first render. */
export function initTheme(storage?: Storage): void {
  choice = readChoice(storage);
  darkQuery()?.addEventListener?.('change', () => { if (choice === 'system') apply(); });
  apply();
}

export function setTheme(next: ThemeChoice, storage?: Storage): void {
  choice = next;
  try { localStore(storage)?.setItem(KEY, next); } catch { /* the choice holds until the page reloads */ }
  apply();
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** The theme shown now: what the mascots and bots are drawn in. */
export const useTheme = (): Theme => useSyncExternalStore(subscribe, () => theme, () => theme);
export const useThemeChoice = (): ThemeChoice => useSyncExternalStore(subscribe, () => choice, () => choice);
