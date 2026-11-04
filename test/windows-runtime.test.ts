import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { layout, NODE, PORTABLE_GIT, verifySha256 } from '../scripts/windows-runtime/pins.mjs';

// The runtime the snapshot installer carries for a PC with nothing installed (spec 2026-11-03 §4.2.5): pinned downloads,
// and the layout the Desktop side runs.
describe('windows runtime pins', () => {
  it('layout names the files the Desktop side runs', () => {
    const l = layout('C:\\r');
    expect(l.node).toBe(join('C:\\r', 'node.exe'));
    expect(l.cli).toBe(join('C:\\r', 'ledge', 'dist', 'cli', 'index.js'));
    expect(l.bash).toBe(join('C:\\r', 'git', 'bin', 'bash.exe'));
    expect(l.gitCmd).toBe(join('C:\\r', 'git', 'cmd'));
    expect(l.version).toBe(join('C:\\r', 'VERSION'));
  });
  it('verifySha256 accepts the pinned hash and refuses another', () => {
    const b = Buffer.from('ledge'); const h = createHash('sha256').update(b).digest('hex');
    expect(() => verifySha256(b, h, 'x')).not.toThrow();
    expect(() => verifySha256(b, '0'.repeat(64), 'x')).toThrow('checksum mismatch for x');
  });
  it('the pins are exact versions with 64-hex hashes, served from their official hosts', () => {
    expect(NODE.version).toBe('22.23.3'); expect(PORTABLE_GIT.version).toBe('2.56.0.windows.4');
    for (const p of [NODE, PORTABLE_GIT]) expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(NODE.url).toBe('https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip');
    expect(PORTABLE_GIT.url).toBe('https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/PortableGit-2.56.0.4-64-bit.7z.exe');
  });

  it('the runtime installs from a committed lockfile that matches the Ledge package (npm ci, nothing resolved at build time)', () => {
    const lockPath = resolve('scripts/windows-runtime/package-lock.json');
    expect(existsSync(lockPath)).toBe(true);
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const pkg = JSON.parse(readFileSync(resolve('packages/ledge/package.json'), 'utf8'));
    expect(lock.lockfileVersion).toBe(3);
    // Regenerate with `node scripts/windows-runtime/lock.mjs` when packages/ledge's dependencies change.
    expect(lock.packages[''].dependencies).toEqual(pkg.dependencies);
    expect(lock.packages[''].optionalDependencies).toEqual(pkg.optionalDependencies);
    expect(lock.packages['node_modules/node-pty'].version).toBe(pkg.optionalDependencies['node-pty']);
  });
});
