#!/usr/bin/env node
// The Windows installer needs a numeric version; only the npm package gets a unique prerelease suffix.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.env.LEDGE_SNAPSHOT_ROOT ?? process.cwd();
const file = resolve(root, 'packages/ledge/package.json');
const pkg = JSON.parse(readFileSync(file, 'utf8'));
const run = process.env.SNAPSHOT_RUN_ID ?? '';
const attempt = process.env.SNAPSHOT_RUN_ATTEMPT ?? '';
if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || !/^[1-9]\d*$/.test(run) || !/^[1-9]\d*$/.test(attempt)) {
  throw new Error('snapshot-version: expected a numeric package version, run id and attempt');
}
const version = `${pkg.version}-snapshot.${run}.${attempt}`;
pkg.version = version;
writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log(version);
