#!/usr/bin/env node
// Prints the "Phone app" block of the release notes from the PWA's build.json (apps/mobile/dist/build.json).
// The fingerprint is shown as the phone shows it: the first 24 characters in 6 groups of 4, then the full 64.
// Usage: node scripts/pwa-notes.mjs apps/mobile/dist/build.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function pwaNotes(text) {
  let build;
  try { build = JSON.parse(text); } catch { throw new Error('pwa-notes: build.json is not valid JSON'); }
  const { version, fingerprint } = build ?? {};
  if (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error('pwa-notes: build.json has no 64-hex fingerprint');
  if (typeof version !== 'string' || !version) throw new Error('pwa-notes: build.json has no version');
  const groups = fingerprint.slice(0, 24).match(/.{4}/g).join(' ');
  return `**Phone app** ${version}\nFingerprint: \`${groups}\` (full: \`${fingerprint}\`)`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(pwaNotes(readFileSync(process.argv[2], 'utf8')) + '\n');
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
