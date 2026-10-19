import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClientMessage, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createMailbox, type Mailbox, type MailboxDeps } from '../src/daemon/mailbox.js';
import { formatLedgeMessage } from '../src/daemon/crossSession.js';

const T0 = '2026-10-19T08:00:00.000Z';
const mk = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: 'Otto', tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: 'Otto · ledge',
  tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });
const pim = (extra: Partial<Session> = {}) => mk('s2', { name: 'Pim', tool: 'codex', state: 'idle', ...extra });
const msg = (extra: Partial<Extract<ClientMessage, { type: 'session.message' }>> = {}): Extract<ClientMessage, { type: 'session.message' }> =>
  ({ type: 'session.message', rid: 'r1', from: 's1', to: 'Pim', text: 'Salut', ...extra });

let store: Store; let typed: Array<[string, string]>; let sentCalls: unknown[][]; let relayQueued: (id: string) => boolean;
let answer: (id: string, text: string) => Promise<string | null>; let box: Mailbox;
const setState = (id: string, state: Session['state']) => store.upsert({ ...store.get(id)!, state });
const flush = () => new Promise(r => setTimeout(r, 0));
const sent: MailboxDeps['sent'] = { record: (...a) => { sentCalls.push(['record', ...a]); }, mark: (...a) => { sentCalls.push(['mark', ...a]); } };

beforeEach(() => {
  store = new Store({ journalPath: join(mkdtempSync(join(tmpdir(), 'mailbox-')), 'j.json') });
  typed = []; sentCalls = []; relayQueued = () => false; answer = async () => null;
  store.upsert(mk('s1', { state: 'idle' })); store.upsert(pim());
  box = createMailbox({ store, typing: new Set(), sent, now: () => T0, relayQueued: id => relayQueued(id),
    replyTo: (id, text) => { typed.push([id, text]); return answer(id, text); } });
});

describe('createMailbox', () => {
  it('a free Codex gets the message now, formatted, and the card is delivered', async () => {
    expect(box.submit(msg())).toMatchObject({ outcome: 'accepted' });
    await flush();
    expect(typed).toEqual([['s2', formatLedgeMessage({ from: 'Otto', tool: 'claude', text: 'Salut', to: 'codex' })]]);
    expect(sentCalls).toEqual([['record', 's1', { rid: 'r1', at: T0, to: 'Pim', peer: 's2', text: 'Salut' }], ['mark', 's1', 'r1', 'delivered']]);
  });

  it('a busy target waits for its free moment', async () => {
    store.upsert(pim({ state: 'working' }));
    expect(box.submit(msg())).toMatchObject({ outcome: 'queued' });
    await flush(); expect(typed).toEqual([]);
    setState('s2', 'idle'); await flush();
    expect(typed).toHaveLength(1);
  });

  it('never into a dialog', async () => {
    store.upsert(pim({ pending: { kind: 'permission', text: 'Bash', source: 'hook' } }));
    expect(box.submit(msg())).toMatchObject({ outcome: 'queued' });
    await flush(); expect(typed).toEqual([]);
  });

  it('a queued chat relay goes first', async () => {
    relayQueued = id => id === 's2';
    expect(box.submit(msg())).toMatchObject({ outcome: 'queued' });
    await flush(); expect(typed).toEqual([]);
    relayQueued = () => false; box.kick('s2'); await flush();
    expect(typed).toHaveLength(1);
  });

  it('one per free moment, oldest first', async () => {
    store.upsert(pim({ state: 'working' }));
    answer = async id => { setState(id, 'working'); return null; };
    box.submit(msg({ rid: 'r1', text: 'un' })); box.submit(msg({ rid: 'r2', text: 'deux' }));
    setState('s2', 'idle'); await flush();
    expect(typed).toHaveLength(1); expect(typed[0]![1]).toContain('un');
    setState('s2', 'idle'); await flush();
    expect(typed).toHaveLength(2); expect(typed[1]![1]).toContain('deux');
  });

  it('the same rid twice is delivered once', async () => {
    const a = box.submit(msg()); const b = box.submit(msg());
    expect(b).toEqual(a);
    await flush(); expect(typed).toHaveLength(1);
  });

  it('a refused message is failed, and the next one goes at once', async () => {
    answer = async (_id, t) => (t.includes('un') ? 'refused' : null);
    store.upsert(pim({ state: 'working' }));
    box.submit(msg({ rid: 'r1', text: 'un' })); box.submit(msg({ rid: 'r2', text: 'deux' }));
    setState('s2', 'idle'); await flush(); await flush();
    expect(typed).toHaveLength(2);
    expect(sentCalls).toContainEqual(['mark', 's1', 'r1', 'failed']);
    expect(sentCalls).toContainEqual(['mark', 's1', 'r2', 'delivered']);
  });

  it('the target exits before delivery', async () => {
    store.upsert(pim({ state: 'working' }));
    box.submit(msg());
    setState('s2', 'exited'); await flush();
    expect(sentCalls).toContainEqual(['mark', 's1', 'r1', 'failed']);
    expect(typed).toEqual([]);
  });

  it('intercept: a Claude target or an unknown name is native', () => {
    expect(box.submit(msg({ rid: 'a', to: 'Otto', intercept: true }))).toMatchObject({ outcome: 'native' });
    expect(box.submit(msg({ rid: 'b', to: 'Nobody', intercept: true }))).toMatchObject({ outcome: 'native' });
    expect(sentCalls).toEqual([]);
  });

  it('refusals', () => {
    expect(box.submit(msg({ to: 'Nobody' }))).toMatchObject({ outcome: 'refused', reason: 'aucune session Ledge nommée Nobody' });
    store.upsert(pim({ source: 'hook_only' }));
    expect(box.submit(msg({ rid: 'r2' }))).toMatchObject({ outcome: 'refused', reason: "Pim n'a pas été lancée par Ledge : impossible de lui écrire" });
    store.upsert(pim());
    expect(box.submit(msg({ rid: 'r3', from: 'zz' }))).toMatchObject({ outcome: 'refused', reason: 'session émettrice inconnue' });
  });
});
