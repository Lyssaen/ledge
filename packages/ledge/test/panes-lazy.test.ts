import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// node-pty has no Linux prebuild and loads a native module: on Linux and WSL no ledge process (a hook least of all) may
// load it, nor the xterm bundle. tsup keeps a dynamic import of an external dynamic, a static one goes to the top.
const src = fileURLToPath(new URL('../src/', import.meta.url));
const files = (d: string): string[] => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []; });

describe('the ConPTY packages are loaded only when a pane starts', () => {
  it('no source file imports node-pty or @xterm/headless statically (import type and import() only)', () => {
    const offenders = files(src).filter(f => /^\s*import\s+(?!type\b)[^;]*from\s+['"](node-pty|@xterm\/headless|@xterm\/addon-serialize)['"]/m.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.slice(src.length).split(sep).join('/'))).toEqual([]);
  });
  it('they are optional dependencies, so an install where node-pty cannot build still succeeds', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, Record<string, string> | undefined>;
    for (const name of ['node-pty', '@xterm/headless', '@xterm/addon-serialize']) {
      expect(pkg.dependencies?.[name]).toBeUndefined();
      expect(pkg.optionalDependencies?.[name]).toBeDefined();
    }
  });
  it('the bundle leaves them external (tsup bundles optional dependencies otherwise, and node-pty needs its .node file)', () => {
    const config = readFileSync(new URL('../tsup.config.ts', import.meta.url), 'utf8');
    expect(config).toMatch(/external:\s*\[[^\]]*'node-pty'[^\]]*\]/);
    expect(config).toMatch(/external:\s*\[[^\]]*'@xterm\/headless'[^\]]*\]/);
    expect(config).toMatch(/external:\s*\[[^\]]*'@xterm\/addon-serialize'[^\]]*\]/);
  });
});
