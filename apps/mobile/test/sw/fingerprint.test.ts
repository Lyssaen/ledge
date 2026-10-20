// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fingerprintOf, formatFingerprint, shortFingerprint } from '../../src/sw/fingerprint';

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRIPT = path.resolve(HERE, '../../scripts/fingerprint.mjs');
const VERSION = (JSON.parse(readFileSync(path.resolve(HERE, '../../../../packages/ledge/package.json'), 'utf8')) as { version: string }).version;

const files = [
  { path: '/index.html', sha256: sha('<html>') },
  { path: '/assets/index-abc.js', sha256: sha('js') },
  { path: '/sw.js', sha256: sha('sw') }
];

describe('fingerprintOf', () => {
  it('is the SHA-256 of the `<path> <sha256>` lines sorted by path, whatever the order given', async () => {
    const lines = [...files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => `${f.path} ${f.sha256}\n`).join('');
    const fp = await fingerprintOf(files);
    expect(fp).toBe(sha(lines));
    expect(await fingerprintOf([...files].reverse())).toBe(fp);
    expect(await fingerprintOf([files[1]!, files[2]!, files[0]!])).toBe(fp);
  });
});

describe('the fingerprint shown', () => {
  it('in full: the first 24 characters in 6 groups of 4, as the Update board shows it', () => {
    expect(formatFingerprint('3f9ac21e70bd44e19a02d5c8ffeeddccbbaa99887766554433221100aabbccdd')).toBe('3f9a c21e 70bd 44e1 9a02 d5c8');
  });

  it('short: its first 2 groups (« Actuelle : 0.5.4 · 8e17 02af »)', () => {
    expect(shortFingerprint('8e1702af9a02d5c8')).toBe('8e17 02af');
  });
});

describe('scripts/fingerprint.mjs', () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('writes build.json = { version, fingerprint }: the same value as fingerprintOf over every file but build.json', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'ledge-fp-'));
    const content: Record<string, string> = { 'index.html': '<html>', 'assets/index-abc.js': 'js', 'assets/index-def.css': 'css', 'sw.js': 'sw' };
    mkdirSync(path.join(dir, 'assets'));
    for (const [p, c] of Object.entries(content)) writeFileSync(path.join(dir, p), c);
    // A previous build.json is not part of the build it describes.
    writeFileSync(path.join(dir, 'build.json'), '{"stale":true}');

    execFileSync(process.execPath, [SCRIPT, dir]);

    const written = JSON.parse(readFileSync(path.join(dir, 'build.json'), 'utf8')) as unknown;
    const expected = await fingerprintOf(Object.entries(content).map(([p, c]) => ({ path: `/${p}`, sha256: sha(c) })));
    expect(written).toEqual({ version: VERSION, fingerprint: expected });
  });
});
