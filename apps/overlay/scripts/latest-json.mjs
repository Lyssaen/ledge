#!/usr/bin/env node
// Writes the updater manifest the installed Ledge reads from releases/latest/download/latest.json (spec 2026-10-12 auto-update §4).
// Usage: node scripts/latest-json.mjs v0.3.0 path/to/Ledge_0.3.0_x64-setup.exe notes.md > latest.json
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'Paradow-dev/ledge';

export function latestJson({ tag, notes, signature, exeName, pubDate }) {
  const version = tag.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`latest-json: expected MAJOR.MINOR.PATCH, got "${tag}"`);
  return {
    version, notes, pub_date: pubDate,
    platforms: { 'windows-x86_64': { signature, url: `https://github.com/${REPO}/releases/download/${tag}/${exeName}` } }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [tag, exe, notesFile] = process.argv.slice(2);
  const out = latestJson({
    tag, exeName: basename(exe), pubDate: new Date().toISOString(),
    signature: readFileSync(`${exe}.sig`, 'utf8').trim(),
    notes: notesFile ? readFileSync(notesFile, 'utf8').trim() : ''
  });
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
