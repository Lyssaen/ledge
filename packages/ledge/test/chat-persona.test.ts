import { describe, it, expect } from 'vitest';
import { ACTIONS, MAX_PROPOSALS, NEVER_PROPOSED } from '@ledge/protocol';
import { buildPersona } from '../src/chat/persona.js';
import { PERSONA } from '../src/chat/claude.js';

const TOOLS = ['claude', 'codex', 'cursor', 'omp'] as const;

describe('buildPersona (spec 2026-10-26 action registry §4)', () => {
  it.each(TOOLS)('%s: says what its harness reads with', tool => {
    const p = buildPersona(tool);
    const line = p.split('\n').find(l => l.startsWith('Pour lire'));
    expect(line).toBeDefined();
    if (tool === 'claude') expect(line).toContain('`Read`, `Grep` et `Glob`');
    if (tool === 'omp') expect(line).toContain('`read`, `grep` et `glob`');
    if (tool === 'codex') expect(line).toMatch(/shell en lecture seule/);
    if (tool === 'cursor') expect(line).toMatch(/mode ask/);
  });
  it.each(['claude', 'omp'] as const)('%s: never invites to a shell', tool => {
    const p = buildPersona(tool);
    expect(p).not.toMatch(/commandes? (shell|de lecture)|`cat`|`rg`/);
  });
  it.each(TOOLS)('%s: lists every action of the registry, its rule, its risk and its example as a ledge-action block', tool => {
    const p = buildPersona(tool);
    for (const a of ACTIONS) {
      expect(p, a.id).toContain(`\`${a.id}\``);
      expect(p, a.id).toContain(a.when);
      expect(p, a.id).toContain('```ledge-action\n' + JSON.stringify({ action: a.id, args: a.example }) + '\n```');
      const entry = p.split('\n').find(l => l.startsWith(`- \`${a.id}\``))!;
      if (a.risk === 'destructive') expect(entry, a.id).toContain('irréversible');
      if (a.risk === 'reversible') expect(entry, a.id).toContain('réversible');
    }
  });
  it('says the cap of an action held below the plan\'s, so the answer never announces rows the card drops', () => {
    const p = buildPersona('claude');
    for (const a of ACTIONS) {
      const rule = p.split('\n').find(l => l.startsWith('  Règle : ') && l.includes(a.when))!;
      if (a.max === 1) expect(rule, a.id).toContain('une seule par réponse');
      else if (a.max < MAX_PROPOSALS) expect(rule, a.id).toContain(`${a.max} au plus par réponse`);
      else expect(rule, a.id).not.toContain('par réponse');
    }
  });
  it('writes only ledge-action blocks, never the earlier fences', () => {
    expect(buildPersona('claude')).not.toMatch(/```ledge-(session|relay|close|project|team|task)\b/);
  });
  it('lists what Ledge never proposes', () => {
    const p = buildPersona('codex');
    for (const n of NEVER_PROPOSED) expect(p).toContain(n);
  });
  it('stays short enough for a system prompt', () => {
    for (const tool of TOOLS) expect(buildPersona(tool).length).toBeLessThan(20_000);
  });
  it('PERSONA is the claude persona', () => {
    expect(PERSONA).toBe(buildPersona('claude'));
  });
});
