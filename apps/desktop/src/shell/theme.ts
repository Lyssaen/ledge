import { useEffect, useSyncExternalStore } from 'react';
import { applyAccent, loadAccent, parseAccent, saveAccent } from '@ledge/ui/accent';

const KEY = 'desktop.theme';
export type Theme = 'dark' | 'light';
export const THEMES: readonly Theme[] = ['dark', 'light'];

export function loadTheme(): Theme {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

// One store for the theme and the accent: the settings change them, every mascot and the root follow at once (lot 7).
let theme = loadTheme();
let accent = loadAccent('desktop');
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function setTheme(next: Theme): void {
  theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* storage unavailable: the in-memory value still applies */ }
  emit();
}
/** `null` goes back to the factory coral and removes `desktop.accent`; anything but #rrggbb is ignored. */
export function setAccent(hex: string | null): void {
  const parsed = hex === null ? null : parseAccent(hex);
  if (hex !== null && parsed === null) return;
  saveAccent(parsed, 'desktop');
  accent = parsed;
  emit();
}

/** The Desktop theme (`desktop.theme`, dark by default). */
export function useTheme(): Theme { return useSyncExternalStore(subscribe, () => theme, () => theme); }
/** The chosen accent (`desktop.accent`), null for the factory coral. */
export function useAccent(): string | null { return useSyncExternalStore(subscribe, () => accent, () => accent); }
/** Mounted once by the App: mirrors the theme on the root element for the shared tokens and paints the accent for it. */
export function useAppearance(): void {
  const t = useTheme(); const a = useAccent();
  useEffect(() => { document.documentElement.dataset.theme = t; applyAccent(a, t); }, [t, a]);
}
/** Test hook: the next read reloads from storage. */
export function resetAppearanceForTests(): void { theme = loadTheme(); accent = loadAccent('desktop'); emit(); }
