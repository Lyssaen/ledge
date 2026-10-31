import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatStep } from '@ledge/protocol';
import { NOTES_INDEX, writeNotes } from '../src/chat/notes.js';
import { writeContext, stepFor } from '../src/chat/context.js';

const T0 = '2026-10-11T10:00:00.000Z';
const tmp = () => mkdtempSync(join(tmpdir(), 'notes-'));
function notes(files: Record<string, string>): string {
  const from = tmp();
  for (const [name, text] of Object.entries(files)) { writeFileSync(join(from, name), text); utimesSync(join(from, name), new Date(T0), new Date(T0)); }
  return from;
}
const indexLine = (dir: string, file: string) => readFileSync(join(dir, NOTES_INDEX), 'utf8').split('\n').find(l => l.startsWith(`- ${file} `));

describe('writeNotes', () => {
  it('copies a note with front matter and indexes its title, when and date', async () => {
    const text = '---\ntitle: Mes machines\nwhen: "une question sur une machine, SSH ou WSL"\n---\nLe devbox est en Debian.\n';
    const from = notes({ 'machines.md': text }); const dir = tmp(); const steps = new Map<string, ChatStep>();
    await writeNotes(dir, from, steps);
    expect(readFileSync(join(dir, 'context-machines.md'), 'utf8')).toBe(text);
    expect(indexLine(dir, 'context-machines.md')).toBe(`- context-machines.md — « Mes machines » — when: une question sur une machine, SSH ou WSL — modified ${T0}`);
    expect(steps.get('context-machines.md')).toEqual({ kind: 'repo', name: 'machines.md', path: join(from, 'machines.md') });
  });

  it('without front matter, indexes the file name and its first line', async () => {
    const from = notes({ 'git.md': '\n\n# Conventions git\n\nBranches en feat/…\n' }); const dir = tmp();
    await writeNotes(dir, from, new Map());
    expect(indexLine(dir, 'context-git.md')).toBe(`- context-git.md — « git.md » — first line: # Conventions git — modified ${T0}`);
  });

  it('a front matter without when gives the first line of the body; a broken one is read as text', async () => {
    const from = notes({ 'a.md': '---\ntitle: A\n---\nPremière ligne\n', 'b.md': '---\nnot a pair\n---\nx\n' }); const dir = tmp();
    await writeNotes(dir, from, new Map());
    expect(indexLine(dir, 'context-a.md')).toContain('« A » — first line: Première ligne');
    expect(indexLine(dir, 'context-b.md')).toContain('« b.md » — first line: ---');
  });

  it('cuts a note past the limit and says so in the copy and in the index', async () => {
    const big = 'é'.repeat(100); // 200 bytes
    const from = notes({ 'big.md': big, 'small.md': 'ok' }); const dir = tmp();
    await writeNotes(dir, from, new Map(), 51);
    const copy = readFileSync(join(dir, 'context-big.md'), 'utf8');
    expect(copy.startsWith('é'.repeat(25))).toBe(true); expect(copy).not.toContain('�');
    expect(copy).toContain('[truncated by Ledge: the first 51 of 200 bytes]');
    expect(indexLine(dir, 'context-big.md')).toContain('TRUNCATED: only the first 51 of 200 bytes are copied');
    expect(indexLine(dir, 'context-small.md')).not.toContain('TRUNCATED');
  });

  it('reads only regular .md files directly in the folder, and keeps names safe and unique', async () => {
    const from = notes({ 'a b.md': 'one', 'a-b.md': 'two', 'notes.txt': 'no', '.hidden.md': 'h' });
    mkdirSync(join(from, 'sub.md')); symlinkSync(join(from, 'a-b.md'), join(from, 'link.md'));
    const dir = tmp();
    await writeNotes(dir, from, new Map());
    const index = readFileSync(join(dir, NOTES_INDEX), 'utf8');
    expect(readFileSync(join(dir, 'context-a-b.md'), 'utf8')).toBe('one');
    expect(readFileSync(join(dir, 'context-a-b-2.md'), 'utf8')).toBe('two');
    expect(readFileSync(join(dir, 'context-hidden.md'), 'utf8')).toBe('h');
    expect(index).not.toContain('notes.txt'); expect(index).not.toContain('sub.md'); expect(index).not.toContain('link.md');
  });

  it('a missing folder gives an index that says how to add notes', async () => {
    const dir = tmp();
    await writeNotes(dir, join(tmp(), 'nope'), new Map());
    expect(readFileSync(join(dir, NOTES_INDEX), 'utf8')).toContain('(none: the user can add Markdown files to');
  });
});

describe('writeContext with notes', () => {
  it('writes the index and the copies only when a notes folder is given; a copy read is a step', async () => {
    const from = notes({ 'machines.md': 'x' });
    const dir = tmp();
    const ctx = await writeContext(dir, { sessions: [], now: T0, capture: async () => null, git: async () => null, notesDir: from });
    expect(existsSync(join(dir, NOTES_INDEX))).toBe(true);
    expect(stepFor(join(dir, 'context-machines.md'), ctx)).toEqual({ kind: 'repo', name: 'machines.md', path: join(from, 'machines.md') });
    const none = tmp();
    await writeContext(none, { sessions: [], now: T0, capture: async () => null, git: async () => null });
    expect(existsSync(join(none, NOTES_INDEX))).toBe(false);
  });
});
