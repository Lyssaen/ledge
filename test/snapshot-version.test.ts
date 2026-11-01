import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve('scripts/snapshot-version.mjs');
let root = '';
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });
function fixture(version: string) {
  root = mkdtempSync(join(tmpdir(), 'ledge-snapshot-'));
  mkdirSync(join(root, 'packages/ledge'), { recursive: true });
  writeFileSync(join(root, 'packages/ledge/package.json'), JSON.stringify({ name: '@paradow/ledge', version }));
  return join(root, 'packages/ledge/package.json');
}
function run(id: string, attempt: string, output = join(root, 'output')) {
  return spawnSync(process.execPath, [script], { env: { ...process.env, LEDGE_SNAPSHOT_ROOT: root, SNAPSHOT_RUN_ID: id, SNAPSHOT_RUN_ATTEMPT: attempt, GITHUB_OUTPUT: output }, encoding: 'utf8' });
}
describe('snapshot version', () => {
  it('stamps only the npm package with a unique prerelease and exposes its version', () => {
    const file = fixture('1.2.3');
    expect(run('128', '2').status).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe('1.2.3-snapshot.128.2');
    expect(readFileSync(join(root, 'output'), 'utf8')).toBe('version=1.2.3-snapshot.128.2\n');
  });
  it.each([['1.2.3', '0', '1'], ['1.2.3', '1', 'x'], ['1.2.3-beta.1', '1', '1']])('rejects invalid values without changing the package', (version, id, attempt) => {
    const file = fixture(version); const before = readFileSync(file, 'utf8');
    expect(run(id, attempt).status).not.toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});
