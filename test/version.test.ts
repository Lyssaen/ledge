import { describe, it, expect } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(__dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

const FILES = [
  'apps/overlay/package.json', 'apps/overlay/src-tauri/tauri.conf.json', 'apps/overlay/src-tauri/Cargo.toml',
  'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json', 'apps/desktop/src-tauri/Cargo.toml',
  'crates/ledge-native/Cargo.toml', 'Cargo.lock', 'packages/ledge/package.json'
];

describe('version', () => {
  // The tray line, the exe's file version and the installer name come from tauri.conf.json; scripts/set-version.mjs
  // writes every target at once (the release workflow runs it from the tag), so they never drift apart.
  const pkg = JSON.parse(read('apps/overlay/package.json')).version;
  const crate = (file: string, name: string) => new RegExp(`^\\[package\\]\\r?\\nname = "${name}"\\r?\\nversion = "${pkg}"`, 'm').test(read(file));
  const lock = (name: string) => new RegExp(`^name = "${name}"\\r?\\nversion = "${pkg}"`, 'm').test(read('Cargo.lock'));

  it('is a plain MAJOR.MINOR.PATCH', () => expect(pkg).toMatch(/^\d+\.\d+\.\d+$/));
  it('is the same in the overlay, the Desktop and the daemon packages and Tauri configs', () => {
    expect(JSON.parse(read('apps/overlay/src-tauri/tauri.conf.json')).version).toBe(pkg);
    expect(JSON.parse(read('apps/desktop/package.json')).version).toBe(pkg);
    expect(JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')).version).toBe(pkg);
    expect(JSON.parse(read('packages/ledge/package.json')).version).toBe(pkg);
  });
  it('is the same in the three crates and their lock entries', () => {
    expect(crate('apps/overlay/src-tauri/Cargo.toml', 'ledge-overlay')).toBe(true);
    expect(crate('apps/desktop/src-tauri/Cargo.toml', 'ledge-desktop')).toBe(true);
    expect(crate('crates/ledge-native/Cargo.toml', 'ledge-native')).toBe(true);
    for (const name of ['ledge-overlay', 'ledge-desktop', 'ledge-native']) {
      expect(lock(name), name).toBe(true);
      expect(read('Cargo.lock').match(new RegExp(`^name = "${name}"\\r?$`, 'gm'))?.length, name).toBe(1);
    }
  });

  function copyTree(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-version-'));
    for (const f of FILES) { mkdirSync(dirname(join(dir, f)), { recursive: true }); cpSync(join(ROOT, f), join(dir, f)); }
    return dir;
  }
  const run = (dir: string, v: string) =>
    spawnSync('node', [join(ROOT, 'scripts/set-version.mjs'), v], { cwd: dir, env: { ...process.env, LEDGE_VERSION_ROOT: dir }, encoding: 'utf8' });

  it('stamps all nine targets, once each', () => {
    const dir = copyTree();
    const r = run(dir, 'v9.9.9');
    expect(r.status).toBe(0);
    for (const f of FILES.filter((f) => f.endsWith('.json'))) expect(JSON.parse(readFileSync(join(dir, f), 'utf8')).version).toBe('9.9.9');
    expect(readFileSync(join(dir, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8')).toMatch(/^version = "9.9.9"/m);
    const l = readFileSync(join(dir, 'Cargo.lock'), 'utf8');
    for (const name of ['ledge-overlay', 'ledge-desktop', 'ledge-native']) expect(l).toMatch(new RegExp(`^name = "${name}"\\r?\\nversion = "9.9.9"`, 'm'));
  });
  it('refuses to touch anything when one file lacks a single version line', () => {
    const dir = copyTree();
    const broken = join(dir, 'apps/desktop/src-tauri/tauri.conf.json');
    writeFileSync(broken, readFileSync(broken, 'utf8').replace(/^(  "version": .*)$/m, '$1\n$1'));
    const before = readFileSync(join(dir, 'apps/overlay/package.json'), 'utf8');
    const r = run(dir, '9.9.9');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/apps\/desktop\/src-tauri\/tauri\.conf\.json/);
    expect(readFileSync(join(dir, 'apps/overlay/package.json'), 'utf8')).toBe(before);
  });
});
