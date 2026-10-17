// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Rollup } from 'vite';

const SRC = resolve(__dirname, '../src');
const MESSAGES = resolve(SRC, 'i18n/messages.ts');
const TABLES = new Set([resolve(SRC, 'i18n/fr'), resolve(SRC, 'i18n/en')]);

/** A fresh `messages.ts`: nothing loaded yet (the suite's setup preloads both languages in the shared one). */
async function freshMessages() {
  vi.resetModules();
  return import('../src/i18n/messages');
}

describe('each language loads on its own', () => {
  it('loadMessages fetches a language once and keeps it; the other one stays unloaded', async () => {
    const m = await freshMessages();
    expect(m.messagesLoaded('en')).toBeUndefined();
    const first = m.loadMessages('en');
    expect(m.loadMessages('en')).toBe(first);
    const en = await first;
    expect(en.foot.sessions).toBe('Local and SSH sessions');
    expect(m.messagesLoaded('en')).toBe(en);
    await expect(m.loadMessages('en')).resolves.toBe(en);
    expect(m.messagesLoaded('fr')).toBeUndefined();
    expect((await m.loadMessages('fr')).foot.sessions).toBe('Sessions locales et SSH');
  });
});

describe('the bundle', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
  const table = (from: string, spec: string) => spec.startsWith('.') && TABLES.has(resolve(dirname(from), spec).replace(/\.tsx?$/, ''));

  it('nothing in src imports a language table statically: only messages.ts fetches them, by import(); type imports are free', () => {
    const offences: string[] = [];
    for (const file of files(SRC)) {
      const code = readFileSync(file, 'utf8');
      for (const [whole, type, spec] of code.matchAll(/\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
        if (table(file, spec!) && !type) offences.push(`${file}: ${whole}`);
      }
      for (const [whole, type, spec] of code.matchAll(/(typeof\s+)?\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        if (table(file, spec!) && !type && file !== MESSAGES) offences.push(`${file}: ${whole}`);
      }
    }
    expect(offences).toEqual([]);
    const messages = readFileSync(MESSAGES, 'utf8');
    expect(messages).toMatch(/import\('\.\/fr'\)/);
    expect(messages).toMatch(/import\('\.\/en'\)/);
  });

  it('the built main chunk carries neither language: each comes in a chunk of its own', async () => {
    const { build } = await import('vite');
    const out = await build({ root: resolve(__dirname, '..'), mode: 'production', logLevel: 'silent', build: { write: false } }) as Rollup.RollupOutput;
    const chunks = out.output.filter((o): o is Rollup.OutputChunk => o.type === 'chunk');
    const main = chunks.find(c => c.isEntry)!;
    const holding = (s: string) => chunks.filter(c => c.code.includes(s)).map(c => c.name);
    for (const s of ['Local and SSH sessions', 'Manage machines', 'Search a session']) {
      expect(main.code.includes(s), `the main chunk carries « ${s} »`).toBe(false);
      expect(holding(s)).toEqual(['en']);
    }
    for (const s of ['Sessions locales et SSH', 'Rechercher une session', 'Nouvelle session']) {
      expect(main.code.includes(s), `the main chunk carries « ${s} »`).toBe(false);
      expect(holding(s)).toEqual(['fr']);
    }
  }, 60_000);
});
