#!/usr/bin/env node
// Writes one version into every file the Windows build reads it from: the tray line and the exe's file version
// (tauri.conf.json), the installer name (the same), the three crates and their lock entries, the overlay and Desktop packages and the daemon's npm package.
// Overlay and Desktop always ship the same version.
// Usage: node scripts/set-version.mjs 0.3.0   (or v0.3.0, as the release tag gives it)
// Line endings may be CRLF: the Windows runner checks out with core.autocrlf.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raw = process.argv[2] ?? '';
const version = raw.replace(/^v/, '');
// Windows file versions are numeric only: a pre-release suffix would break the exe's version resource.
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`set-version: expected MAJOR.MINOR.PATCH (optionally prefixed by v), got "${raw}"`);
  process.exit(1);
}

// LEDGE_VERSION_ROOT points the script at another tree (the tests stamp a temporary copy).
const root = process.env.LEDGE_VERSION_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_VERSION = /^(  "version": )"[^"]*"/m;
const crate = (name) => new RegExp(`^(\\[package\\]\\r?\\nname = "${name}"\\r?\\nversion = )"[^"]*"`, 'm');
const lock = (name) => new RegExp(`^(name = "${name}"\\r?\\nversion = )"[^"]*"`, 'm');

const TARGETS = [
  { file: 'apps/overlay/package.json', re: JSON_VERSION },
  { file: 'apps/overlay/src-tauri/tauri.conf.json', re: JSON_VERSION },
  { file: 'apps/overlay/src-tauri/Cargo.toml', re: crate('ledge-overlay') },
  { file: 'apps/desktop/package.json', re: JSON_VERSION },
  { file: 'apps/desktop/src-tauri/tauri.conf.json', re: JSON_VERSION },
  { file: 'apps/desktop/src-tauri/Cargo.toml', re: crate('ledge-desktop') },
  { file: 'crates/ledge-native/Cargo.toml', re: crate('ledge-native') },
  { file: 'Cargo.lock', re: lock('ledge-overlay') },
  { file: 'Cargo.lock', re: lock('ledge-desktop') },
  { file: 'Cargo.lock', re: lock('ledge-native') },
  { file: 'packages/ledge/package.json', re: JSON_VERSION }
];

const count = (text, re) => text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))?.length ?? 0;

// Pass 1: every target must match exactly once, or nothing is written (a silent no-op would ship the old version again,
// and a half-stamped tree is worse). The texts are read once and threaded through pass 2 (Cargo.lock has three targets).
const texts = new Map();
let failed = false;
for (const { file, re } of TARGETS) {
  if (!texts.has(file)) texts.set(file, readFileSync(join(root, file), 'utf8'));
  const hits = count(texts.get(file), re);
  if (hits !== 1) { console.error(`set-version: ${file}: expected one version to replace for ${re.source.slice(0, 60)}, found ${hits}`); failed = true; }
}
if (failed) process.exit(1);

// Pass 2: write.
for (const { file, re } of TARGETS) texts.set(file, texts.get(file).replace(re, `$1"${version}"`));
for (const [file, text] of texts) { writeFileSync(join(root, file), text); console.log(`${file} -> ${version}`); }
