import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain ESM script without types
import { pwaNotes } from '../scripts/pwa-notes.mjs';

const build = (o: object) => JSON.stringify(o) + '\n';
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('pwaNotes', () => {
  it('prints the phone app block: the first 24 characters in 6 groups, then the full fingerprint', () => {
    const fp = 'ab'.repeat(32);
    expect(pwaNotes(build({ version: '0.14.0', fingerprint: fp }))).toBe(
      '**Phone app** 0.14.0\nFingerprint: `abab abab abab abab abab abab` (full: `' + fp + '`)'
    );
  });
  it('refuses a fingerprint that is not 64 lowercase hex characters', () => {
    expect(() => pwaNotes(build({ version: '0.14.0', fingerprint: 'ab'.repeat(31) + 'a' }))).toThrow(/fingerprint/);
    expect(() => pwaNotes(build({ version: '0.14.0', fingerprint: 'AB'.repeat(32) }))).toThrow(/fingerprint/);
    expect(() => pwaNotes(build({ version: '0.14.0' }))).toThrow(/fingerprint/);
  });
  it('refuses an unreadable build.json', () => {
    expect(() => pwaNotes('not json')).toThrow(/build\.json/);
  });
  it('exits 1 from the CLI on a bad file and prints the block on a good one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwa-notes-'));
    dirs.push(dir);
    const bad = join(dir, 'bad.json');
    const good = join(dir, 'good.json');
    writeFileSync(bad, build({ version: '0.14.0', fingerprint: 'ab'.repeat(32).slice(1) }));
    writeFileSync(good, build({ version: '0.14.0', fingerprint: 'ab'.repeat(32) }));
    const script = join(__dirname, '..', 'scripts', 'pwa-notes.mjs');
    expect(spawnSync(process.execPath, [script, bad]).status).toBe(1);
    const ok = spawnSync(process.execPath, [script, good], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('**Phone app** 0.14.0\nFingerprint: `abab abab');
  });
});
