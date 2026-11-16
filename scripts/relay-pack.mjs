#!/usr/bin/env node
// Guards the relay's npm package: `check <npm pack --json file>` fails when the tarball lacks a file the CLI needs or
// carries a phone build other than the one the release uploads; `publishable` says whether the relay has a licence yet.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED = ['dist/cli.js', 'dist/main.js', 'web/index.html', 'web/sw.js', 'web/build.json', 'web/manifest.webmanifest'];

// The relay is published only once its owner has picked a licence: UNLICENSED or none keeps it unpublished.
export function relayPublishable(pkg) {
  const license = (pkg.license ?? '').trim();
  return license !== '' && license !== 'UNLICENSED';
}

// Returns the problems of a packed relay: files missing from the tarball, or a phone build that is not the mobile one.
export function checkRelayPack({ files, packedBuild, mobileBuild }) {
  const problems = REQUIRED.filter((f) => !files.includes(f)).map((f) => `${f} is missing from the package`);
  if (packedBuild !== mobileBuild) problems.push('web/build.json differs from apps/mobile/dist/build.json: the package carries another phone build');
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [cmd, packJson] = process.argv.slice(2);
  if (cmd === 'publishable') {
    console.log(String(relayPublishable(JSON.parse(readFileSync(resolve(root, 'apps/relay/package.json'), 'utf8')))));
  } else if (cmd === 'check' && packJson) {
    const files = JSON.parse(readFileSync(packJson, 'utf8'))[0].files.map((f) => f.path);
    const packedBuild = readFileSync(resolve(root, 'apps/relay/web/build.json'), 'utf8');
    const mobileBuild = readFileSync(resolve(root, 'apps/mobile/dist/build.json'), 'utf8');
    const problems = checkRelayPack({ files, packedBuild, mobileBuild });
    for (const p of problems) console.error(`relay-pack: ${p}`);
    if (problems.length) process.exit(1);
  } else {
    console.error('usage: relay-pack.mjs check <npm pack --json file> | publishable');
    process.exit(2);
  }
}
