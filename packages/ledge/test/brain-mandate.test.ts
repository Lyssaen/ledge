import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_MANDATE, ensureMandate, escalateCategory, parseMandate } from '../src/daemon/brain/mandate.js';
import { paths } from '../src/paths.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe('mandate', () => {
  it('the default mandate parses into the four self categories', () => {
    expect(parseMandate(DEFAULT_MANDATE).self).toEqual(['git', 'tests', 'context', 'code']);
    expect(parseMandate(DEFAULT_MANDATE).user).toEqual(['design', 'architecture', 'critical']);
  });
  it('a hand-edited mandate never lets design through; unknown ids are dropped; empty is unreadable', () => {
    const edited = DEFAULT_MANDATE.replace('- design : design (UI, copie)\n', '').replace('## Ledge tranche seul\n', '## Ledge tranche seul\n- design : design\n- banana : truc\n');
    const m = parseMandate(edited);
    expect(m.self).not.toContain('design'); expect(m.self).not.toContain('banana'); expect(m.user).toContain('design');
    expect(parseMandate('')).toEqual({ self: [], user: [], readable: false });
  });
  it('escalateCategory moves git to the user list', () => {
    const out = escalateCategory(DEFAULT_MANDATE, 'git');
    expect(parseMandate(out).self).toEqual(['tests', 'context', 'code']);
    expect(parseMandate(out).user).toContain('git');
    expect(escalateCategory(out, 'git')).toBe(out);
  });
  it('ensureMandate creates the default once and keeps edits; paths has the brain files', async () => {
    const d = mkdtempSync(join(tmpdir(), 'ledge-mandate-')); dirs.push(d);
    const f = join(d, 'sub', 'mandat.md');
    expect(await ensureMandate(f)).toBe(DEFAULT_MANDATE);
    expect(readFileSync(f, 'utf8')).toBe(DEFAULT_MANDATE);
    const prev = process.env.LEDGE_HOME; process.env.LEDGE_HOME = d;
    try { const p = paths(); expect(p.rules).toBe(join(d, 'memoire', 'rules.json')); expect(p.decisions).toBe(join(d, 'memoire', 'decisions.jsonl'));
      expect(p.memoryDir).toBe(join(d, 'memoire')); expect(p.brainSettings).toBe(join(d, 'brain.json')); expect(p.brainDir).toBe(join(d, 'brain')); }
    finally { if (prev === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = prev; }
    expect(existsSync(f)).toBe(true);
  });
});
