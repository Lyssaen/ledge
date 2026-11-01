#!/usr/bin/env node
// Build the Tauri updater's rolling snapshot feed from the signed installer.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function snapshotManifest({ version, signature, pubDate }) {
  if (!/^\d+\.\d+\.\d+-snapshot\.[1-9]\d*\.[1-9]\d*$/.test(version)) throw new Error('invalid snapshot version');
  if (!signature?.trim()) throw new Error('missing updater signature');
  if (!pubDate || !Number.isFinite(Date.parse(pubDate))) throw new Error('invalid publication date');
  return {
    version, notes: `Ledge snapshot ${version}`, pub_date: pubDate,
    platforms: { 'windows-x86_64': { signature: signature.trim(), url: 'https://github.com/Lyssaen/ledge/releases/download/snapshot/Ledge.Desktop.Snapshot-x64-setup.exe' } }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [version, signaturePath] = process.argv.slice(2);
  const signature = readFileSync(signaturePath, 'utf8');
  process.stdout.write(JSON.stringify(snapshotManifest({ version, signature, pubDate: new Date().toISOString() }), null, 2) + '\n');
}
