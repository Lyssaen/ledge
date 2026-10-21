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
let typing: Set<string>; let answer: (id: string, text: string) => Promise<string | null>; let box: Mailbox;
const setState = (id: string, state: Session['state']) => store.upsert({ ...store.get(id)!, state });
const flush = () => new Promise(r => setTimeout(r, 0));
const sent: MailboxDeps['sent'] = { record: (...a) => { sentCalls.push(['record', ...a]); }, mark: (...a) => { sentCalls.push(['mark', ...a]); } };

beforeEach(() => {
  store = new Store({ journalPath: join(mkdtempSync(join(tmpdir(), 'mailbox-')), 'j.json') });
  typing = new Set(); typed = []; sentCalls = []; relayQueued = () => false; answer = async () => null;
  store.upsert(mk('s1', { state: 'idle' })); store.upsert(pim());
  box = createMailbox({ store, typing, sent, now: () => T0, relayQueued: id => relayQueued(id),
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
    store.upsert(pim()); await flush();
    expect(typed).toHaveLength(1);
  });

  it('a target already being typed into (the shared lock) is queued, nothing typed', async () => {
    typing.add('s2');
    expect(box.submit(msg())).toMatchObject({ outcome: 'queued' });
    await flush(); expect(typed).toEqual([]);
  });

  it('a sender removed while the message waits does not fail it', async () => {
    store.upsert(pim({ state: 'working' }));
    box.submit(msg());
    store.remove('s1'); setState('s2', 'idle'); await flush();
    expect(typed[0]![1]).toContain('from="Otto"');
    expect(sentCalls).toContainEqual(['mark', 's1', 'r1', 'delivered']);
  });

  it('a queued chat relay goes first', async () => {
    relayQueued = id => id === 's2';
    expect(box.submit(msg())).toMatchObject({ outcome: 'queued' });
    await flush(); expect(typed).toEqual([]);
    relayQueued = () => false; box.kick('s2'); await flush();
    expect(typed).toHaveLength(1);
  });

  it('oldest first; the next waits for the target to be free again', async () => {
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

  it('a passing refusal (a decision being typed, a prompt meanwhile) keeps the message first in line for the next free moment', async () => {
    const passing = ['a decision is already in progress', 'a permission prompt takes accept or deny, not a reply', 'no prompt visible in the terminal, open the tab',
      'free-text answers are not supported yet, answer in the terminal', 'the request changed, look again'];
    for (const reason of passing) {
      typed = []; sentCalls = []; let calls = 0;
      answer = async () => { if (calls++ === 0) throw new Error(reason); return null; };
      store.upsert(pim({ state: 'working' }));
      box.submit(msg({ rid: `${reason}-1`, text: 'un' })); box.submit(msg({ rid: `${reason}-2`, text: 'deux' }));
      setState('s2', 'idle'); await flush(); await flush();
      expect(typed).toHaveLength(1);
      expect(sentCalls.filter(c => c[0] === 'mark')).toEqual([]);
      setState('s2', 'working'); setState('s2', 'idle'); await flush();
      expect(typed).toHaveLength(2); expect(typed[1]![1]).toContain('un');
      expect(sentCalls).toEqual([expect.anything(), expect.anything(), ['mark', 's1', `${reason}-1`, 'delivered']]);
      setState('s2', 'idle'); await flush();
      expect(typed[2]![1]).toContain('deux');
    }
  });

  it('a passing refusal from a target removed meanwhile fails the message', async () => {
    answer = async () => { store.remove('s2'); throw new Error('a decision is already in progress'); };
    box.submit(msg()); await flush(); await flush();
    expect(sentCalls).toContainEqual(['mark', 's1', 'r1', 'failed']);
  });

  it('the target exits before delivery', async () => {
    store.upsert(pim({ state: 'working' }));
    box.submit(msg());
    setState('s2', 'exited'); await flush();
    expect(sentCalls).toContainEqual(['mark', 's1', 'r1', 'failed']);
    expect(typed).toEqual([]);
  });

  it('a closing target is never delivered to, even free; once out of the set, the next store change delivers', async () => {
    box.close();
    const closing = new Set(['s2']);
    box = createMailbox({ store, typing, sent, now: () => T0, relayQueued: id => relayQueued(id), closing,
      replyTo: (id, text) => { typed.push([id, text]); return answer(id, text); } });
    expect(box.submit(msg())).toMatchObject({ outcome: 'queued' });
    box.kick('s2'); setState('s2', 'idle'); await flush();
    expect(typed).toEqual([]);
    closing.delete('s2'); setState('s2', 'idle'); await flush();
    expect(typed).toHaveLength(1);
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
