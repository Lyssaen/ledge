import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Escalation, LedgeThreadItem, ServerMessage, Tool } from '@ledge/protocol';
import { createLedgeThread, type LedgeThread } from '../src/daemon/ledgeThread.js';
import { createLedgeSay, type SeatSendResult } from '../src/daemon/ledgeSay.js';
import { ONE_AT_A_TIME, TOO_MANY, type Chat, type ChatMessage } from '../src/chat/service.js';

const AT = '2026-10-31T10:00:00.000Z';
let thread: LedgeThread;
let n: number;
let sent: ServerMessage[];

beforeEach(() => {
  n = 0; sent = [];
  thread = createLedgeThread({ path: join(mkdtempSync(join(tmpdir(), 'ledge-say-')), 'ledge-thread.jsonl'), now: () => AT, uuid: () => `t${++n}` });
});

const items = () => thread.page().items;
const kinds = () => items().map(i => i.kind);
const last = () => items().at(-1)!;
const flushAll = () => new Promise(r => setTimeout(r, 0));

type Asked = { qid: string; text: string; tool?: Tool };
/** A fake Chat: each ask waits until the test answers it (or answers at once with `auto`). */
function fakeChat(o: { auto?: string; busyFirst?: number } = {}) {
  const asked: Asked[] = [];
  const pending: Array<{ qid: string; emit: (m: ChatMessage) => void; res: () => void }> = [];
  let busy = false; let busyFirst = o.busyFirst ?? 0;
  let idleWaiters: Array<() => void> = [];
  const free = () => { busy = false; const w = idleWaiters; idleWaiters = []; for (const r of w) r(); };
  const chat = {
    async ask(qid: string, text: string, emit: (m: ChatMessage) => void, tool?: Tool) {
      // Someone else (a docked chat.ask, a phone) holds the chat: refused as the real service does.
      if (busy || busyFirst > 0) { if (busyFirst > 0) { busyFirst--; busy = true; queueMicrotask(free); } return emit({ type: 'chat.error', qid, message: ONE_AT_A_TIME }); }
      busy = true;
      asked.push({ qid, text, tool });
      emit({ type: 'chat.history', turns: [{ qid, question: text, askedAt: AT, steps: [] }] });
      if (o.auto !== undefined) { emit({ type: 'chat.delta', qid, text: o.auto }); emit({ type: 'chat.done', qid, text: o.auto, at: AT }); free(); return; }
      await new Promise<void>(res => pending.push({ qid, emit, res }));
      free();
    },
    idle: () => (busy ? new Promise<void>(r => { idleWaiters.push(r); }) : Promise.resolve()),
  } as unknown as Chat;
  const answer = (text: string) => { const p = pending.shift()!; p.emit({ type: 'chat.delta', qid: p.qid, text }); p.emit({ type: 'chat.done', qid: p.qid, text, at: AT }); p.res(); };
  const fail = (message: string) => { const p = pending.shift()!; p.emit({ type: 'chat.error', qid: p.qid, message }); p.res(); };
  return { chat, asked, answer, fail, pending };
}

const ESC: Escalation = { id: 'qi-1', source: 'rig', machine: 'local', rigId: 'r1', from: 'dev-build@factory', intent: 'decision',
  summary: 'Faut-il garder le cache ?', questions: [{ id: 'q1', question: 'Le cache ?', options: [{ id: 'a', label: 'Garder' }, { id: 'b', label: 'Supprimer' }] }],
  createdAt: AT, state: 'pending', category: 'architecture' };

const make = (chat: Chat, extra: Partial<Parameters<typeof createLedgeSay>[0]> = {}) => createLedgeSay({
  thread, chat, escalations: id => (id === ESC.id ? ESC : undefined), toSeat: async () => null, tool: () => 'codex',
  broadcast: m => { sent.push(m); }, ...extra
});

describe('ledge.say by the one-shot runner', () => {
  it('say appends the user item then a pending bubble completed by chat.done', async () => {
    const f = fakeChat();
    const say = make(f.chat);
    const done = say.say('r1', 'Où en sont les rigs ?');
    // The user item is written before say() returns: the server answers rig.result right then.
    expect(kinds()[0]).toBe('user');
    await flushAll();
    expect(kinds()).toEqual(['user', 'ledge']);
    const user = items()[0] as Extract<LedgeThreadItem, { kind: 'user' }>;
    expect(user.qid).toBe(user.id);
    expect(last()).toMatchObject({ kind: 'ledge', text: '', pending: true, qid: user.id });
    expect(f.asked).toEqual([{ qid: user.id, text: 'Où en sont les rigs ?', tool: 'codex' }]);
    f.answer('Deux rigs tournent.');
    await done;
    expect(kinds()).toEqual(['user', 'ledge']);
    expect(last()).toMatchObject({ kind: 'ledge', text: 'Deux rigs tournent.', qid: user.id });
    expect((last() as { pending?: true }).pending).toBeUndefined();
    // Every chat.* is broadcast as is: the clients keep the turn's cards through chat.history.
    expect(sent.map(m => m.type)).toEqual(['chat.history', 'chat.delta', 'chat.done']);
  });

  it('a say while answering waits its turn', async () => {
    const f = fakeChat();
    const say = make(f.chat);
    const one = say.say('r1', 'un');
    const two = say.say('r2', 'deux');
    await flushAll();
    expect(f.asked.map(a => a.text)).toEqual(['un']);
    expect(kinds()).toEqual(['user', 'ledge', 'user']);
    f.answer('A1');
    await one; await flushAll();
    expect(f.asked.map(a => a.text)).toEqual(['un', 'deux']);
    f.answer('A2');
    await two;
    expect(items().filter(i => i.kind === 'ledge').map(i => (i as { text: string }).text)).toEqual(['A1', 'A2']);
  });

  it('past 5 waiting, Ledge says so instead of queueing', async () => {
    const f = fakeChat();
    const say = make(f.chat);
    const all = ['0', '1', '2', '3', '4', '5'].map(t => say.say(`r${t}`, t));
    await flushAll();
    expect(f.asked.length).toBe(1);
    void say.say('r6', 'six');
    await flushAll();
    expect(last()).toMatchObject({ kind: 'ledge', text: 'Je réponds encore à tes messages précédents : renvoie celui-ci dans un instant.' });
    const refused = items().find(i => i.kind === 'user' && i.text === 'six') as { qid?: string };
    expect(refused.qid).toBeUndefined();
    for (let i = 0; i < 6; i++) { f.answer(`A${i}`); await all[i]; await flushAll(); }
    expect(f.asked.map(a => a.text)).toEqual(['0', '1', '2', '3', '4', '5']);
  });

  it('about prefixes the question with the escalation', async () => {
    const f = fakeChat({ auto: 'ok' });
    const say = make(f.chat);
    await say.say('r1', 'Tu en penses quoi ?', 'qi-1');
    const q = f.asked[0]!.text;
    expect(q.startsWith("[Ledge] L'utilisateur parle de l'escalade qi-1 (dev-build@factory, Architecture) : « Faut-il garder le cache ? ». Ses options : ")).toBe(true);
    expect(q).toContain('Garder'); expect(q).toContain('Supprimer');
    expect(q.endsWith('\nTu en penses quoi ?')).toBe(true);
    // The thread keeps what the user typed.
    expect(items()[0]).toMatchObject({ kind: 'user', text: 'Tu en penses quoi ?' });
  });

  it('an unknown escalation asks the bare question', async () => {
    const f = fakeChat({ auto: 'ok' });
    await make(f.chat, { escalations: () => undefined }).say('r1', 'Et ça ?', 'qi-9');
    expect(f.asked[0]!.text).toBe('Et ça ?');
  });

  it('a chat error ends the bubble with the reason', async () => {
    const f = fakeChat();
    const say = make(f.chat);
    const done = say.say('r1', 'Hé');
    await flushAll();
    f.fail('claude exited');
    await done;
    expect(last()).toMatchObject({ kind: 'ledge', text: "Je n'ai pas pu répondre : claude exited" });
    expect((last() as { pending?: true }).pending).toBeUndefined();
  });

  it('a chat held by another asker is waited for, not reported as an error', async () => {
    const f = fakeChat({ auto: 'Me voilà.', busyFirst: 1 });
    await make(f.chat).say('r1', 'Hé');
    expect(f.asked.length).toBe(1);
    expect(last()).toMatchObject({ kind: 'ledge', text: 'Me voilà.' });
    expect(sent.some(m => m.type === 'chat.error')).toBe(false);
  });

  it('setResponder replaces the one-shot runner', async () => {
    const f = fakeChat({ auto: 'non' });
    const say = make(f.chat);
    const seen: Array<{ text: string; about?: string }> = [];
    say.setResponder(async (item, about) => { seen.push({ text: item.text, about: about?.id }); });
    await say.say('r1', 'Bonjour', 'qi-1');
    expect(seen).toEqual([{ text: 'Bonjour', about: 'qi-1' }]);
    expect(f.asked).toEqual([]);
    say.setResponder(null);
    await say.say('r2', 'Encore');
    expect(f.asked.map(a => a.text)).toEqual(['Encore']);
  });

  it('a text for a seat goes to toSeat: sent → user item with to, no bubble; refused → the reason', async () => {
    const f = fakeChat({ auto: 'non' });
    const results: Array<SeatSendResult | null> = [{ ok: true, to: '@build' }, { ok: false, reason: '@qa est arrêté (factory)' }, null];
    const say = make(f.chat, { toSeat: async () => results.shift()! });
    await say.say('r1', '@build relance les tests');
    expect(items()).toEqual([expect.objectContaining({ kind: 'user', text: '@build relance les tests', to: '@build' })]);
    await say.say('r2', '@qa lance-toi');
    expect(last()).toMatchObject({ kind: 'ledge', text: '@qa est arrêté (factory)' });
    // A word that is no seat: a question to Ledge.
    await say.say('r3', '@Otto où en es-tu ?');
    expect(f.asked.map(a => a.text)).toEqual(['@Otto où en es-tu ?']);
  });
  it('an @word message that falls back to Ledge is not overtaken by a plain message sent while toSeat is awaited', async () => {
    const f = fakeChat({ auto: 'ok' });
    let release!: (v: SeatSendResult | null) => void;
    const say = make(f.chat, { toSeat: () => new Promise(r => { release = r; }) });
    const a = say.say('r1', '@Otto où en es-tu ?');
    const b = say.say('r2', 'puis ça ?');
    await flushAll();
    expect(f.asked).toEqual([]);          // b waits behind a's reserved place
    release(null);
    await Promise.all([a, b]);
    expect(f.asked.map(x => x.text)).toEqual(['@Otto où en es-tu ?', 'puis ça ?']);
  });

  it('a sent @seat message frees its place at once', async () => {
    const f = fakeChat({ auto: 'ok' });
    const say = make(f.chat, { toSeat: async () => ({ ok: true, to: '@build' }) });
    await say.say('r1', '@build go');
    await say.say('r2', 'bonjour');
    expect(f.asked.map(x => x.text)).toEqual(['bonjour']);
  });

  it('gives up after 30 TOO_MANY retries and ends the bubble with the failure', async () => {
    let asks = 0;
    const chat = { async ask(qid: string, _t: string, emit: (m: ChatMessage) => void) { asks++; emit({ type: 'chat.error', qid, message: TOO_MANY }); }, idle: async () => {} } as unknown as Chat;
    const say = make(chat, { retryMs: 0 });
    await say.say('r1', 'bonjour');
    expect(asks).toBe(30);
    expect(last()).toMatchObject({ kind: 'ledge', text: `Je n'ai pas pu répondre : ${TOO_MANY}` });
    expect((last() as { pending?: boolean }).pending).toBeUndefined();
  });
});
