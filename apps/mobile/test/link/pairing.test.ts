// @vitest-environment node
// Node's own WebSocket reaches the real relay; jsdom's would replace it.
import { afterEach, describe, expect, it } from 'vitest';
import { SealedFrameSchema, type SealedFrame } from '@ledge/protocol';
import { fingerprint, generateIdentity, randomNonce, startHandshake } from '@ledge/seal';
import { openRelaySocket, type SocketState } from '../../src/link/socket';
import { PAIRING_TTL_MS, startPairing, type Pairing } from '../../src/link/pairing';
import { startFakePc, type FakePc } from '../fakePc';

async function until(cond: () => boolean, what = 'condition'): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

/** A fake PC on a real relay, and the phone's socket and pairing on the same relay. */
async function setup(opts: { autoOffer?: boolean } = {}) {
  const pc: FakePc = await startFakePc(opts);
  cleanups.push(() => pc.close());
  const identity = await generateIdentity();
  let t = Date.parse('2026-10-20T08:00:00.000Z');
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  let pairing: Pairing | null = null;
  /** Frames from the PC that `pairing.receive` has finished with. */
  let handled = 0;
  /** Every sealed frame the PC sent, in order. */
  const fromPc: SealedFrame[] = [];
  const states: SocketState[] = [];
  const sock = openRelaySocket({
    url: pc.url,
    WebSocketImpl: pc.PhoneWebSocket,
    onState: (s) => states.push(s),
    onFrame(m) {
      if (m.type !== 'deliver' || m.from !== 'pc' || !pairing) return;
      const f = SealedFrameSchema.safeParse(JSON.parse(m.body));
      if (!f.success) return;
      fromPc.push(f.data);
      void pairing.receive(f.data).finally(() => { handled++; });
    }
  });
  cleanups.push(() => sock.close());
  await until(() => states.includes('open'), 'the phone socket');
  const sent: SealedFrame[] = [];
  pairing = startPairing({
    identity,
    label: 'iPhone',
    now: clock.now,
    send: (f) => { sent.push(f); sock.send('pc', f); }
  });
  const p = pairing;
  return { pc, identity, pairing: p, clock, sent, sock, fromPc, handled: () => handled };
}

const step = (p: Pairing) => p.state().step;

describe('phone pairing against a fake PC on the real relay', () => {
  it('commits with its label, then shows the code the PC computes', async () => {
    const { pc, pairing } = await setup();
    const commit = await pc.waitFor('pair_commit');
    expect(commit.label).toBe('iPhone');
    await until(() => step(pairing) === 'compare', 'compare');
    const s = pairing.state();
    expect(s).toEqual({ step: 'compare', code: await pc.code(), pcConfirmed: false, phoneConfirmed: false });
    expect(s.step === 'compare' && /^\d{3} \d{3}$/.test(s.code)).toBe(true);
  });

  it('pair_ok then confirmOnPhone → linked, pinning the key of pair_offer', async () => {
    const { pc, pairing, identity } = await setup();
    await until(() => step(pairing) === 'compare', 'compare');
    await pc.code();
    expect(pc.devicePublicKey).toBe(identity.publicKey);
    pc.ok();
    await until(() => { const s = pairing.state(); return s.step === 'compare' && s.pcConfirmed; }, 'pcConfirmed');
    pairing.confirmOnPhone();
    expect(pairing.state()).toEqual({
      step: 'linked',
      pc: { publicKey: pc.identity.publicKey, fingerprint: await fingerprint(pc.identity.publicKey), name: null, pinnedAt: '2026-10-20T08:00:00.000Z' }
    });
  });

  it('confirmOnPhone then pair_ok → linked', async () => {
    const { pc, pairing } = await setup();
    await until(() => step(pairing) === 'compare', 'compare');
    pairing.confirmOnPhone();
    expect(pairing.state()).toMatchObject({ step: 'compare', pcConfirmed: false, phoneConfirmed: true });
    pc.ok();
    await until(() => step(pairing) === 'linked', 'linked');
    const s = pairing.state();
    expect(s.step === 'linked' && s.pc.publicKey).toBe(pc.identity.publicKey);
  });

  it('pair_no → refused', async () => {
    const { pc, pairing } = await setup();
    await until(() => step(pairing) === 'compare', 'compare');
    pairing.confirmOnPhone();
    pc.no();
    await until(() => step(pairing) === 'refused', 'refused');
    pc.ok();
    await new Promise((r) => setTimeout(r, 50));
    expect(step(pairing)).toBe('refused');
  });

  it('no pair_ok within 5 minutes of pair_commit → expired, and a late pair_ok does not link', async () => {
    const { pc, pairing, clock, handled } = await setup();
    await until(() => step(pairing) === 'compare', 'compare');
    pairing.confirmOnPhone();
    clock.advance(PAIRING_TTL_MS - 1);
    expect(step(pairing)).toBe('compare');
    clock.advance(1);
    expect(step(pairing)).toBe('expired');
    const before = handled();
    pc.ok();
    await until(() => handled() > before, 'the late pair_ok');
    expect(step(pairing)).toBe('expired');
  });

  it('pair_ok, then the user confirms after the 5 minutes → linked: once the PC said yes, only the phone is left', async () => {
    const { pc, pairing, clock } = await setup();
    await until(() => step(pairing) === 'compare', 'compare');
    pc.ok();
    await until(() => { const s = pairing.state(); return s.step === 'compare' && s.pcConfirmed; }, 'pcConfirmed');
    clock.advance(PAIRING_TTL_MS + 60_000);
    expect(pairing.state()).toMatchObject({ step: 'compare', pcConfirmed: true, phoneConfirmed: false });
    pairing.confirmOnPhone();
    const s = pairing.state();
    expect(s.step === 'linked' && s.pc.publicKey).toBe(pc.identity.publicKey);
  });

  it('an off-curve pair_offer is ignored, and a later valid one reaches compare with the valid key', async () => {
    const { pc, pairing, sent, handled } = await setup({ autoOffer: false });
    await pc.waitFor('pair_commit');
    const offCurve = 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE';
    pc.sendFrame({ k: 'pair_offer', pc: offCurve, n: randomNonce() });
    await until(() => handled() === 1, 'the off-curve offer');
    expect(step(pairing)).toBe('committing');
    expect(sent.map((f) => f.k)).toEqual(['pair_commit']);
    pc.offer();
    await until(() => step(pairing) === 'compare', 'compare');
    expect(pairing.state()).toMatchObject({ step: 'compare', code: await pc.code() });
    pc.ok();
    pairing.confirmOnPhone();
    await until(() => step(pairing) === 'linked', 'linked');
    const s = pairing.state();
    expect(s.step === 'linked' && s.pc).toMatchObject({ publicKey: pc.identity.publicKey, fingerprint: await fingerprint(pc.identity.publicKey) });
  });

  it('a second pair_offer is ignored: one reveal, the same code', async () => {
    const { pc, pairing, sent, handled } = await setup();
    await until(() => step(pairing) === 'compare', 'compare');
    const code = await pc.code();
    const before = handled();
    pc.sendFrame({ k: 'pair_offer', pc: (await generateIdentity()).publicKey, n: randomNonce() });
    await until(() => handled() > before, 'the second offer');
    expect(pairing.state()).toMatchObject({ step: 'compare', code });
    expect(sent.filter((f) => f.k === 'pair_reveal')).toHaveLength(1);
  });

  it('a pair_ok before compare is ignored', async () => {
    const { pc, pairing, handled } = await setup({ autoOffer: false });
    await pc.waitFor('pair_commit');
    pc.ok();
    await until(() => handled() === 1, 'the early pair_ok');
    expect(step(pairing)).toBe('committing');
    pc.offer();
    await until(() => step(pairing) === 'compare', 'compare');
    pairing.confirmOnPhone();
    expect(pairing.state()).toMatchObject({ step: 'compare', pcConfirmed: false, phoneConfirmed: true });
  });

  it('cancel() is silent: cancelled, nothing more is sent, later frames are ignored', async () => {
    const { pc, pairing, sent, handled } = await setup({ autoOffer: false });
    await pc.waitFor('pair_commit');
    pairing.cancel();
    expect(step(pairing)).toBe('cancelled');
    pc.offer();
    await until(() => handled() === 1, 'the offer');
    expect(step(pairing)).toBe('cancelled');
    expect(sent.map((f) => f.k)).toEqual(['pair_commit']);
  });
});

describe('the fake PC', () => {
  it('answers the linked phone\'s hello, trades ready, and sends padded phone messages', async () => {
    const { pc, pairing, identity, sock, fromPc } = await setup();
    await until(() => step(pairing) === 'compare', 'compare');
    pc.ok();
    pairing.confirmOnPhone();
    await until(() => step(pairing) === 'linked', 'linked');
    const hs = await startHandshake(identity, 'device', pc.identity.publicKey);
    sock.send('pc', { k: 'hello', e: hs.hello, f: await fingerprint(identity.publicKey) });
    await until(() => fromPc.some((f) => f.k === 'hello'), 'the PC hello');
    const hello = fromPc.find((f) => f.k === 'hello')!;
    expect(hello.k === 'hello' && hello.f).toBe(await fingerprint(pc.identity.publicKey));
    const ch = await hs.finish(hello.k === 'hello' ? hello.e : '');
    sock.send('pc', { k: 'msg', s: await ch.seal('{"t":"ready"}') });
    await until(() => fromPc.some((f) => f.k === 'msg'), 'the PC ready');
    const msgs = () => fromPc.filter((f): f is Extract<SealedFrame, { k: 'msg' }> => f.k === 'msg');
    expect(await ch.open(msgs()[0]!.s)).toBe('{"t":"ready"}');
    expect(pc.ready).toBe(true);

    await pc.send({ type: 'session.removed', id: 's1' });
    await until(() => msgs().length === 2, 'the scripted message');
    const text = await ch.open(msgs()[1]!.s);
    expect(new TextEncoder().encode(text).length).toBe(1_024);
    expect(JSON.parse(text)).toEqual({ type: 'session.removed', id: 's1' });

    sock.send('pc', { k: 'msg', s: await ch.seal('{"type":"snapshot.request"}' + ' '.repeat(997)) });
    await until(() => pc.received.length === 1, 'the phone message');
    expect(pc.received).toEqual(['{"type":"snapshot.request"}']);
  });

  it('denies a hello from a key it never paired', async () => {
    const { pc, sock, fromPc } = await setup();
    const stranger = await generateIdentity();
    const hs = await startHandshake(stranger, 'device', pc.identity.publicKey);
    sock.send('pc', { k: 'hello', e: hs.hello, f: await fingerprint(stranger.publicKey) });
    await until(() => fromPc.some((f) => f.k === 'denied'), 'denied');
  });
});

describe('phone pairing on its own', () => {
  it('a commitment that cannot be computed ends in cancelled, sends nothing, and receive() does not throw', async () => {
    const identity = { ...(await generateIdentity()), publicKey: '!' };
    const sent: SealedFrame[] = [];
    const pairing = startPairing({ identity, label: 'iPhone', send: (f) => sent.push(f) });
    await pairing.receive({ k: 'pair_offer', pc: (await generateIdentity()).publicKey, n: randomNonce() });
    expect(step(pairing)).toBe('cancelled');
    expect(sent).toEqual([]);
  });
});
