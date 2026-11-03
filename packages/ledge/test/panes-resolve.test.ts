import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCommand } from '../src/panes/resolve.js';

const dirs = () => { const root = mkdtempSync(join(tmpdir(), 'resolve-')); const a = join(root, 'a'), b = join(root, 'b'); mkdirSync(a); mkdirSync(b); return { a, b }; };

describe('resolveCommand on Windows', () => {
  it('finds name.exe along Path, first folder first', () => {
    const { a, b } = dirs();
    writeFileSync(join(b, 'claude.exe'), ''); writeFileSync(join(a, 'claude.cmd'), '');
    expect(resolveCommand('claude', { Path: `${a};${b}` }, 'win32')).toBe(join(b, 'claude.exe'));
  });
  it('reads PATH whatever its case', () => {
    const { a } = dirs(); writeFileSync(join(a, 'codex.exe'), '');
    expect(resolveCommand('codex', { PATH: a }, 'win32')).toBe(join(a, 'codex.exe'));
  });
  it('never takes a .cmd or .bat shim', () => {
    const { a } = dirs(); writeFileSync(join(a, 'pnpm.cmd'), ''); writeFileSync(join(a, 'x.bat'), '');
    expect(() => resolveCommand('pnpm', { Path: a }, 'win32')).toThrow('pnpm: no .exe found on the PATH');
  });
  it('keeps a path as given, and anything elsewhere than Windows', () => {
    expect(resolveCommand('C:\\tools\\claude.exe', { Path: '' }, 'win32')).toBe('C:\\tools\\claude.exe');
    expect(resolveCommand('claude', { PATH: '/nowhere' }, 'linux')).toBe('claude');
  });
});
