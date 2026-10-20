// Writes `<dist>/build.json` = { version, fingerprint } once the app and its worker are built: the SHA-256 of the
// lines `<path> <sha256>\n`, sorted by path, over every file of dist but build.json (src/sw/fingerprint.ts computes
// the same in the phone). Usage: node scripts/fingerprint.mjs [dist]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.argv[2] ?? join(here, '../dist'));
const { version } = JSON.parse(readFileSync(join(here, '../../../packages/ledge/package.json'), 'utf8'));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const lines = readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => '/' + relative(dist, join(e.parentPath, e.name)).split(sep).join('/'))
  .filter((p) => p !== '/build.json')
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  .map((p) => `${p} ${sha256(readFileSync(join(dist, p)))}\n`)
  .join('');
const build = { version, fingerprint: sha256(lines) };
writeFileSync(join(dist, 'build.json'), JSON.stringify(build) + '\n');
process.stdout.write(`build.json: ${build.version} ${build.fingerprint}\n`);
