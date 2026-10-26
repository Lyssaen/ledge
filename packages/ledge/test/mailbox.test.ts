import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClientMessage, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createMailbox, MESSAGES_PER_TURN, type Mailbox, type MailboxDeps } from '../src/daemon/mailbox.js';
import { formatLedgeMessage, formatLedgeNotice, mailId } from '../src/daemon/crossSession.js';

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
    expect(typed).toEqual([['s2', formatLedgeMessage({ from: 'Otto', tool: 'claude', text: 'Salut', to: 'codex', id: mailId('r1') })]]);
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

  it('what waits for a busy target is typed together at its free moment, oldest first, each card delivered', async () => {
    store.upsert(pim({ state: 'working' }));
    answer = async id => { setState(id, 'working'); return null; };
    box.submit(msg({ rid: 'r1', text: 'un' })); box.submit(msg({ rid: 'r2', text: 'deux' }));
    setState('s2', 'idle'); await flush();
    expect(typed).toEqual([['s2', [formatLedgeMessage({ from: 'Otto', tool: 'claude', text: 'un', to: 'codex', id: mailId('r1') }),
      formatLedgeMessage({ from: 'Otto', tool: 'claude', text: 'deux', to: 'codex', id: mailId('r2') })].join(' ')]]);
    expect(sentCalls.filter(c => c[0] === 'mark')).toEqual([['mark', 's1', 'r1', 'delivered'], ['mark', 's1', 'r2', 'delivered']]);
    // One arriving while the target works waits for its next free moment.
    box.submit(msg({ rid: 'r3', text: 'trois' })); await flush();
    expect(typed).toHaveLength(1);
    setState('s2', 'idle'); await flush();
    expect(typed).toHaveLength(2); expect(typed[1]![1]).toContain('trois');
  });

  it('a turn takes a bounded batch; the rest waits for the next free moment', async () => {
    store.upsert(pim({ state: 'working' }));
    answer = async id => { setState(id, 'working'); return null; };
    for (let i = 0; i < MESSAGES_PER_TURN + 1; i++) box.submit(msg({ rid: `r${i}`, text: `n${i}` }));
    setState('s2', 'idle'); await flush();
    expect(typed).toHaveLength(1);
    expect(typed[0]![1].match(/<ledge-message /g)).toHaveLength(MESSAGES_PER_TURN);
    setState('s2', 'idle'); await flush();
    expect(typed[1]![1]).toContain(`n${MESSAGES_PER_TURN}`);
  });

  it('a notice is typed alone, never inside a batch of messages', async () => {
    store.upsert(pim({ state: 'working' }));
    answer = async id => { setState(id, 'working'); return null; };
    box.submit(msg({ rid: 'r1', text: 'un' })); box.notify('s2', '<ledge-task id="t1" from="Otto">x</ledge-task>', 't1:1'); box.submit(msg({ rid: 'r2', text: 'deux' }));
    setState('s2', 'idle'); await flush();
    expect(typed[0]![1]).toContain('un'); expect(typed[0]![1]).not.toContain('ledge-task');
    setState('s2', 'idle'); await flush();
    expect(typed[1]![1]).toBe('<ledge-task id="t1" from="Otto">x</ledge-task>');
    setState('s2', 'idle'); await flush();
    expect(typed[2]![1]).toContain('deux');
  });

  it('an urgent notice (a relief asking for its brief) jumps the line', async () => {
    store.upsert(pim({ state: 'working' }));
    answer = async id => { setState(id, 'working'); return null; };
    box.submit(msg({ rid: 'r1', text: 'un' }));
    box.notify('s2', '<ledge-handover>bilan</ledge-handover>', 'handover:s2', { first: true });
    setState('s2', 'idle'); await flush();
    expect(typed[0]![1]).toBe('<ledge-handover>bilan</ledge-handover>');
  });

  it('a name whose session was relieved reaches its relief, down the chain', async () => {
    store.upsert(mk('s3', { name: 'Lu', state: 'exited', handover: { state: 'done', to: 's4', toName: 'Bix', at: T0 } }));
    store.upsert(mk('s4', { name: 'Bix', state: 'exited', handover: { state: 'done', to: 's5', toName: 'Ida', at: T0 } }));
    store.upsert(mk('s5', { name: 'Ida', state: 'idle' }));
    expect(box.submit(msg({ to: 'Lu' }))).toMatchObject({ outcome: 'accepted' });
    await flush();
    expect(typed[0]![0]).toBe('s5');
    store.upsert(mk('s5', { name: 'Ida', state: 'exited' }));
    expect(box.submit(msg({ rid: 'r9', to: 'Lu' }))).toMatchObject({ outcome: 'refused' });
  });

  it('the same rid twice is delivered once', async () => {
    const a = box.submit(msg()); const b = box.submit(msg());
    expect(b).toEqual(a);
    await flush(); expect(typed).toHaveLength(1);
  });

  it('a refused batch is tried one message at a time: the refused one fails, the next one goes at once', async () => {
    answer = async (_id, t) => (t.includes('un') ? 'refused' : null);
    store.upsert(pim({ state: 'working' }));
    box.submit(msg({ rid: 'r1', text: 'un' })); box.submit(msg({ rid: 'r2', text: 'deux' }));
    setState('s2', 'idle'); for (let i = 0; i < 4; i++) await flush();
    expect(typed.filter(([id]) => id === 's2')).toHaveLength(3);
    expect(sentCalls).toContainEqual(['mark', 's1', 'r1', 'failed']);
    expect(sentCalls).toContainEqual(['mark', 's1', 'r2', 'delivered']);
    // The sender, free, is told which message failed and why.
    expect(typed).toContainEqual(['s1', formatLedgeNotice({ to: 'Pim', text: 'un', reason: 'refused' })]);
  });

  it('a passing refusal (a decision being typed, a prompt meanwhile) keeps the batch first in line for the next free moment', async () => {
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
      expect(typed).toHaveLength(2); expect(typed[1]![1]).toBe(typed[0]![1]);
      expect(sentCalls.filter(c => c[0] === 'mark')).toEqual([['mark', 's1', `${reason}-1`, 'delivered'], ['mark', 's1', `${reason}-2`, 'delivered']]);
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
    expect(typed).toEqual([['s1', formatLedgeNotice({ to: 'Pim', text: 'Salut', reason: "la session s'est terminée avant de le recevoir" })]]);
  });

  it('a sender busy when its message fails gets the notice at its own free moment, and a notice that fails is not told again', async () => {
    setState('s1', 'working'); store.upsert(pim({ state: 'working' }));
    box.submit(msg());
    setState('s2', 'exited'); await flush();
    expect(typed).toEqual([]);
    answer = async () => 'refused';
    setState('s1', 'idle'); await flush(); await flush();
    expect(typed).toHaveLength(1);
    expect(typed[0]![1]).toMatch(/^<ledge-notice to="Pim">/);
    setState('s1', 'working'); setState('s1', 'idle'); await flush();
    expect(typed).toHaveLength(1);
    expect(sentCalls.filter(c => c[0] === 'mark')).toEqual([['mark', 's1', 'r1', 'failed']]);
  });

  it('notify types Ledge\'s own line at the target\'s free moment, and refuses a session it cannot type into', async () => {
    store.upsert(pim({ state: 'working' }));
    expect(box.notify('s2', '<ledge-task id="t1" from="Otto">x</ledge-task>', 't1:1')).toBe(true);
    await flush(); expect(typed).toEqual([]);
    setState('s2', 'idle'); await flush();
    expect(typed).toEqual([['s2', '<ledge-task id="t1" from="Otto">x</ledge-task>']]);
    expect(sentCalls).toEqual([]);
    store.upsert(mk('s3', { name: 'Nova', source: 'hook_only' }));
    expect(box.notify('s3', 'x', 'r')).toBe(false);
    expect(box.notify('nobody', 'x', 'r')).toBe(false);
  });

  it('a sender Ledge cannot type into (hook only, or gone) gets no notice', async () => {
    store.upsert(mk('s1', { state: 'idle', source: 'hook_only' }));
    store.upsert(pim({ state: 'working' }));
    box.submit(msg());
    setState('s2', 'exited'); await flush();
    expect(typed).toEqual([]);
  });

  it('a long body is typed as a pointer, and `read` gives it whole to its receiver or its sender only', async () => {
    const long = Array.from({ length: 20 }, (_, i) => `ligne ${i} <b>`).join('\n');
    box.submit(msg({ text: long, summary: 'Le plan' })); await flush();
    const id = mailId('r1');
    expect(typed[0]![1]).toBe(`<ledge-message from="Otto" tool="claude" id="${id}">(message de la session Otto, pas de l'utilisateur ; pour répondre : ledge send Otto "…") Le plan … [message de ${long.length} caractères, 20 lignes : lis-le en entier avec ledge read ${id}]</ledge-message>`);
    expect(box.read({ type: 'message.read', id, by: 's2' })).toEqual({ type: 'message.body', id, from: 'Otto', to: 'Pim', at: T0, text: long });
    expect(box.read({ type: 'message.read', id, by: 's1' })).toMatchObject({ text: long });
    expect(box.read({ type: 'message.read', id, by: 's9' })).toEqual({ type: 'message.body', id, reason: `le message ${id} ne t'est pas adressé` });
    expect(box.read({ type: 'message.read', id: 'm000000', by: 's2' })).toMatchObject({ reason: expect.stringContaining('aucun message m000000') });
  });

  it('with a journal, a waiting message outlives the daemon; one whose target is gone fails and is told', async () => {
    let saved: Parameters<NonNullable<MailboxDeps['journal']>['save']>[0] | undefined;
    const journal = { load: () => saved, save: (s: typeof saved) => { saved = s; } };
    const long = 'x'.repeat(2000);
    const deps = (extra: Partial<MailboxDeps> = {}): MailboxDeps => ({ store, typing, sent, now: () => T0, relayQueued: () => false,
      replyTo: async (id, text) => { typed.push([id, text]); return null; }, journal, ...extra });
    box.close(); box = createMailbox(deps());
    store.upsert(pim({ state: 'working' })); store.upsert(mk('s3', { name: 'Nova', tool: 'codex', state: 'working' }));
    box.submit(msg({ rid: 'r1', text: long })); box.submit(msg({ rid: 'r2', to: 'Nova' }));
    expect(saved!.queue.map(m => m.rid)).toEqual(['r1', 'r2']);
    // The daemon restarts: Nova is gone meanwhile, Pim still works.
    box.close(); store.remove('s3'); sentCalls = [];
    box = createMailbox(deps()); await flush();
    expect(sentCalls).toEqual([['mark', 's1', 'r2', 'failed']]);
    expect(typed).toEqual([['s1', formatLedgeNotice({ to: 'Nova', text: 'Salut', reason: "la session n'existe plus" })]]);
    expect(saved!.queue.map(m => m.rid)).toEqual(['r1']);
    setState('s2', 'idle'); await flush();
    expect(typed.at(-1)![1]).toContain(`ledge read ${mailId('r1')}`);
    expect(box.read({ type: 'message.read', id: mailId('r1'), by: 's2' })).toMatchObject({ text: long });
    expect(saved!.queue).toEqual([]);
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
