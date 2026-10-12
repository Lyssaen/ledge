import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('version', () => {
  // The tray line, the exe's file version and the installer name come from tauri.conf.json; scripts/set-version.mjs
  // writes all four at once (the release workflow runs it from the tag), so they never drift apart.
  it('is the same in the package, the Tauri config, the crate and its lock entry', () => {
    const pkg = JSON.parse(read('package.json')).version;
    expect(pkg).toMatch(/^\d+\.\d+\.\d+$/);
    expect(JSON.parse(read('src-tauri/tauri.conf.json')).version).toBe(pkg);
    expect(read('src-tauri/Cargo.toml')).toMatch(new RegExp(`^\\[package\\]\\nname = "ledge-overlay"\\nversion = "${pkg}"`, 'm'));
    expect(read('src-tauri/Cargo.lock')).toMatch(new RegExp(`^name = "ledge-overlay"\\nversion = "${pkg}"`, 'm'));
  });
  it('is the same in the npm package of the daemon', () => {
    const pkg = JSON.parse(read('package.json')).version;
    expect(JSON.parse(read('../../packages/ledge/package.json')).version).toBe(pkg);
  });
});
