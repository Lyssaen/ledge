import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, SessionEvent } from '@ledge/protocol';
import { HistoryStore, turnFromEvent } from '../src/daemon/history.js';

const at = '2026-10-14T18:00:00.000Z';
const ev = (name: SessionEvent['name'], extra: Partial<SessionEvent> = {}): SessionEvent => ({ name, at, source: 'hook', ...extra });
const session = (extra: Partial<Session> = {}): Session => ({
  id: 's1', name: 's1', tool: 'claude', cwd: '/w', project: 'w', title: 't', tmuxSession: null, state: 'idle', helpers: [],
  startedAt: at, lastActivityAt: at, source: 'launcher', ...extra
});
const waiting = session({ state: 'waiting_permission', pending: { id: 'p1', version: 1, kind: 'permission', text: 'rm', source: 'hook' } });

describe('turnFromEvent', () => {
  it('maps a prompt, a reply and a request resolved in the terminal', () => {
    expect(turnFromEvent(ev('UserPromptSubmit', { text: 'fix it' }), session(), session())).toEqual({ kind: 'prompt', text: 'fix it' });
    expect(turnFromEvent(ev('Stop', { text: 'done' }), session(), session())).toEqual({ kind: 'reply', text: 'done' });
    expect(turnFromEvent(ev('PostToolUse', { tool: 'Bash' }), waiting, session({ state: 'working' }))).toEqual({ kind: 'resolved', source: 'pc', pendingId: 'p1' });
    expect(turnFromEvent(ev('Notification'), session(), session())).toBeNull();
    expect(turnFromEvent(ev('UserPromptSubmit'), session(), session())).toBeNull();
  });
  it('a Decided event is not a resolved turn', () => {
    expect(turnFromEvent(ev('Decided', { source: 'daemon' }), waiting, session({ state: 'working' }))).toBeNull();
  });
  it('the end of the session or of its pane is not a resolved turn either', () => {
    expect(turnFromEvent(ev('SessionEnd'), waiting, session({ state: 'exited' }))).toBeNull();
    expect(turnFromEvent(ev('PaneGone', { source: 'daemon' }), waiting, session({ state: 'exited' }))).toBeNull();
  });
});

describe('HistoryStore', () => {
  let dir: string;
  beforeEach(() => { dir = join(mkdtempSync(join(tmpdir(), 'ledge-hist-')), 'history'); });
  const turn = (i: number) => ({ at, kind: 'prompt' as const, text: `t${i}` });

  it('numbers from 1 and tracks the last reply', async () => {
    const h = new HistoryStore({ dir });
    expect(h.lastSeq('a')).toBe(0);
    expect(h.next('a', turn(1)).seq).toBe(1);
    expect(h.next('a', { at, kind: 'reply', text: 'r' }).seq).toBe(2);
    h.next('a', turn(3));
    expect(h.lastSeq('a')).toBe(3); expect(h.lastReplySeq('a')).toBe(2);
    expect((await h.read('a')).map(t => t.seq)).toEqual([1, 2, 3]);
  });
  it('keeps the last 200 turns in order', async () => {
    const h = new HistoryStore({ dir });
    for (let i = 1; i <= 260; i++) h.next('a', turn(i));
    const turns = await h.read('a');
    expect(turns).toHaveLength(200);
    expect(turns[0]!.seq).toBe(61); expect(turns.at(-1)!.seq).toBe(260);
    expect(turns.map(t => t.seq)).toEqual([...Array(200).keys()].map(i => i + 61));
    // compaction rewrote the file: it is far below the 260 lines appended
    expect(readFileSync(join(dir, 'a.jsonl'), 'utf8').split('\n').filter(Boolean).length).toBeLessThanOrEqual(250);
    expect(existsSync(join(dir, 'a.jsonl.tmp'))).toBe(false);
  });
  it('survives a restart: a new store reads the same turns and continues the numbering', async () => {
    const h = new HistoryStore({ dir });
    h.next('a', turn(1)); h.next('a', { at, kind: 'reply', text: 'r' }); h.next('a', turn(3));
    await h.flush();
    const again = new HistoryStore({ dir });
    expect(again.lastSeq('a')).toBe(3); expect(again.lastReplySeq('a')).toBe(2);
    expect(again.next('a', turn(4)).seq).toBe(4);
    expect((await again.read('a')).map(t => t.text)).toEqual(['t1', 'r', 't3', 't4']);
  });
  it('remove deletes the file; prune keeps only live sessions', async () => {
    const h = new HistoryStore({ dir });
    for (const id of ['a', 'b', 'c']) h.next(id, turn(1));
    await h.flush();
    await h.remove('a');
    expect(readdirSync(dir).sort()).toEqual(['b.jsonl', 'c.jsonl']);
    expect(h.lastSeq('a')).toBe(0);
    await h.prune(new Set(['c']));
    expect(readdirSync(dir)).toEqual(['c.jsonl']);
    expect(await h.read('b')).toEqual([]);
  });
  it('an id with a slash never escapes the history folder', async () => {
    const h = new HistoryStore({ dir });
    for (const id of ['../../x', '..', '.', 'a/b']) h.next(id, turn(1));
    await h.flush();
    const names = readdirSync(dir);
    expect(names).toHaveLength(4);
    for (const n of names) expect(n).toMatch(/^[0-9a-f]{64}\.jsonl$/);
    expect(existsSync(join(dir, '..', '..', 'x.jsonl'))).toBe(false);
    expect(await h.read('../../x')).toHaveLength(1);
    await h.prune(new Set(['../../x']));
    expect(readdirSync(dir)).toHaveLength(1);
  });
  it('keeps the folder private (0700) and files 0600', async () => {
    const h = new HistoryStore({ dir });
    h.next('a', turn(1)); await h.flush();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'a.jsonl')).mode & 0o777).toBe(0o600);
  });
  it('skips a torn line', async () => {
    const h = new HistoryStore({ dir });
    h.next('a', turn(1)); await h.flush();
    const { appendFileSync } = await import('node:fs');
    appendFileSync(join(dir, 'a.jsonl'), '{"seq":2,"at"\n');
    expect((await new HistoryStore({ dir }).read('a')).map(t => t.seq)).toEqual([1]);
  });
});
