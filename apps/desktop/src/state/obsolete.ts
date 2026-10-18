/** Keys of the Team / Meeting screens (feat/desktop lots 3 to 7): their shapes are gone, and a later screen may reuse a name. */
export const OBSOLETE_KEYS: readonly string[] = ['desktop.view', 'desktop.selected', 'desktop.panel', 'desktop.drafts', 'desktop.thread', 'desktop.launch'];

/** Removes them once at start-up; every other `desktop.*` key (language, appearance, sounds, updates…) stays. */
export function purgeObsolete(): void {
  for (const key of OBSOLETE_KEYS) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable: nothing to purge */ }
  }
}
