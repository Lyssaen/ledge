import { SEMVER } from '@ledge/protocol';

/** The GitHub Releases of Ledge: every version's notes, those the updater's manifest no longer carries included. */
export const RELEASES_URL = 'https://github.com/Lyssaen/ledge/releases';
export const releaseUrl = (version: string): string => `${RELEASES_URL}/tag/v${version}`;

/** The notes of the version being installed, kept for the next launch (the manifest of an up-to-date app carries none). */
const NOTES_KEY = 'desktop.update.notes';
/** The last version whose notes were offered (or a first install's): the « What's new » shows once per version. */
const SEEN_KEY = 'desktop.update.seen';
/** The version an install started from, noted by the updater. */
const FROM_KEY = 'desktop.update.from';

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* in-memory only */ } };

export function keepNotes(version: string, notes: string): void {
  if (notes.trim()) set(NOTES_KEY, JSON.stringify({ version, notes }));
}

/** The notes of `version` kept at its install, or null (none, empty, or another version's). */
export function installedNotes(version: string | null): string | null {
  if (!version) return null;
  try {
    const kept = JSON.parse(get(NOTES_KEY) ?? 'null') as { version?: unknown; notes?: unknown } | null;
    return kept?.version === version && typeof kept.notes === 'string' && kept.notes.trim() ? kept.notes : null;
  } catch { return null; }
}

/** Whether going from `from` to `to` passes over a release (whose notes the manifest no longer carries). */
export function skipsVersions(from: string, to: string): boolean {
  if (!SEMVER.test(from) || !SEMVER.test(to)) return false;
  const [a, b, c] = from.split('.').map(Number) as [number, number, number];
  const next = [`${a}.${b}.${c + 1}`, `${a}.${b + 1}.0`, `${a + 1}.0.0`];
  return to !== from && !next.includes(to);
}

export interface WhatsNew { version: string; notes: string; from: string | null; skipped: boolean }

/** At start-up: the installed version's notes the first time it runs after an update, once; null otherwise. A first install
 *  (nothing seen, no install noted) only remembers its version. */
export function takeWhatsNew(app: string | null): WhatsNew | null {
  if (!app) return null;
  const seen = get(SEEN_KEY);
  if (seen === app) return null;
  set(SEEN_KEY, app);
  const from = get(FROM_KEY);
  const before = seen ?? (from !== app ? from : null);
  const notes = installedNotes(app);
  if (!before || !notes) return null;
  return { version: app, notes, from: before, skipped: skipsVersions(before, app) };
}
