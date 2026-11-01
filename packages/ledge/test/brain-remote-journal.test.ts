import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReceiptJournal } from '../src/daemon/brain/remoteJournal.js';
const dirs: string[] = [];
const file = () => { const d = mkdtempSync(join(tmpdir(), 'brain-journal-')); dirs.push(d); return join(d, 'receipts.json'); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
it('keeps the proof across a restart in a private file', () => {
  const path = file(); const a = createReceiptJournal(path);
  a.put({ operation: 'r', token: 'secret', id: 'e', state: 'started' });
  a.put({ operation: 'r', token: 'secret', id: 'e', state: 'applied' });
  expect(createReceiptJournal(path).get('r')).toEqual({ operation: 'r', token: 'secret', id: 'e', state: 'applied' });
  expect(statSync(path).mode & 0o777).toBe(0o600);
});
it('refuses to overwrite an unreadable proof journal', () => {
  const path = file(); writeFileSync(path, '{broken');
  expect(() => createReceiptJournal(path)).toThrow(); expect(readFileSync(path, 'utf8')).toBe('{broken');
});
