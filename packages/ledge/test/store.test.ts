import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/daemon/store.js';
import type { Session } from '@ledge/protocol';

const T0 = '2026-10-09T18:00:00.000Z';
const mk = (id: string, state: Session['state'] = 'working'): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto · w', tmuxSession: `ledge-${id}`,
  state, helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher'
});
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledge-')); process.env.LEDGE_HOME = dir; });

describe('Store', () => {
  it('upserts, applies events and notifies', async () => {
    const s = new Store(); const seen: string[] = [];
    s.onChange(c => seen.push(c.type));
    s.upsert(mk('a'));
    const next = s.apply('a', { name: 'Stop', at: '2026-10-09T18:01:00.000Z', source: 'hook' });
    expect(next?.state).toBe('idle');
    s.remove('a');
    expect(seen).toEqual(['updated', 'updated', 'removed']);
    expect(s.all()).toEqual([]);
  });
  it('does not notify when the reducer returns the same object', () => {
    const s = new Store(); let n = 0; s.onChange(() => n++);
    s.upsert(mk('a', 'exited'));
    s.apply('a', { name: 'UserPromptSubmit', at: '2026-10-09T18:01:00.000Z', source: 'hook' });
    expect(n).toBe(1);
  });
  it('persists to the journal and loads it back', async () => {
    const s = new Store(); s.upsert(mk('a')); await s.save();
    const s2 = new Store(); await s2.load();
    expect(s2.get('a')?.tmuxSession).toBe('ledge-a');
  });
  it('debounces saves after changes', async () => {
    const s = new Store(); s.upsert(mk('a')); s.upsert(mk('b'));
    await sleep(350);
    const txt = readFileSync(join(dir, 'sessions.json'), 'utf8');
    expect(JSON.parse(txt).sessions.length).toBe(2);
  });
  it('starts empty on a corrupt journal and logs once', async () => {
    writeFileSync(join(dir, 'sessions.json'), '{"sessions": [ {"id": "a", ');
    const s = new Store(); await expect(s.load()).resolves.toBeUndefined();
    expect(s.all()).toEqual([]);
    const lines = readFileSync(join(dir, 'daemon.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/journal unreadable/);
  });
  it('drops journal entries that fail the schema instead of crashing', async () => {
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ sessions: [mk('ok'), { id: 'bad', state: 'sleeping' }] }));
    const s = new Store(); await s.load();
    expect(s.all().map(x => x.id)).toEqual(['ok']);
  });
});
