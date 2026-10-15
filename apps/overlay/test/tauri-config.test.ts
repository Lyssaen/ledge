import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('updater configuration', () => {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  it('reads the latest release of the public repository, signed with our key', () => {
    expect(conf.plugins.updater.endpoints).toEqual(['https://github.com/Lyssaen/ledge/releases/latest/download/latest.json']);
    expect(Buffer.from(conf.plugins.updater.pubkey, 'base64').toString()).toMatch(/^untrusted comment: minisign public key/);
    expect(conf.plugins.updater.windows.installMode).toBe('passive');
    expect(conf.bundle.createUpdaterArtifacts).toBe(true);
  });
  it('lets the window check, install and relaunch', () => {
    const caps = JSON.parse(read('src-tauri/capabilities/default.json'));
    expect(caps.permissions).toEqual(expect.arrayContaining(['updater:default', 'process:allow-restart']));
  });
  it('registers both plugins in the shell', () => {
    const main = read('src-tauri/src/main.rs');
    expect(main).toContain('tauri_plugin_updater::Builder::new().build()');
    expect(main).toContain('tauri_plugin_process::init()');
  });
});
