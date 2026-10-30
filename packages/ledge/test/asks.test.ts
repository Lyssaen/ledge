import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AskSchema, type Ask, type Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createAsks, asksJournal, type Asks, type AsksDeps } from '../src/daemon/asks.js';
import { ledgeAnswer } from '../src/daemon/crossSession.js';

const T0 = '2026-10-30T08:00:00.000Z';
const mk = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: `${name} · ledge`,
  tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });

let store: Store; let told: Array<[string, string, string]>; let seen: Ask[]; let asks: Asks; let clock: string; let dir: string;
const notify: AsksDeps['mailbox']['notify'] = (target, text, rid) => { told.push([target, text, rid]); return true; };
const make = (extra: Partial<AsksDeps> = {}) => createAsks({ store, mailbox: { notify }, now: () => clock, onAsk: a => seen.push(a), ...extra });
const ask = (by = 's1'): Ask => { const r = asks.create(by, 'Quelle base ?', 'Postgres, SQLite (je recommande SQLite)'); if ('code' in r) throw new Error(r.reason); return r; };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'asks-'));
  store = new Store({ journalPath: join(dir, 'j.json') });
  store.upsert(mk('s1', 'Nova'));
  told = []; seen = []; clock = T0;
  asks = make();
});

describe('createAsks', () => {
  it('create: an open ask from a live launcher session, id a+6 hex, fromName its name', () => {
    const a = ask();
    expect(a).toMatchObject({ id: expect.stringMatching(/^a[0-9a-f]{6}$/), state: 'open', from: 's1', fromName: 'Nova', question: 'Quelle base ?', options: 'Postgres, SQLite (je recommande SQLite)', at: T0 });
    expect(AskSchema.safeParse(a).success).toBe(true);
    expect(asks.all()).toEqual([a]);
    expect(told).toEqual([]);
  });

  it('create: refused for an unknown or exited session with code not_session', () => {
    expect(asks.create('ghost', 'Q ?', '')).toMatchObject({ code: 'not_session' });
    store.upsert(mk('s2', 'Bix', { state: 'exited' }));
    expect(asks.create('s2', 'Q ?', '')).toMatchObject({ code: 'not_session' });
    store.upsert(mk('s3', 'Arlo', { source: 'hook_only' }));
    expect(asks.create('s3', 'Q ?', '')).toMatchObject({ code: 'not_session' });
    expect(asks.all()).toEqual([]);
  });

  it('answer: closes it, records text and time, and notifies the asker once with a <ledge-answer>', () => {
    const a = ask(); clock = '2026-10-30T08:05:00.000Z';
    const r = asks.answer(a.id, ' B ') as Ask;
    expect(r).toMatchObject({ state: 'answered', answer: { text: 'B', at: clock }, closedAt: clock });
    expect(told).toEqual([['s1', `<ledge-answer id="${a.id}">Réponse de l'utilisateur à « Quelle base ? » : B</ledge-answer>`, `ask:${a.id}`]]);
    expect(ledgeAnswer(told[0]![1])).toEqual({ id: a.id, text: "Réponse de l'utilisateur à « Quelle base ? » : B" });
  });

  it('answer twice: the second is refused with code closed and reason « déjà répondue », and notifies nothing', () => {
    const a = ask();
    asks.answer(a.id, 'B'); told = [];
    expect(asks.answer(a.id, 'C')).toEqual({ code: 'closed', reason: 'déjà répondue' });
    expect(told).toEqual([]);
    expect(asks.all()[0]!.answer!.text).toBe('B');
  });

  it("the asker exits before the answer: the ask drops, and a later answer is refused with « cette session s'est terminée avant ta réponse »", () => {
    const a = ask();
    store.upsert(mk('s1', 'Nova', { state: 'exited' }));
    expect(asks.all()[0]).toMatchObject({ state: 'dropped', closedAt: T0 });
    expect(seen.at(-1)).toMatchObject({ id: a.id, state: 'dropped' });
    expect(asks.answer(a.id, 'B')).toEqual({ code: 'dropped', reason: "cette session s'est terminée avant ta réponse" });
    expect(told).toEqual([]);
  });

  it('the asker is removed before the answer: the ask drops too', () => {
    const a = ask();
    store.remove('s1');
    expect(asks.all().find(x => x.id === a.id)!.state).toBe('dropped');
  });

  it('create: a blank question is refused with code invalid', () => {
    expect(asks.create('s1', '   ', 'A, B')).toMatchObject({ code: 'invalid' });
    expect(asks.all()).toEqual([]);
  });

  it('journal: a malformed entry is dropped, the valid ones load', async () => {
    const path = join(dir, 'asks.json'); const journal = asksJournal(path);
    asks = make({ journal });
    const good = ask(); await journal.flush(); asks.close();
    const bad = { ...good, id: 'abcdef1', question: '' };
    writeFileSync(path, JSON.stringify([good, bad, { nope: true }]));
    expect(asksJournal(path).load()!.map(a => a.id)).toEqual([good.id]);
  });

  it('answer: unknown id refused with code unknown', () => {
    expect(asks.answer('a000000', 'B')).toMatchObject({ code: 'unknown' });
  });

  it('journal: asks outlive the daemon; closed ones older than 7 days are dropped on save', async () => {
    const path = join(dir, 'asks.json'); const journal = asksJournal(path);
    asks = make({ journal });
    const open = ask(); const old = ask(); asks.answer(old.id, 'B');
    clock = '2026-11-10T08:00:00.000Z'; // 11 days later: the answered one is past its week
    store.upsert(mk('s1', 'Nova')); const fresh = ask();
    await journal.flush();
    const reload = asksJournal(path).load()!;
    expect(reload.map(a => a.id).sort()).toEqual([open.id, fresh.id].sort());
    asks.close();
    const again = make({ journal: asksJournal(path) });
    expect(again.all().map(a => a.id).sort()).toEqual([open.id, fresh.id].sort());
  });

  it('a restart finds its asker gone: the open ask drops now', async () => {
    const journal = asksJournal(join(dir, 'asks.json')); asks = make({ journal });
    const a = ask(); await journal.flush(); asks.close();
    store.upsert(mk('s1', 'Nova', { state: 'exited' }));
    expect(make({ journal: asksJournal(join(dir, 'asks.json')) }).all().find(x => x.id === a.id)!.state).toBe('dropped');
  });

  it('emits onAsk on every change', () => {
    const a = ask(); asks.answer(a.id, 'B');
    expect(seen.map(x => x.state)).toEqual(['open', 'answered']);
  });

  it('onChange fires on every change until unsubscribed', () => {
    let n = 0; const off = asks.onChange(() => n++);
    const a = ask(); expect(n).toBe(1);
    off(); asks.answer(a.id, 'B'); expect(n).toBe(1);
  });
});
