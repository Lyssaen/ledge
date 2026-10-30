import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, ARCHIVE_MAX } from '../src/daemon/store.js';
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
  it('tells event listeners about every applied event, even one the reducer ignores', () => {
    const s = new Store(); const seen: string[] = [];
    s.onEvent((id, ev) => seen.push(`${id}:${ev.name}`));
    s.upsert(mk('a'));
    s.apply('a', { name: 'Stop', at: '2026-10-09T18:01:00.000Z', source: 'hook' });
    s.apply('a', { name: 'Decided', at: '2026-10-09T18:02:00.000Z', source: 'daemon' }); // nothing pending: same object
    s.apply('zz', { name: 'Stop', at: '2026-10-09T18:03:00.000Z', source: 'hook' }); // unknown session: nothing
    expect(seen).toEqual(['a:Stop', 'a:Decided']);
  });
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
  it('drops the autonomy a role gave an old record, and keeps one a lone session has', async () => {
    const s = new Store();
    s.upsert({ ...mk('l'), autonomy: 'auto' });
    await s.save();
    const file = JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8')) as { sessions: Record<string, unknown>[] };
    file.sessions.push({ ...mk('r'), role: 'build', roleLabel: 'Build', team: 'team-a1b2', autonomy: 'auto' }, { ...mk('t'), team: 'team-a1b2', autonomy: 'edits' });
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify(file));
    const s2 = new Store(); await s2.load();
    expect(s2.get('r')).not.toHaveProperty('autonomy');
    expect(s2.get('t')).not.toHaveProperty('autonomy');
    expect(s2.get('l')?.autonomy).toBe('auto');
  });
  it('an old sessions.json with role/roleLabel/team loads, without them', async () => {
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ sessions: [{ ...mk('r'), role: 'build', roleLabel: 'Build', team: 'team-a1b2', autonomy: 'auto' }] }));
    const s = new Store(); await s.load();
    expect(s.get('r')).toMatchObject({ id: 'r' });
    for (const k of ['role', 'roleLabel', 'team']) expect(s.get('r')).not.toHaveProperty(k);
  });
  it('debounces saves after changes', async () => {
    const s = new Store(); s.upsert(mk('a')); s.upsert(mk('b'));
    await sleep(350);
    const txt = readFileSync(join(dir, 'sessions.json'), 'utf8');
    expect(JSON.parse(txt).sessions.length).toBe(2);
  });
  it('starts empty on a corrupt journal and logs once', async () => {
    writeFileSync(join(dir, 'sessions.json'), '{"sessions": [ {"id": "a", ');
    const s = new Store(); await expect(s.load()).resolves.toMatchObject({ clean: false });
    expect(s.all()).toEqual([]);
    const lines = readFileSync(join(dir, 'daemon.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/journal unreadable/);
    // Kept aside, since the next save overwrites the journal.
    expect(readFileSync(join(dir, 'sessions.json.incomplete'), 'utf8')).toBe('{"sessions": [ {"id": "a", ');
  });
  it('drops journal entries that fail the schema instead of crashing', async () => {
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ sessions: [mk('ok'), { id: 'bad', state: 'sleeping' }] }));
    const s = new Store(); expect(await s.load()).toMatchObject({ clean: false });
    expect(s.all().map(x => x.id)).toEqual(['ok']);
  });
  it('load says whether it loaded cleanly: a whole journal is, a missing one is not', async () => {
    expect(await new Store().load()).toMatchObject({ clean: false });
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ sessions: [mk('ok')] }));
    expect(await new Store().load()).toEqual({ clean: true });
  });
  it('a journal saved after an incomplete load still reads as incomplete on the next load', async () => {
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ sessions: [mk('ok'), { id: 'bad', state: 'sleeping' }] }));
    const s = new Store(); await s.load(); await s.save();
    expect(await new Store().load()).toMatchObject({ clean: false });
  });
});

describe('Store recents', () => {
  const T1 = '2026-10-10T09:00:00.000Z', T2 = '2026-10-10T10:00:00.000Z';
  it('remembers folders most recent first, one entry per folder, and notifies', () => {
    const s = new Store(); const seen: string[] = []; s.onChange(c => seen.push(c.type));
    s.touchRecent('/w/a', 'a', T0); s.touchRecent('/w/b', 'b', T1); s.touchRecent('/w/a', 'a', T2);
    expect(s.recents()).toEqual([{ cwd: '/w/a', project: 'a', lastAt: T2 }, { cwd: '/w/b', project: 'b', lastAt: T1 }]);
    expect(seen).toEqual(['recents', 'recents', 'recents']);
  });
  it('keeps the twelve most recent', () => {
    const s = new Store();
    for (let i = 0; i < 15; i++) s.touchRecent(`/w/${i}`, String(i), new Date(Date.parse(T0) + i * 1000).toISOString());
    expect(s.recents()).toHaveLength(12);
    expect(s.recents()[0]!.cwd).toBe('/w/14'); expect(s.recents()[11]!.cwd).toBe('/w/3');
  });
  it('persists with the journal and loads back; an older journal without recents loads empty', async () => {
    const s = new Store(); s.touchRecent('/w/a', 'a', T1); await s.save();
    const s2 = new Store(); await s2.load();
    expect(s2.recents()).toEqual([{ cwd: '/w/a', project: 'a', lastAt: T1 }]);
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ sessions: [mk('ok')] }));
    const s3 = new Store(); await s3.load();
    expect(s3.recents()).toEqual([]); expect(s3.all().map(x => x.id)).toEqual(['ok']);
  });
});

describe('Store save serialization', () => {
  it('overlapping save() calls both resolve and leave a valid journal', async () => {
    const s = new Store(); s.upsert(mk('a'));
    await Promise.all([s.save(), s.save(), s.save()]);
    const s2 = new Store(); await s2.load();
    expect(s2.get('a')?.id).toBe('a');
  });
  it('patch sets repository fields and is silent when nothing changes', () => {
    const store = new Store(); store.upsert(mk('a'));
    const seen: string[] = []; store.onChange(c => seen.push(c.type));
    store.patch('a', { repo: 'r', repoPath: '/r', branch: 'main', worktree: false });
    expect(store.get('a')).toMatchObject({ repo: 'r', branch: 'main' }); expect(seen).toEqual(['updated']);
    store.patch('a', { repo: 'r', repoPath: '/r', branch: 'main', worktree: false }); expect(seen).toEqual(['updated']);
    store.patch('zz', { branch: 'x' }); expect(seen).toEqual(['updated']);
  });
});

describe('Store archive', () => {
  it('archive is idempotent and survives a reload', async () => {
    const s = new Store(); s.upsert(mk('a', 'exited'));
    s.archive('a', T0); s.archive('a', '2026-10-10T00:00:00.000Z');
    expect(s.get('a')?.archivedAt).toBe(T0);
    await s.save();
    const again = new Store(); await again.load();
    expect(again.get('a')?.archivedAt).toBe(T0);
    expect(again.unarchive('a')?.archivedAt).toBeUndefined();
  });
  it('keeps at most ARCHIVE_MAX archives, dropping the oldest', () => {
    const s = new Store(); const removed: string[] = [];
    s.onChange(c => { if (c.type === 'removed') removed.push(c.id); });
    for (let i = 0; i <= ARCHIVE_MAX; i++) {
      s.upsert(mk(`s${i}`, 'exited'));
      s.archive(`s${i}`, new Date(Date.parse(T0) + i * 1000).toISOString());
    }
    expect(removed).toEqual(['s0']);
    expect(s.get('s0')).toBeUndefined();
    expect(s.all().length).toBe(ARCHIVE_MAX);
  });
});

describe('Store.onApply', () => {
  const ev = { name: 'Stop', at: '2026-10-09T18:01:00.000Z', source: 'hook' } as const;
  it('gives before and after, only when apply changed the session', () => {
    const s = new Store(); const seen: Array<[string | undefined, string]> = [];
    s.onApply((b, a) => seen.push([b?.state, a.state]));
    s.upsert(mk('a'));
    s.apply('a', ev);
    s.apply('a', { name: 'SubagentStop', at: '2026-10-09T18:02:00.000Z', source: 'hook' }); // no helper id: the reducer keeps the same session
    expect(seen).toEqual([['working', 'idle']]);
  });
  it('survives a throwing listener and unsubscribes', () => {
    const s = new Store(); let n = 0;
    s.onApply(() => { throw new Error('boom'); });
    const off = s.onApply(() => { n++; });
    s.upsert(mk('a'));
    expect(s.apply('a', ev)?.state).toBe('idle');
    expect(n).toBe(1);
    off();
    s.apply('a', { name: 'UserPromptSubmit', at: '2026-10-09T18:03:00.000Z', source: 'hook' } as never);
    expect(n).toBe(1);
  });
});
