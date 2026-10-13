#!/usr/bin/env node
// Writes one version into every file the Windows build reads it from: the tray line and the exe's file version
// (tauri.conf.json), the installer name (the same), the crate and its lock entry, the overlay package and the daemon's npm package.
// Usage: node scripts/set-version.mjs 0.3.0   (or v0.3.0, as the release tag gives it)
// Line endings may be CRLF: the Windows runner checks out with core.autocrlf.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raw = process.argv[2] ?? '';
const version = raw.replace(/^v/, '');
// Windows file versions are numeric only: a pre-release suffix would break the exe's version resource.
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`set-version: expected MAJOR.MINOR.PATCH (optionally prefixed by v), got "${raw}"`);
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Replaces exactly one match of `re` in `file`, or fails: a silent no-op would ship the old version again. */
function replaceOnce(file, re, to) {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  const hits = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))?.length ?? 0;
  if (hits !== 1) { console.error(`set-version: ${file}: expected one version to replace, found ${hits}`); process.exit(1); }
  writeFileSync(path, text.replace(re, to));
  console.log(`${file} -> ${version}`);
}

replaceOnce('package.json', /^(  "version": )"[^"]*"/m, `$1"${version}"`);
replaceOnce('src-tauri/tauri.conf.json', /^(  "version": )"[^"]*"/m, `$1"${version}"`);
replaceOnce('src-tauri/Cargo.toml', /^(\[package\]\r?\nname = "ledge-overlay"\r?\nversion = )"[^"]*"/m, `$1"${version}"`);
replaceOnce('src-tauri/Cargo.lock', /^(name = "ledge-overlay"\r?\nversion = )"[^"]*"/m, `$1"${version}"`);
replaceOnce('../../packages/ledge/package.json', /^(  "version": )"[^"]*"/m, `$1"${version}"`);
