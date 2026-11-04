import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Only the snapshot installer carries the Windows runtime (spec 2026-11-03 §4.3: nothing reaches stable before the snapshot
// passed the acceptance bar). Read as text: the job's steps in order.
const read = (f: string) => readFileSync(resolve('.github/workflows', f), 'utf8');
/** The text of one job: from its `  <name>:` line to the next job's. */
const job = (text: string, name: string) => { const rest = text.slice(text.indexOf(`\n  ${name}:`) + 1); const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/); return next < 0 ? rest : rest.slice(0, next + 1); };

describe('the snapshot installer carries the runtime', () => {
  it('assembles the runtime, then builds with the runtime config', () => {
    const w = job(read('snapshot.yml'), 'windows-installer');
    const assemble = w.indexOf('node scripts/windows-runtime/assemble.mjs apps/desktop/src-tauri/runtime');
    const build = w.indexOf('pnpm tauri build --config src-tauri/tauri.runtime.conf.json');
    expect(assemble).toBeGreaterThan(0);
    expect(build).toBeGreaterThan(assemble);
    expect(w).toContain('300MB');
  });
  it('the release workflow does not bundle it', () => {
    expect(read('release.yml')).not.toContain('tauri.runtime.conf.json');
    expect(read('release.yml')).not.toContain('windows-runtime');
  });
  it('the runtime config adds the folder as a bundle resource', () => {
    const conf = JSON.parse(readFileSync(resolve('apps/desktop/src-tauri/tauri.runtime.conf.json'), 'utf8'));
    expect(conf).toEqual({ bundle: { resources: { 'runtime/': 'runtime/' } } });
  });
});
