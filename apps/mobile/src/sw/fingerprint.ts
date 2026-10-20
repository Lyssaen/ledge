// The build's fingerprint: one hash over every file the app is made of, so two phones can tell they run the same app.
import { groupFingerprint } from '../model/fingerprint';

/** A file of the build: its path from the site's root (`/index.html`) and the SHA-256 of its bytes, in hex. */
export type FileHash = { path: string; sha256: string };

export const hexOf = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The SHA-256 (hex) of the lines `<path> <sha256>\n` sorted by path. Over every file of `dist` but `build.json`,
 * `sw.js` included; scripts/fingerprint.mjs computes the same at build time.
 */
export async function fingerprintOf(files: FileHash[]): Promise<string> {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path} ${f.sha256}\n`)
    .join('');
  return hexOf(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lines)));
}

/** As the Update board shows it: the first 24 characters in 6 groups of 4. */
export const formatFingerprint = (hex: string): string => groupFingerprint(hex, 6);

/** Its first 2 groups, after the current version (« Actuelle : 0.5.4 · 8e17 02af »). */
export const shortFingerprint = (hex: string): string => groupFingerprint(hex, 2);
