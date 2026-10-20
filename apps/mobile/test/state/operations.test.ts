// @vitest-environment node
// The last test runs the store on a real PhoneLink, through the real relay, to a fake PC.
import { afterEach, describe, expect, it } from 'vitest';
import type { PhoneClientMessage } from '@ledge/protocol';
import { fingerprint, generateIdentity } from '@ledge/seal';
import { createPhoneLink } from '../../src/link/link';
import { memoryKeys } from '../../src/link/keys';
import { createStore } from '../../src/state/store';
import { isNew, KEEP_FINISHED, loadOps, OPS_KEY, pruneOps, resendable, RESEND_MAX_MS, saveOps, type Op, type OpPhase } from '../../src/state/operations';
import { startFakePc } from '../fakePc';
import { pending, session } from '../model/fixtures';
import { MemoryStorage, snapshot } from './helpers';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (n: number) => new Date(Date.UTC(2026, 9, 14, 10, 0, n)).toISOString();
const decideOp = (n: number, phase: OpPhase, key = 'p1', id = 'a'): Op => ({
  op: uuid(n), phase, at: at(n),
  message: { type: 'session.decide', op: uuid(n), id, decision: 'accept', expect: { key, kind: 'permission', text: 'pnpm test' } }
});
const replyOp = (n: number, phase: OpPhase, id = 'a'): Op => ({ op: uuid(n), phase, at: at(n), message: { type: 'session.reply', op: uuid(n), id, text: 'Bonjour', expect: null } });
const byId = (...ops: Op[]) => Object.fromEntries(ops.map(o => [o.op, o]));
/** A moment just after every op above was made. */
const NOW = Date.parse(at(60));

describe('pruneOps', () => {
  it('keeps every unresolved operation and the 50 latest finished ones', () => {
    const finished = Array.from({ length: 60 }, (_, i) => decideOp(i, i % 3 === 0 ? 'rejected' : 'applied', `k${i}`));
    const open = [decideOp(100, 'sending', 'x'), decideOp(101, 'uncertain', 'y')];
    const kept = pruneOps(byId(...open, ...finished));
    expect(KEEP_FINISHED).toBe(50);
    expect(Object.keys(kept)).toHaveLength(52);
    expect(kept[uuid(100)]).toBeDefined();
    expect(kept[uuid(101)]).toBeDefined();
    expect(kept[uuid(9)]).toBeUndefined();
    expect(kept[uuid(10)]).toBeDefined();
    expect(kept[uuid(59)]).toBeDefined();
  });
  it('returns the same object when nothing is dropped', () => {
    const ops = byId(decideOp(1, 'applied'));
    expect(pruneOps(ops)).toBe(ops);
  });
});

describe('isNew', () => {
  it('refuses a second answer to a request already answered or on its way, not after a refusal', () => {
    const next = decideOp(9, 'sending').message;
    expect(isNew(byId(decideOp(1, 'sending')), next, NOW)).toBe(false);
    expect(isNew(byId(decideOp(1, 'uncertain')), next, NOW)).toBe(false);
    expect(isNew(byId(decideOp(1, 'applied')), next, NOW)).toBe(false);
    expect(isNew(byId(decideOp(1, 'rejected')), next, NOW)).toBe(true);
    expect(isNew(byId(decideOp(1, 'failed')), next, NOW)).toBe(true);
    expect(isNew(byId(decideOp(1, 'applied', 'p0')), next, NOW)).toBe(true);
    expect(isNew(byId(decideOp(1, 'applied', 'p1', 'b')), next, NOW)).toBe(true);
  });
  it('an instruction waits for the one before it on that session; a finished one does not stop it', () => {
    const next = replyOp(9, 'sending').message;
    expect(isNew(byId(replyOp(1, 'sending')), next, NOW)).toBe(false);
    expect(isNew(byId(replyOp(1, 'uncertain')), next, NOW)).toBe(false);
    expect(isNew(byId(replyOp(1, 'applied')), next, NOW)).toBe(true);
    expect(isNew(byId(replyOp(1, 'sending', 'b')), next, NOW)).toBe(true);
  });
  it('an operation id already used is never new', () => {
    const o = replyOp(1, 'applied');
    expect(isNew(byId(o), o.message, NOW)).toBe(false);
  });
  it('an instruction or interrupt of unknown outcome stops blocking once too old to be sent again', () => {
    const next = replyOp(9, 'sending').message;
    const old = Date.parse(at(1)) + RESEND_MAX_MS;
    expect(isNew(byId(replyOp(1, 'uncertain')), next, old - 1)).toBe(false);
    expect(isNew(byId(replyOp(1, 'uncertain')), next, old)).toBe(true);
    expect(isNew(byId(replyOp(1, 'sending')), next, old)).toBe(true);
    // An answer to a request is bound to it by its key: it blocks however old.
    expect(isNew(byId(decideOp(1, 'uncertain')), decideOp(9, 'sending').message, old + 1e9)).toBe(false);
  });
});

describe('resendable', () => {
  const bound = Date.parse(at(1)) + RESEND_MAX_MS;
  it('an answer to a request is always sent again while its outcome is unknown', () => {
    expect(resendable(decideOp(1, 'uncertain'), bound + 1e9)).toBe(true);
    expect(resendable(decideOp(1, 'sending'), bound + 1e9)).toBe(true);
    expect(resendable(decideOp(1, 'applied'), NOW)).toBe(false);
  });
  it('an instruction or interrupt only while younger than RESEND_MAX_MS', () => {
    const interrupt: Op = { op: uuid(1), phase: 'uncertain', at: at(1), message: { type: 'session.interrupt', op: uuid(1), id: 'a' } };
    expect(RESEND_MAX_MS).toBe(300_000);
    expect(resendable(replyOp(1, 'uncertain'), bound - 1)).toBe(true);
    expect(resendable(replyOp(1, 'uncertain'), bound)).toBe(false);
    expect(resendable(interrupt, bound - 1)).toBe(true);
    expect(resendable(interrupt, bound)).toBe(false);
    expect(resendable(replyOp(1, 'rejected'), NOW)).toBe(false);
  });
});

describe('saveOps / loadOps', () => {
  it('round-trips, and an operation still on its way when the page went is uncertain', () => {
    const storage = new MemoryStorage();
    saveOps(byId(decideOp(1, 'sending'), replyOp(2, 'applied')), storage);
    const ops = loadOps(storage);
    expect(ops[uuid(1)]?.phase).toBe('uncertain');
    expect(ops[uuid(2)]?.phase).toBe('applied');
  });
  it('drops what does not parse', () => {
    const storage = new MemoryStorage();
    storage.setItem(OPS_KEY, 'nope');
    expect(loadOps(storage)).toEqual({});
    storage.setItem(OPS_KEY, JSON.stringify({ [uuid(1)]: { op: uuid(1), phase: 'applied', at: at(1), message: { type: 'session.reply', op: 'not-a-uuid', id: 'a', text: 'x', expect: null } }, [uuid(2)]: replyOp(2, 'applied') }));
    expect(Object.keys(loadOps(storage))).toEqual([uuid(2)]);
  });
});

/** Polls on real time, so a slow relay still gets its chance. */
async function until(cond: () => boolean, what: string, ms = 4000): Promise<void> {
  const deadline = performance.now() + ms;
  while (!cond()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

describe('operations over a real link', () => {
  it('a decision whose result was lost is sent again, with the same op, once the PC is back', async () => {
    const identity = await generateIdentity();
    const pc = await startFakePc({ devicePublicKey: identity.publicKey });
    cleanups.push(() => pc.close());
    const keys = memoryKeys(null);
    await keys.saveIdentity(identity);
    await keys.pin({ publicKey: pc.identity.publicKey, fingerprint: await fingerprint(pc.identity.publicKey), name: null, pinnedAt: '2026-10-20T08:00:00.000Z' });
    const link = createPhoneLink({ keys, url: pc.url, WebSocketImpl: pc.PhoneWebSocket, fetchImpl: (async () => new Response(null, { status: 200 })) as unknown as typeof fetch });
    cleanups.push(() => link.close());
    const store = createStore(link, new MemoryStorage());
    cleanups.push(() => store.close());

    const sent = () => pc.received.map((t) => JSON.parse(t) as PhoneClientMessage);
    const decides = () => sent().filter((m) => m.type === 'session.decide');
    await until(() => link.state() === 'ready' && sent().some((m) => m.type === 'snapshot.request'), 'ready');
    await pc.send(snapshot([session('a', { state: 'waiting_permission', unread: true, pending: pending() })]));
    await until(() => store.getState().fresh, 'the snapshot');

    store.read('a', '2026-10-14T10:05:00.000Z');
    const op = store.decide('a', 'accept');
    expect(op).not.toBeNull();
    await until(() => decides().length === 1, 'the decision');

    await pc.disconnect();
    await until(() => link.state() === 'pc_offline', 'the PC gone');
    expect(store.getState().ops[op!]?.phase).toBe('uncertain');
    expect(store.getState().fresh).toBe(false);

    await pc.reconnect();
    await until(() => decides().length === 2, 'the decision sent again');
    expect(decides()[1]).toEqual(decides()[0]);
    expect(decides()[1]).toMatchObject({ op, expect: { key: 'p1' } });
    await until(() => sent().filter((m) => m.type === 'session.read').length === 2, 'the read mark sent again');

    await pc.send({ type: 'operation.result', op: op!, status: 'applied' });
    await until(() => store.getState().ops[op!]?.phase === 'applied', 'the result');
  });
});
