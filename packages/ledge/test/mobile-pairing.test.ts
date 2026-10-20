import { describe, it, expect, afterEach } from 'vitest';
import { b64u, commit, fingerprint, generateIdentity, randomNonce } from '@ledge/seal';
import { SealedFrameSchema, type SealedFrame } from '@ledge/protocol';
import { createRelayLink } from '../src/mobile/link.js';
import type { ApprovedDevice } from '../src/mobile/files.js';
import { createPairing, MAX_PAIRINGS, PAIRING_TTL_MS, type PairingView } from '../src/mobile/pairing.js';
import { startTestRelay, type TestRelay } from './mobile-relay-harness.js';
import { fakeDevice, type FakeDevice } from './mobile-fake-device.js';

/** A simulated clock: `schedule` only fires on `advance`. */
function fakeClock() {
  let t = Date.parse('2026-10-19T08:00:00.000Z');
  let timers: Array<{ at: number; fn: () => void }> = [];
  return {
    now: () => t,
    schedule(fn: () => void, ms: number) {
      const e = { at: t + ms, fn };
      timers.push(e);
      return () => { timers = timers.filter((x) => x !== e); };
    },
    pending: () => timers.length,
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((x) => x !== due);
        t = due.at;
        due.fn();
      }
      t = end;
    }
  };
}

async function until(cond: () => boolean, what = 'condition'): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

const peerId = (i: number) => `d_${String(i).repeat(16)}`;

/** The relay, a PC linked to it with a pairing driven by a simulated clock, and a way to add phones. */
async function setup() {
  const relay: TestRelay = await startTestRelay();
  cleanups.push(() => relay.relay.close());
  const pc = await generateIdentity();
  const clock = fakeClock();
  const approved: Array<Omit<ApprovedDevice, 'lastSeenAt'>> = [];
  /** `views()` as seen at each `onChange`. */
  const snapshots: PairingView[][] = [];
  const pending: Promise<boolean>[] = [];

  let pairing: ReturnType<typeof createPairing> | null = null;
  let online = false;
  const link = createRelayLink({
    relayUrl: relay.url,
    token: relay.pcToken,
    onState: (s) => { online = s.state === 'online'; },
    onMessage(m) {
      if (m.type !== 'deliver' || !pairing) return;
      const r = SealedFrameSchema.safeParse(JSON.parse(m.body));
      if (r.success) pending.push(pairing.receive(m.from, r.data));
    }
  });
  cleanups.push(() => link.close());
  pairing = createPairing({
    pc,
    send: (peer, frame: SealedFrame) => { link.send({ type: 'send', to: peer, body: JSON.stringify(frame) }); },
    approve: (d) => approved.push(d),
    onChange: () => snapshots.push(pairing!.views()),
    now: clock.now,
    schedule: clock.schedule
  });
  const p = pairing;
  cleanups.push(() => p.stop());
  await until(() => online, 'PC online');

  const device = async (i: number, label?: string): Promise<FakeDevice> => {
    const peer = peerId(i);
    const d = await fakeDevice({ relayUrl: relay.url, token: relay.deviceToken(peer), peer, ...(label !== undefined ? { label } : {}) });
    cleanups.push(() => d.close());
    return d;
  };
  return { relay, pc, clock, approved, snapshots, pairing: p, device, settled: () => Promise.all(pending) };
}

describe('device pairing on the PC', () => {
  it('shows the code the device computed, and approval sends pair_ok and records the device by fingerprint', async () => {
    const s = await setup();
    const phone = await s.device(1);
    const { code, result } = await phone.pair();
    await until(() => s.pairing.views()[0]?.state === 'confirm', 'confirm view');
    const view = s.pairing.views()[0]!;
    expect(view.code).toBe(code);
    expect(view.label).toBe('Pixel · Chrome');
    expect(view.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(view.expiresAt).toBe(new Date(s.clock.now() + PAIRING_TTL_MS).toISOString());

    s.pairing.approve(view.id);
    expect(await result).toBe('ok');
    expect(s.approved).toHaveLength(1);
    expect(s.approved[0]).toEqual({
      id: await fingerprint(phone.publicKey),
      publicKey: phone.publicKey,
      label: 'Pixel · Chrome',
      approvedAt: new Date(s.clock.now()).toISOString(),
      lastPeer: phone.peer
    });
    expect(s.pairing.views()[0]!.state).toBe('approved');

    s.pairing.linked(await fingerprint(phone.publicKey));
    expect(s.pairing.views()[0]!.state).toBe('linked');
    s.clock.advance(10_000);
    expect(s.pairing.views()).toEqual([]);
  });

  it('the offer carries the PC key', async () => {
    const s = await setup();
    const phone = await s.device(1);
    const offer = phone.waitFor('pair_offer');
    await phone.pair();
    expect((await offer).pc).toBe(s.pc.publicKey);
  });

  it('deny sends pair_no, then the view is refused', async () => {
    const s = await setup();
    const phone = await s.device(1);
    const { result } = await phone.pair();
    await until(() => s.pairing.views()[0]?.state === 'confirm', 'confirm view');
    s.pairing.deny(s.pairing.views()[0]!.id);
    expect(await result).toBe('no');
    expect(s.pairing.views()[0]!.state).toBe('refused');
    expect(s.approved).toEqual([]);
    s.clock.advance(10_000);
    expect(s.pairing.views()).toEqual([]);
  });

  it('a reveal whose nonce differs from the commitment gets pair_no, and no confirm view ever existed', async () => {
    const s = await setup();
    const phone = await s.device(1);
    const offer = phone.waitFor('pair_offer');
    phone.sendFrame({ k: 'pair_commit', c: await commit(phone.publicKey, randomNonce()), label: 'Pixel' });
    await offer;
    const no = phone.waitFor('pair_no');
    phone.sendFrame({ k: 'pair_reveal', d: phone.publicKey, n: randomNonce() });
    await no;
    await s.settled();
    expect(s.snapshots.flat().some((v) => v.state === 'confirm' || v.code !== null)).toBe(false);
    expect(s.pairing.views()).toEqual([]);
  });

  it('a reveal whose 87-character key is not a P-256 point gets pair_no', async () => {
    const s = await setup();
    const phone = await s.device(1);
    const bad = b64u(new Uint8Array([0x04, ...new Uint8Array(64).fill(0xff)]));
    expect(bad).toHaveLength(87);
    const nonce = randomNonce();
    const offer = phone.waitFor('pair_offer');
    // The commitment matches the bad key: only the point check can refuse it.
    phone.sendFrame({ k: 'pair_commit', c: await commit(bad, nonce), label: 'Pixel' });
    await offer;
    const no = phone.waitFor('pair_no');
    phone.sendFrame({ k: 'pair_reveal', d: bad, n: nonce });
    await no;
    await s.settled();
    expect(s.snapshots.flat().some((v) => v.state === 'confirm')).toBe(false);
    expect(s.pairing.views()).toEqual([]);
  });

  it('four commits from four peers: three views, the fourth gets pair_no', async () => {
    const s = await setup();
    expect(MAX_PAIRINGS).toBe(3);
    const phones = await Promise.all([1, 2, 3, 4].map((i) => s.device(i)));
    const firstThree = await Promise.all(phones.slice(0, 3).map((p) => p.pair()));
    await expect(phones[3]!.pair()).rejects.toThrow(/pair_no/);
    await until(() => s.pairing.views().filter((v) => v.state === 'confirm').length === 3, 'three confirm views');
    const views = s.pairing.views();
    expect(views).toHaveLength(3);
    // Each has its own code.
    expect(new Set(views.map((v) => v.code))).toEqual(new Set(firstThree.map((p) => p.code)));
  });

  it('a new commit from the same peer replaces its pairing', async () => {
    const s = await setup();
    const phone = await s.device(1);
    await phone.pair();
    await until(() => s.pairing.views()[0]?.state === 'confirm', 'confirm view');
    const firstId = s.pairing.views()[0]!.id;
    const { code } = await phone.pair();
    await until(() => s.pairing.views()[0]?.code === code, 'second code');
    expect(s.pairing.views()).toHaveLength(1);
    expect(s.pairing.views()[0]!.id).not.toBe(firstId);
  });

  it('expires after 5 min, stays visible 10 s, then disappears', async () => {
    const s = await setup();
    const phone = await s.device(1);
    await phone.pair();
    await until(() => s.pairing.views()[0]?.state === 'confirm', 'confirm view');
    const id = s.pairing.views()[0]!.id;
    s.clock.advance(PAIRING_TTL_MS + 1);
    expect(s.pairing.views()[0]!.state).toBe('expired');
    expect(s.snapshots.at(-1)![0]!.state).toBe('expired');
    // Too late to approve.
    s.pairing.approve(id);
    expect(s.approved).toEqual([]);
    s.clock.advance(9_998);
    expect(s.pairing.views()).toHaveLength(1);
    s.clock.advance(2);
    expect(s.pairing.views()).toEqual([]);
    expect(s.snapshots.at(-1)).toEqual([]);
  });

  it('a waiting pairing expires too', async () => {
    const s = await setup();
    const phone = await s.device(1);
    const offer = phone.waitFor('pair_offer');
    phone.sendFrame({ k: 'pair_commit', c: await commit(phone.publicKey, randomNonce()), label: 'Pixel' });
    await offer;
    expect(s.pairing.views()[0]!.state).toBe('waiting');
    expect(s.pairing.views()[0]!.code).toBeNull();
    s.clock.advance(PAIRING_TTL_MS + 1);
    expect(s.pairing.views()[0]!.state).toBe('expired');
  });

  it('reset drops waiting and confirm pairings but keeps approved ones', async () => {
    const s = await setup();
    const a = await s.device(1);
    const b = await s.device(2);
    const pa = await a.pair();
    await b.pair();
    await until(() => s.pairing.views().filter((v) => v.state === 'confirm').length === 2, 'two confirm views');
    const va = s.pairing.views().find((v) => v.code === pa.code)!;
    s.pairing.approve(va.id);
    s.pairing.reset();
    expect(s.pairing.views().map((v) => v.state)).toEqual(['approved']);
  });

  it('cleans the label: control characters removed, trimmed, cut, or "Appareil"', async () => {
    const s = await setup();
    const a = await s.device(1, '\u0007  Pixel · Chrome  ');
    const b = await s.device(2, '\u0001\u0002');
    await Promise.all([a.pair(), b.pair()]);
    await until(() => s.pairing.views().filter((v) => v.state === 'confirm').length === 2, 'two confirm views');
    expect(s.pairing.views().map((v) => v.label).sort()).toEqual(['Appareil', 'Pixel · Chrome']);
    // The schema bounds the label; a frame that skipped it is still cut.
    await s.pairing.receive(peerId(3), { k: 'pair_commit', c: randomNonce(), label: ` ${'x'.repeat(50)}` });
    expect(s.pairing.views().map((v) => v.label)).toContain('x'.repeat(40));
  });

  it('receive tells pair frames from others', async () => {
    const s = await setup();
    expect(await s.pairing.receive(peerId(9), { k: 'pair_ok' })).toBe(true);
    expect(await s.pairing.receive(peerId(9), { k: 'rekey' })).toBe(false);
    expect(await s.pairing.receive(peerId(9), { k: 'msg', s: 'x' })).toBe(false);
    expect(s.pairing.views()).toEqual([]);
  });
});

describe('approval reopens the window', () => {
  it('approve at 4 min 59 s, the first channel at 9 min 30 s: linked, not expired', async () => {
    const s = await setup();
    const phone = await s.device(1);
    const { result } = await phone.pair();
    await until(() => s.pairing.views()[0]?.state === 'confirm', 'confirm view');
    const view = s.pairing.views()[0]!;
    s.clock.advance(PAIRING_TTL_MS - 1_000);
    s.pairing.approve(view.id);
    expect(await result).toBe('ok');
    expect(s.pairing.views()[0]!.expiresAt).toBe(new Date(s.clock.now() + PAIRING_TTL_MS).toISOString());
    s.clock.advance(9 * 60_000 + 30_000 - (PAIRING_TTL_MS - 1_000));
    expect(s.pairing.views()[0]!.state).toBe('approved');
    s.pairing.linked(await fingerprint(phone.publicKey));
    expect(s.pairing.views()[0]!.state).toBe('linked');
  });
});
