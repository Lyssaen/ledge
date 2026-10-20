// @vitest-environment node
// Node's own WebSocket reaches the real relay; jsdom's would replace it.
import { createServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneServerMessage, RelayServerMessage } from '@ledge/protocol';
import { fingerprint, generateIdentity } from '@ledge/seal';
import { createPhoneLink, type LinkState, type PhoneLink } from '../../src/link/link';
import { memoryKeys, type KeyStore } from '../../src/link/keys';
import { PAIRING_TTL_MS } from '../../src/link/pairing';
import { startFakePc, type FakePc } from '../fakePc';
import { MemoryStorage, snapshot } from '../state/helpers';

/** Polls on real time (performance.now), so a test that fakes Date still times out. */
async function until(cond: () => boolean, what = 'condition', ms = 3000): Promise<void> {
  const deadline = performance.now() + ms;
  while (!cond()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
const settle = () => new Promise((r) => setTimeout(r, 150));

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** `/auth/logout` and `/auth/me` as the relay would answer them, recorded. */
function authStub() {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response(null, { status: 200 });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

function watch(link: PhoneLink) {
  const states: LinkState[] = [link.state()];
  const messages: PhoneServerMessage[] = [];
  let notified = 0;
  link.subscribe(() => {
    notified++;
    const s = link.state();
    if (states[states.length - 1] !== s) states.push(s);
  });
  link.onMessage((m) => messages.push(m));
  return { states, messages, notified: () => notified };
}

function open(pc: FakePc, keys: KeyStore) {
  const auth = authStub();
  const link = createPhoneLink({ keys, url: pc.url, WebSocketImpl: pc.PhoneWebSocket, fetchImpl: auth.fetchImpl });
  cleanups.push(() => link.close());
  return { link, auth, ...watch(link) };
}

/** A phone already paired with the fake PC: its identity stored, the PC pinned. */
async function paired(opts: { pcAway?: boolean } = {}) {
  const identity = await generateIdentity();
  const pc = await startFakePc({ devicePublicKey: identity.publicKey });
  cleanups.push(() => pc.close());
  const keys = memoryKeys(null);
  await keys.saveIdentity(identity);
  await keys.pin({ publicKey: pc.identity.publicKey, fingerprint: await fingerprint(pc.identity.publicKey), name: null, pinnedAt: '2026-10-20T08:00:00.000Z' });
  if (opts.pcAway) await pc.disconnect();
  const hellos = () => pc.frames.filter((f) => f.k === 'hello').length;
  return { pc, keys, identity, hellos, ...open(pc, keys) };
}

async function ready() {
  const s = await paired();
  await until(() => s.link.state() === 'ready', 'ready');
  return s;
}

/** A local port nothing listens on: a socket to it is refused at once. */
async function closedPort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as { port: number };
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

/** A link to `pc` whose socket records every frame the phone sends: the relay drops one to an offline PC, this does not. */
function recording(pc: FakePc) {
  const wire: string[] = [];
  const Recording = class extends pc.PhoneWebSocket {
    override send(data: string | ArrayBufferLike | Blob | ArrayBufferView) { wire.push(String(data)); super.send(data); }
  } as typeof WebSocket;
  const link = createPhoneLink({ keys: memoryKeys(null), url: pc.url, WebSocketImpl: Recording, fetchImpl: authStub().fetchImpl });
  cleanups.push(() => link.close());
  return { link, wire, commits: () => wire.filter((t) => t.includes('pair_commit')).length };
}

/** Every reach the link's listeners were told of, without repeats. */
function reachesOf(link: PhoneLink) {
  const reaches: string[] = [link.reach()];
  link.subscribe(() => { const r = link.reach(); if (reaches[reaches.length - 1] !== r) reaches.push(r); });
  return reaches;
}

const parsed = (pc: FakePc) => pc.received.map((t) => JSON.parse(t) as unknown);
const afterReady = (watched: string | null) => [{ type: 'snapshot.request' }, { type: 'session.watch', id: watched }];

describe('PhoneLink', () => {
  it('pairs, pins the PC of the offer, then opens the channel', async () => {
    const pc = await startFakePc();
    cleanups.push(() => pc.close());
    const keys = memoryKeys(null);
    const { link, states } = open(pc, keys);
    await until(() => link.state() === 'unpaired', 'unpaired');
    expect(link.pairing()).toBeNull();
    link.startPairing();
    expect(link.state()).toBe('pairing');
    await until(() => link.pairing()?.state().step === 'compare', 'compare');
    const s = link.pairing()!.state();
    expect(s.step === 'compare' && s.code).toBe(await pc.code());
    pc.ok();
    await until(() => { const p = link.pairing()!.state(); return p.step === 'compare' && p.pcConfirmed; }, 'pcConfirmed');
    link.pairing()!.confirmOnPhone();
    await until(() => link.state() === 'ready', 'ready');
    expect((await keys.pinned())?.publicKey).toBe(pc.identity.publicKey);
    expect((await keys.identity())?.publicKey).toBe(pc.devicePublicKey);
    expect(states).toEqual(expect.arrayContaining(['unpaired', 'pairing', 'ready']));
    expect(link.pairing()!.state().step).toBe('linked');
  });

  it('starts pairing asked before the socket is open, once it is', async () => {
    const pc = await startFakePc();
    cleanups.push(() => pc.close());
    const { link } = open(pc, memoryKeys(null));
    const commit = pc.waitFor('pair_commit');
    link.startPairing();
    expect((await commit).k).toBe('pair_commit');
  });

  it('unpaired with the PC offline → no pair_commit on the wire; the PC comes online → exactly one', async () => {
    const pc = await startFakePc();
    cleanups.push(() => pc.close());
    await pc.disconnect();
    const { link, commits } = recording(pc);
    const reaches = reachesOf(link);
    link.startPairing();
    await until(() => link.reach() === 'pc_offline', 'pc_offline');
    await settle();
    expect(commits()).toBe(0);
    expect(link.state()).toBe('pairing');
    expect(link.pairing()).toBeNull();
    const commit = pc.waitFor('pair_commit');
    await pc.reconnect();
    await commit;
    await until(() => link.pairing()?.state().step === 'compare', 'compare');
    await settle();
    expect(commits()).toBe(1);
    // The listeners heard the PC come and go, though the state stayed `pairing`.
    expect(reaches).toEqual(expect.arrayContaining(['pc_offline', 'pc_online']));
  });

  it.each([
    ['presence offline', (pc: FakePc) => pc.disconnect(), (pc: FakePc) => pc.reconnect()],
    // The relay bounced a frame: the PC left. Its presence back is what brings it back.
    ['error offline to:pc', async (pc: FakePc) => { pc.injectToPhone({ type: 'error', code: 'offline', to: 'pc' }); },
      async (pc: FakePc) => { pc.injectToPhone({ type: 'presence', peer: 'pc', online: true }); }]
  ] as const)('a commit waiting when the PC goes away (%s) → dropped, back to waiting; the PC back → exactly one new commit', async (_, away, back) => {
    const pc = await startFakePc({ autoOffer: false });
    cleanups.push(() => pc.close());
    const { link, commits } = recording(pc);
    const first = pc.waitFor('pair_commit');
    link.startPairing();
    await first;
    expect(link.pairing()!.state().step).toBe('committing');
    await away(pc);
    await until(() => link.pairing() === null, 'the commit dropped');
    expect(link.state()).toBe('pairing');
    expect(link.reach()).toBe('pc_offline');
    await settle();
    expect(commits()).toBe(1);
    const again = pc.waitFor('pair_commit');
    await back(pc);
    await again;
    await until(() => link.pairing()?.state().step === 'committing', 'committing again');
    await settle();
    expect(commits()).toBe(2);
  });

  it('a pairing with the relay out of reach → relay_unreachable, no commit; « Réessayer » once it is reachable → the commit', async () => {
    const pc = await startFakePc();
    cleanups.push(() => pc.close());
    const dead = `ws://127.0.0.1:${await closedPort()}/ws`;
    let reachable = false;
    const Flaky = class extends pc.PhoneWebSocket {
      constructor(url: string | URL) { super(reachable ? url : dead); }
    } as typeof WebSocket;
    const link = createPhoneLink({ keys: memoryKeys(null), url: pc.url, WebSocketImpl: Flaky, fetchImpl: authStub().fetchImpl });
    cleanups.push(() => link.close());
    const reaches = reachesOf(link);
    link.startPairing();
    await until(() => link.reach() === 'relay_unreachable', 'relay_unreachable');
    expect(link.state()).toBe('pairing');
    expect(link.pairing()).toBeNull();
    expect(reaches).toContain('relay_unreachable');
    reachable = true;
    const commit = pc.waitFor('pair_commit');
    link.retry();
    await commit;
    expect(link.reach()).toBe('pc_online');
  });

  it('surfaces an expired pairing to its listeners, without a frame from the PC', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const pc = await startFakePc({ autoOffer: false });
    cleanups.push(() => pc.close());
    const { link, notified } = open(pc, memoryKeys(null));
    const commit = pc.waitFor('pair_commit');
    link.startPairing();
    await commit;
    expect(link.pairing()!.state().step).toBe('committing');
    const before = notified();
    vi.setSystemTime(Date.now() + PAIRING_TTL_MS + 1);
    vi.advanceTimersByTime(1_000);
    expect(notified()).toBeGreaterThan(before);
    expect(link.pairing()!.state().step).toBe('expired');
    expect(link.state()).toBe('pairing');
  });

  it('after each ready, asks for a snapshot then watches the last session asked for', async () => {
    const { pc, link } = await ready();
    await until(() => pc.received.length === 2, 'snapshot.request and session.watch');
    expect(parsed(pc)).toEqual(afterReady(null));
    expect(await link.send({ type: 'session.watch', id: 's1' })).toBe(true);
    pc.sendFrame({ k: 'rekey' });
    await until(() => pc.received.length === 5, 'the second ready');
    expect(parsed(pc).slice(2)).toEqual([{ type: 'session.watch', id: 's1' }, ...afterReady('s1')]);
  });

  it('delivers PC messages to its listeners, ignores an invalid one, and logs nothing of it', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const { pc, messages } = await ready();
    await pc.send({ type: 'session.removed', id: 42, secret: 'SECRET-CONTENT' } as unknown as PhoneServerMessage);
    await pc.send({ type: 'session.removed', id: 's1' });
    await until(() => messages.length === 1, 'the valid message');
    await settle();
    expect(messages).toEqual([{ type: 'session.removed', id: 's1' }]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('welcome without the PC → pc_offline; it comes online → hello → ready, with the watch asked meanwhile', async () => {
    const { pc, link, hellos } = await paired({ pcAway: true });
    await until(() => link.state() === 'pc_offline', 'pc_offline');
    expect(await link.send({ type: 'session.watch', id: 's2' })).toBe(false);
    expect(hellos()).toBe(0);
    await pc.reconnect();
    await until(() => link.state() === 'ready', 'ready');
    expect(hellos()).toBe(1);
    await until(() => pc.received.length === 2, 'snapshot.request and session.watch');
    expect(parsed(pc)).toEqual(afterReady('s2'));
  });

  it('the PC going offline → pc_offline, and nothing is sent', async () => {
    const { pc, link } = await ready();
    await pc.disconnect();
    await until(() => link.state() === 'pc_offline', 'pc_offline');
    expect(await link.send({ type: 'snapshot.request' })).toBe(false);
  });

  it('says hello again on a new welcome', async () => {
    const { pc, link, hellos, states } = await ready();
    pc.phoneSockets[pc.phoneSockets.length - 1]!.close();
    await until(() => link.state() !== 'ready', 'the drop');
    await until(() => hellos() === 2 && link.state() === 'ready', 'the second ready', 5000);
    expect(states.filter((s) => s === 'ready')).toHaveLength(2);
  });

  for (const error of [
    { type: 'error', code: 'offline', to: 'pc' },
    { type: 'error', code: 'too_large', to: 'pc' },
    { type: 'error', code: 'rate_limited' }
  ] satisfies RelayServerMessage[]) {
    it(`says hello again on a relay error ${error.code}`, async () => {
      const { pc, link, hellos } = await ready();
      pc.injectToPhone(error);
      await until(() => hellos() === 2 && pc.ready && link.state() === 'ready', 'the second ready');
    });
  }

  it('ignores sealed frames from any peer but the PC', async () => {
    const { pc, link, keys } = await ready();
    pc.injectToPhone({ type: 'deliver', from: 'd_anotherphone0001', body: JSON.stringify({ k: 'denied' }) });
    await settle();
    expect(link.state()).toBe('ready');
    expect(await keys.pinned()).not.toBeNull();
  });

  it('a denied answering our hello → denied: keys and cache kept, nothing erased, no pair_commit', async () => {
    const identity = await generateIdentity();
    // A PC that does not know this phone's key: it answers the hello with denied.
    const pc = await startFakePc();
    cleanups.push(() => pc.close());
    const storage = new MemoryStorage();
    storage.setItem('ledge.mobile.drafts', '{"s1":"brouillon"}');
    const keys = memoryKeys(storage);
    await keys.saveIdentity(identity);
    await keys.pin({ publicKey: pc.identity.publicKey, fingerprint: await fingerprint(pc.identity.publicKey), name: null, pinnedAt: '2026-10-20T08:00:00.000Z' });
    const { link, states } = open(pc, keys);
    await until(() => link.state() === 'denied', 'denied');
    await settle();
    expect(link.state()).toBe('denied');
    expect(states).not.toContain('unpaired');
    expect(await keys.identity()).toBe(identity);
    expect((await keys.pinned())?.publicKey).toBe(pc.identity.publicKey);
    expect(storage.getItem('ledge.mobile.drafts')).toBe('{"s1":"brouillon"}');
    expect(await link.send({ type: 'snapshot.request' })).toBe(false);
    // Nothing more leaves: no pairing of its own, no hello on a retry or a PC back online.
    link.retry();
    pc.injectToPhone({ type: 'presence', peer: 'pc', online: true });
    await settle();
    expect(pc.frames.map((f) => f.k)).toEqual(['hello']);
    expect(link.state()).toBe('denied');
  });

  it('a forged denied with no hello of ours pending → ignored, nothing erased', async () => {
    const { pc, link, keys, states } = await ready();
    pc.injectToPhone({ type: 'deliver', from: 'pc', body: JSON.stringify({ k: 'denied' }) });
    await settle();
    expect(link.state()).toBe('ready');
    expect(states).not.toContain('denied');
    expect(await keys.pinned()).not.toBeNull();
    expect(await keys.identity()).not.toBeNull();
    expect(pc.frames.filter((f) => f.k === 'pair_commit')).toEqual([]);
  });

  it('denied → relink forgets the keys and pairs again, straight to pairing', async () => {
    const identity = await generateIdentity();
    const pc = await startFakePc();
    cleanups.push(() => pc.close());
    const keys = memoryKeys(null);
    await keys.saveIdentity(identity);
    await keys.pin({ publicKey: pc.identity.publicKey, fingerprint: await fingerprint(pc.identity.publicKey), name: null, pinnedAt: '2026-10-20T08:00:00.000Z' });
    const { link } = open(pc, keys);
    await until(() => link.state() === 'denied', 'denied');
    const commit = pc.waitFor('pair_commit');
    const { states } = watch(link);
    await link.relink();
    expect(await keys.pinned()).toBeNull();
    await commit;
    expect(link.state()).toBe('pairing');
    expect(states).toEqual(['denied', 'pairing']);
  });

  it('a hello from another key → key_changed, nothing sent; relink forgets and pairs again', async () => {
    const identity = await generateIdentity();
    const pc = await startFakePc({ devicePublicKey: identity.publicKey });
    cleanups.push(() => pc.close());
    pc.answerAs(await generateIdentity());
    const keys = memoryKeys(null);
    await keys.saveIdentity(identity);
    await keys.pin({ publicKey: pc.identity.publicKey, fingerprint: await fingerprint(pc.identity.publicKey), name: null, pinnedAt: '2026-10-20T08:00:00.000Z' });
    const { link } = open(pc, keys);
    await until(() => link.state() === 'key_changed', 'key_changed');
    expect(await link.send({ type: 'snapshot.request' })).toBe(false);
    pc.injectToPhone({ type: 'presence', peer: 'pc', online: true });
    await settle();
    expect(pc.frames.map((f) => f.k)).toEqual(['hello']);
    expect(link.state()).toBe('key_changed');

    const commit = pc.waitFor('pair_commit');
    const { states } = watch(link);
    await link.relink();
    expect(await keys.pinned()).toBeNull();
    await commit;
    expect(link.state()).toBe('pairing');
    // Straight to pairing: an « unpaired » in between would have the app start a second pairing.
    expect(states).toEqual(['key_changed', 'pairing']);
  });

  it('a launch with the relay out of reach → pc_offline; once it is reachable → handshaking, then ready', async () => {
    const identity = await generateIdentity();
    const pc = await startFakePc({ devicePublicKey: identity.publicKey });
    cleanups.push(() => pc.close());
    const keys = memoryKeys(null);
    await keys.saveIdentity(identity);
    await keys.pin({ publicKey: pc.identity.publicKey, fingerprint: await fingerprint(pc.identity.publicKey), name: null, pinnedAt: '2026-10-20T08:00:00.000Z' });
    const dead = `ws://127.0.0.1:${await closedPort()}/ws`;
    let reachable = false;
    const Flaky = class extends pc.PhoneWebSocket {
      constructor(url: string | URL) { super(reachable ? url : dead); }
    } as typeof WebSocket;
    const auth = authStub();
    const link = createPhoneLink({ keys, url: pc.url, WebSocketImpl: Flaky, fetchImpl: auth.fetchImpl });
    cleanups.push(() => link.close());
    const { states } = watch(link);
    await until(() => link.state() === 'pc_offline', 'pc_offline');
    reachable = true;
    await until(() => link.state() === 'ready', 'ready', 5000);
    expect(states).toEqual(['handshaking', 'pc_offline', 'handshaking', 'ready']);
  });

  it('a pin the store refuses → unpaired, and a new pairing can start', async () => {
    const pc = await startFakePc();
    cleanups.push(() => pc.close());
    const keys: KeyStore = { ...memoryKeys(null), pin: async () => { throw new Error('quota'); } };
    const { link } = open(pc, keys);
    link.startPairing();
    await until(() => link.pairing()?.state().step === 'compare', 'compare');
    pc.ok();
    link.pairing()!.confirmOnPhone();
    await until(() => link.state() === 'unpaired', 'unpaired');
    const commit = pc.waitFor('pair_commit');
    link.startPairing();
    expect(link.state()).toBe('pairing');
    await commit;
  });

  it('a key store that cannot be read → storage_unavailable: nothing erased, no pairing', async () => {
    const pc = await startFakePc();
    cleanups.push(() => pc.close());
    const storage = new MemoryStorage();
    storage.setItem('ledge.mobile.lastState', '{}');
    const base = memoryKeys(storage);
    const forget = vi.fn(async () => base.forget());
    const lost = async (): Promise<never> => { throw new DOMException('Connection to Indexed Database server lost', 'UnknownError'); };
    const keys: KeyStore = { ...base, identity: lost, pinned: lost, saveIdentity: lost, forget };
    const { link, states } = open(pc, keys);
    await until(() => link.state() === 'storage_unavailable', 'storage_unavailable');
    link.startPairing();
    await settle();
    expect(link.state()).toBe('storage_unavailable');
    expect(states).not.toContain('unpaired');
    expect(states).not.toContain('pairing');
    expect(pc.frames).toEqual([]);
    expect(forget).not.toHaveBeenCalled();
    expect(storage.getItem('ledge.mobile.lastState')).toBe('{}');
  });

  it('storage_unavailable, then « Réessayer » once the store reads again → the normal path, ready', async () => {
    const identity = await generateIdentity();
    const pc = await startFakePc({ devicePublicKey: identity.publicKey });
    cleanups.push(() => pc.close());
    const base = memoryKeys(null);
    await base.saveIdentity(identity);
    await base.pin({ publicKey: pc.identity.publicKey, fingerprint: await fingerprint(pc.identity.publicKey), name: null, pinnedAt: '2026-10-20T08:00:00.000Z' });
    let broken = true;
    const keys: KeyStore = {
      ...base,
      identity: async () => { if (broken) throw new Error('lost'); return base.identity(); },
      pinned: async () => { if (broken) throw new Error('lost'); return base.pinned(); }
    };
    const { link } = open(pc, keys);
    await until(() => link.state() === 'storage_unavailable', 'storage_unavailable');
    broken = false;
    link.retry();
    await until(() => link.state() === 'ready', 'ready');
  });

  it('welcome then presence back to back → one hello on the wire, ready without a rekey', async () => {
    const identity = await generateIdentity();
    const pc = await startFakePc({ devicePublicKey: identity.publicKey });
    cleanups.push(() => pc.close());
    const keys = memoryKeys(null);
    await keys.saveIdentity(identity);
    await keys.pin({ publicKey: pc.identity.publicKey, fingerprint: await fingerprint(pc.identity.publicKey), name: null, pinnedAt: '2026-10-20T08:00:00.000Z' });
    // Right behind the welcome, before anything else, the relay says the PC is online.
    const Echo = class extends pc.PhoneWebSocket {
      constructor(url: string | URL) {
        super(url);
        this.addEventListener('message', (ev: MessageEvent) => {
          if (!String(ev.data).includes('"welcome"')) return;
          queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'presence', peer: 'pc', online: true }) })));
        });
      }
    } as typeof WebSocket;
    const auth = authStub();
    const link = createPhoneLink({ keys, url: pc.url, WebSocketImpl: Echo, fetchImpl: auth.fetchImpl });
    cleanups.push(() => link.close());
    await until(() => link.state() === 'ready', 'ready');
    await settle();
    expect(pc.frames.filter((f) => f.k === 'hello')).toHaveLength(1);
    expect(pc.sent.filter((f) => f.k === 'rekey')).toEqual([]);
    expect(link.state()).toBe('ready');
  });

  it('a pairing frame the socket cannot send → the pairing is cancelled', async () => {
    const pc = await startFakePc({ autoOffer: false });
    cleanups.push(() => pc.close());
    let jammed = false;
    const Jammable = class extends pc.PhoneWebSocket {
      override get readyState() { return jammed ? 3 : super.readyState; }
    } as typeof WebSocket;
    const auth = authStub();
    const link = createPhoneLink({ keys: memoryKeys(null), url: pc.url, WebSocketImpl: Jammable, fetchImpl: auth.fetchImpl });
    cleanups.push(() => link.close());
    const commit = pc.waitFor('pair_commit');
    link.startPairing();
    await commit;
    // The offer arrives, the reveal it calls for cannot leave.
    jammed = true;
    pc.offer();
    await until(() => link.pairing()?.state().step === 'cancelled', 'cancelled');
    expect(link.state()).toBe('pairing');
  });

  it('signOut posts /auth/logout, forgets the keys and ends signed out', async () => {
    const { pc, link, keys, auth } = await ready();
    await link.signOut();
    expect(auth.calls).toContainEqual({ url: `${pc.url}/auth/logout`, method: 'POST' });
    expect(await keys.identity()).toBeNull();
    expect(await keys.pinned()).toBeNull();
    expect(link.state()).toBe('signed_out');
  });

  it('names the pinned PC from the snapshot, and keeps the name in the key store', async () => {
    const { pc, link, keys } = await ready();
    expect(link.pinned()?.name).toBeNull();
    const notified = vi.fn();
    link.subscribe(notified);
    await pc.send(snapshot([], 'PC-Desan'));
    await until(() => link.pinned()?.name === 'PC-Desan', 'the name');
    expect(notified).toHaveBeenCalled();
    await settle();
    expect((await keys.pinned())?.name).toBe('PC-Desan');
    expect(link.pinned()?.publicKey).toBe(pc.identity.publicKey);
  });

  it('key_changed → the received fingerprint is kept for the screen', async () => {
    const identity = await generateIdentity();
    const pc = await startFakePc({ devicePublicKey: identity.publicKey });
    cleanups.push(() => pc.close());
    const other = await generateIdentity();
    pc.answerAs(other);
    const keys = memoryKeys(null);
    await keys.saveIdentity(identity);
    await keys.pin({ publicKey: pc.identity.publicKey, fingerprint: await fingerprint(pc.identity.publicKey), name: null, pinnedAt: '2026-10-20T08:00:00.000Z' });
    const { link } = open(pc, keys);
    expect(link.receivedKey()).toBeNull();
    await until(() => link.state() === 'key_changed', 'key_changed');
    expect(link.receivedKey()).toBe(await fingerprint(other.publicKey));
  });

  it('retry(): a PC said offline on an open socket → a new socket, its welcome, the hello, ready', async () => {
    const { pc, link, hellos } = await ready();
    const before = hellos();
    pc.injectToPhone({ type: 'presence', peer: 'pc', online: false });
    await until(() => link.state() === 'pc_offline', 'pc_offline');
    await settle();
    expect(link.state()).toBe('pc_offline');
    link.retry();
    await until(() => link.state() === 'ready', 'ready again');
    expect(hellos()).toBeGreaterThan(before);
  });
});
