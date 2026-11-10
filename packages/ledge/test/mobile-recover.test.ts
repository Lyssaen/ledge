// Passkey recovery on the PC (src/mobile/recover.ts): one test per refusal, and the way back.
import { describe, it, expect } from 'vitest';
import { b64u, fingerprint, generateIdentity, randomNonce, recoverChallenge, recoveryUserId, type Identity } from '@ledge/seal';
import { RECOVER_TTL_MS, type SealedFrame } from '@ledge/protocol';
import { createRecovery, RECOVER_FAILURES_MAX, RECOVER_PER_HOUR, TOMBSTONE_MS, type RecoverTarget } from '../src/mobile/recover.js';
import type { RecoveryFile } from '../src/mobile/files.js';
import { softAuthenticator } from './mobile-soft-authenticator.js';

const RP = { rpId: 'localhost', origin: 'http://localhost:5173' };
const HOUR = 3_600_000;

function fakeClock() {
  let t = Date.parse('2026-11-10T08:00:00.000Z');
  let timers: Array<{ at: number; fn: () => void }> = [];
  return {
    now: () => t,
    schedule(fn: () => void, ms: number) {
      const e = { at: t + ms, fn };
      timers.push(e);
      return () => { timers = timers.filter(x => x !== e); };
    },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter(x => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter(x => x !== due);
        t = due.at;
        due.fn();
      }
      t = end;
    }
  };
}

/** A PC with one approved iPad whose passkey was made for this PC, and a recovery over them. */
async function setup(o: { online?: boolean; file?: Partial<RecoveryFile>; rp?: typeof RP | null; restoreThrows?: boolean } = {}) {
  const pc = await generateIdentity();
  const clock = fakeClock();
  const auth = softAuthenticator();
  const ipad: RecoverTarget = { id: 'ipad-id', name: 'iPad de G', credential: { id: auth.id, publicKey: auth.publicKey, alg: -7, counter: 0, rpId: RP.rpId } };
  const sent: Array<[string, SealedFrame]> = [];
  let file: RecoveryFile = { tombstones: [], attempts: [], failures: [], ...o.file };
  const calls = { restored: [] as Array<{ old: string; next: { publicKey: string; id: string; peer: string; model?: string; counter: number } }>, refused: [] as Array<[string, string | undefined]>, blocked: 0 };
  const online = { value: o.online ?? false };
  const rec = createRecovery({
    pc,
    pcName: () => 'WSL',
    send: (peer, frame) => { sent.push([peer, frame]); },
    rp: () => (o.rp === undefined ? RP : o.rp),
    byCredential: id => (id === ipad.credential.id ? ipad : null),
    online: id => id === ipad.id && online.value,
    restore(old, next) {
      if (o.restoreThrows) throw new Error('disk full');
      calls.restored.push({ old: old.id, next });
      return old.name;
    },
    refused: (id, model) => { calls.refused.push([id, model]); },
    onBlocked: () => { calls.blocked++; },
    file: { read: () => file, write: f => { file = f; } },
    now: clock.now,
    schedule: clock.schedule
  });
  const userHandle = b64u(await recoveryUserId(pc.publicKey));
  /** The frames sent to a peer, newest last. */
  const to = (peer: string) => sent.filter(([p]) => p === peer).map(([, f]) => f);
  const last = (peer: string) => to(peer).at(-1);

  /** A new app on `peer`: `recover_start` with a fresh key; returns what it needs to answer the offer. */
  const start = async (peer: string, model?: string) => {
    const device = await generateIdentity();
    const n = randomNonce();
    await rec.receive(peer, { k: 'recover_start', d: device.publicKey, n, ...(model ? { model } : {}) });
    return { device, n, offer: last(peer) };
  };
  /** The phone's proof over the offer it got, as the real phone builds it; `tamper` changes what goes into it. */
  const prove = async (peer: string, s: Awaited<ReturnType<typeof start>>, tamper: { pcKey?: string; userHandle?: string; key?: ReturnType<typeof softAuthenticator>; during?: () => void } = {}) => {
    const offer = s.offer as Extract<SealedFrame, { k: 'recover_offer' }>;
    const challenge = await recoverChallenge({ pcPublicKey: tamper.pcKey ?? offer.pc, devicePublicKey: s.device.publicKey, pcNonce: offer.n, deviceNonce: s.n });
    const assertion = (tamper.key ?? auth).get(RP, challenge);
    const proof: SealedFrame = { k: 'recover_proof', assertion: { ...assertion, id: auth.id }, userHandle: tamper.userHandle ?? userHandle };
    const received = rec.receive(peer, proof);
    // What changes on the PC while the proof is being verified.
    tamper.during?.();
    await received;
    return proof;
  };
  return { pc, clock, auth, ipad, rec, sent, calls, online, file: () => file, userHandle, to, last, start, prove };
}

describe('passkey recovery: the way back', () => {
  it('start → offer with the PC key, a nonce and its name; proof → recover_ok, the device restored under its new key', async () => {
    const t = await setup({ file: { failures: ['2026-11-10T07:59:00.000Z'] } });
    const s = await t.start('d_phone', 'iPhone');
    expect(s.offer).toMatchObject({ k: 'recover_offer', pc: t.pc.publicKey, name: 'WSL' });
    expect((s.offer as { n: string }).n).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t.file().attempts).toHaveLength(1);
    await t.prove('d_phone', s);
    expect(t.last('d_phone')).toEqual({ k: 'recover_ok', name: 'iPad de G' });
    expect(t.calls.restored).toEqual([{ old: 'ipad-id', next: { publicKey: s.device.publicKey, id: await fingerprint(s.device.publicKey), peer: 'd_phone', model: 'iPhone', counter: 0 } }]);
    // A success forgets the failures before it.
    expect(t.file().failures).toEqual([]);
  });

  it('frames from the PC side are ignored; other frames are not recovery\'s', async () => {
    const t = await setup();
    expect(await t.rec.receive('d_x', { k: 'recover_ok' })).toBe(true);
    expect(await t.rec.receive('d_x', { k: 'pair_ok' })).toBe(false);
    expect(t.sent).toEqual([]);
  });
});

describe('passkey recovery: refusals', () => {
  it('revoked: a passkey no device holds, without a tombstone — bare, and not counted as a failure', async () => {
    const t = await setup();
    const s = await t.start('d_phone');
    const stranger = softAuthenticator();
    const offer = s.offer as Extract<SealedFrame, { k: 'recover_offer' }>;
    const challenge = await recoverChallenge({ pcPublicKey: offer.pc, devicePublicKey: s.device.publicKey, pcNonce: offer.n, deviceNonce: s.n });
    await t.rec.receive('d_phone', { k: 'recover_proof', assertion: stranger.get(RP, challenge), userHandle: t.userHandle });
    expect(t.last('d_phone')).toEqual({ k: 'recover_no', why: 'revoked' });
    expect(t.file().failures).toEqual([]);
    expect(t.calls.restored).toEqual([]);
  });

  it('revoked: a passkey of a device revoked within 90 days names it and the date; an older tombstone is bare', async () => {
    const t = await setup();
    const gone = softAuthenticator();
    const at = new Date(t.clock.now() - 10 * 86_400_000).toISOString();
    t.rec.bury(gone.id, 'iPhone 12', at);
    t.rec.bury('very-old', 'iPad 2', new Date(t.clock.now() - TOMBSTONE_MS - 1).toISOString());
    for (const [id, want] of [[gone.id, { k: 'recover_no', why: 'revoked', device: 'iPhone 12', revokedAt: at }], ['very-old', { k: 'recover_no', why: 'revoked' }]] as const) {
      const s = await t.start('d_phone');
      const offer = s.offer as Extract<SealedFrame, { k: 'recover_offer' }>;
      const challenge = await recoverChallenge({ pcPublicKey: offer.pc, devicePublicKey: s.device.publicKey, pcNonce: offer.n, deviceNonce: s.n });
      await t.rec.receive('d_phone', { k: 'recover_proof', assertion: { ...gone.get(RP, challenge), id }, userHandle: t.userHandle });
      expect(t.last('d_phone')).toEqual(want);
    }
    // A tombstone past 90 days is pruned at the next burial.
    t.rec.bury('next', 'Pixel', new Date(t.clock.now()).toISOString());
    expect(t.file().tombstones.map(x => x.credentialId)).toEqual([gone.id, 'next']);
  });

  it('connected: the device the passkey names is online — refused after the proof verifies, and the PC is told with the model', async () => {
    const t = await setup({ online: true });
    const s = await t.start('d_phone', 'iPhone');
    await t.prove('d_phone', s);
    expect(t.last('d_phone')).toEqual({ k: 'recover_no', why: 'connected', device: 'iPad de G' });
    expect(t.calls.refused).toEqual([['ipad-id', 'iPhone']]);
    expect(t.calls.restored).toEqual([]);
  });

  it('connected is only said to a proof that verifies: a bad one is `failed` and the PC hears nothing', async () => {
    const t = await setup({ online: true });
    const s = await t.start('d_phone');
    await t.prove('d_phone', s, { key: softAuthenticator() });
    expect(t.last('d_phone')).toEqual({ k: 'recover_no', why: 'failed' });
    expect(t.calls.refused).toEqual([]);
  });

  it(`rate: the ${RECOVER_PER_HOUR + 1}th recovery in an hour is refused with the time left; an hour after the first, one goes again`, async () => {
    const t = await setup();
    for (let i = 0; i < RECOVER_PER_HOUR; i++) {
      await t.start(`d_p${i}`);
      t.rec.reset();
      t.clock.advance(60_000);
    }
    await t.start('d_more');
    expect(t.last('d_more')).toEqual({ k: 'recover_no', why: 'rate', retryInMs: HOUR - RECOVER_PER_HOUR * 60_000 });
    t.clock.advance(HOUR - RECOVER_PER_HOUR * 60_000 + 1);
    const s = await t.start('d_more');
    expect(s.offer).toMatchObject({ k: 'recover_offer' });
  });

  it(`blocked: ${RECOVER_FAILURES_MAX} failed verifications block recovery for the whole account until « Débloquer »`, async () => {
    const t = await setup();
    const answers: unknown[] = [];
    for (let i = 0; i < RECOVER_FAILURES_MAX; i++) {
      const s = await t.start(`d_p${i}`);
      await t.prove(`d_p${i}`, s, { key: softAuthenticator() });
      answers.push(t.last(`d_p${i}`));
    }
    expect(answers).toEqual([{ k: 'recover_no', why: 'failed' }, { k: 'recover_no', why: 'failed' }, { k: 'recover_no', why: 'blocked' }]);
    expect(t.calls.blocked).toBe(1);
    expect(t.rec.blocked()).toEqual({ since: new Date(t.clock.now()).toISOString(), failures: RECOVER_FAILURES_MAX });
    // Another peer, even with the right passkey, is refused at once: no offer, no attempt counted.
    const attempts = t.file().attempts.length;
    await t.start('d_other');
    expect(t.last('d_other')).toEqual({ k: 'recover_no', why: 'blocked' });
    expect(t.file().attempts).toHaveLength(attempts);
    t.rec.unblock();
    expect(t.rec.blocked()).toBeUndefined();
    expect(t.file().failures).toEqual([]);
    const s = await t.start('d_other');
    await t.prove('d_other', s);
    expect(t.last('d_other')).toEqual({ k: 'recover_ok', name: 'iPad de G' });
  });

  it('blocked: a proof that was waiting when the block came is refused too', async () => {
    const t = await setup({ file: { failures: ['a', 'b'] } });
    const waiting = await t.start('d_waiting');
    const s = await t.start('d_bad');
    await t.prove('d_bad', s, { key: softAuthenticator() });
    expect(t.last('d_bad')).toEqual({ k: 'recover_no', why: 'blocked' });
    await t.prove('d_waiting', waiting);
    expect(t.last('d_waiting')).toEqual({ k: 'recover_no', why: 'blocked' });
    expect(t.calls.restored).toEqual([]);
  });

  it('failed: a nonce past 60 s is spent, and its lateness is not counted as a failure', async () => {
    const t = await setup();
    const s = await t.start('d_phone');
    t.clock.advance(RECOVER_TTL_MS + 1);
    await t.prove('d_phone', s);
    expect(t.last('d_phone')).toEqual({ k: 'recover_no', why: 'failed' });
    expect(t.file().failures).toEqual([]);
    expect(t.calls.restored).toEqual([]);
  });

  it('failed: a proof replayed on the same nonce is refused (single use)', async () => {
    const t = await setup({ online: true });
    const s = await t.start('d_phone');
    const proof = await t.prove('d_phone', s);
    expect(t.last('d_phone')).toMatchObject({ why: 'connected' });
    t.online.value = false;
    await t.rec.receive('d_phone', proof);
    expect(t.last('d_phone')).toEqual({ k: 'recover_no', why: 'failed' });
    expect(t.calls.restored).toEqual([]);
  });

  it('failed: an assertion over a challenge made with another PC key (the relay\'s substitution) does not verify, and counts', async () => {
    const t = await setup();
    const relay = await generateIdentity();
    const s = await t.start('d_phone');
    await t.prove('d_phone', s, { pcKey: relay.publicKey });
    expect(t.last('d_phone')).toEqual({ k: 'recover_no', why: 'failed' });
    expect(t.file().failures).toHaveLength(1);
    expect(t.calls.restored).toEqual([]);
  });

  it('failed: a userHandle made for another PC, or an old one without « L1 », counts as a failure', async () => {
    const t = await setup();
    const other: Identity = await generateIdentity();
    for (const userHandle of [b64u(await recoveryUserId(other.publicKey)), b64u(globalThis.crypto.getRandomValues(new Uint8Array(16)))]) {
      const s = await t.start('d_phone');
      await t.prove('d_phone', s, { userHandle });
      expect(t.last('d_phone')).toEqual({ k: 'recover_no', why: 'failed' });
    }
    expect(t.file().failures).toHaveLength(2);
    expect(t.calls.restored).toEqual([]);
  });

  it('failed: a proof without a start, a key that is no P-256 point, too many recoveries at once, no relying party, a restore that throws', async () => {
    const lonely = await setup();
    const s0 = await lonely.start('d_a');
    await lonely.prove('d_b', s0);
    expect(lonely.last('d_b')).toEqual({ k: 'recover_no', why: 'failed' });

    const badKey = await setup();
    await badKey.rec.receive('d_a', { k: 'recover_start', d: 'A'.repeat(87), n: randomNonce() });
    expect(badKey.last('d_a')).toEqual({ k: 'recover_no', why: 'failed' });
    // Counted before the key is read, so that starts delivered together see each other.
    expect(badKey.file().attempts).toHaveLength(1);

    const crowd = await setup();
    for (const p of ['d_1', 'd_2', 'd_3']) await crowd.start(p);
    await crowd.start('d_4');
    expect(crowd.last('d_4')).toEqual({ k: 'recover_no', why: 'failed' });

    const noRp = await setup({ rp: null });
    const s1 = await noRp.start('d_a');
    await noRp.prove('d_a', s1);
    expect(noRp.last('d_a')).toEqual({ k: 'recover_no', why: 'failed' });

    const throws = await setup({ restoreThrows: true, file: { failures: ['x'] } });
    const s2 = await throws.start('d_a');
    await throws.prove('d_a', s2);
    expect(throws.last('d_a')).toEqual({ k: 'recover_no', why: 'failed' });
    // Not the phone's fault: its earlier failures stay as they were, none added.
    expect(throws.file().failures).toEqual(['x']);
  });

  it('starts delivered together: no more than 3 offers waiting, no more than 5 counted, and one peer gets one offer', async () => {
    const t = await setup();
    const keys = await Promise.all(Array.from({ length: 8 }, () => generateIdentity()));
    await Promise.all(keys.map((k, i) => t.rec.receive(`d_${i}`, { k: 'recover_start', d: k.publicKey, n: randomNonce() })));
    expect(t.sent.filter(([, f]) => f.k === 'recover_offer')).toHaveLength(3);
    expect(t.sent.filter(([, f]) => f.k === 'recover_no').map(([, f]) => (f as { why: string }).why)).toEqual(Array(5).fill('failed'));
    expect(t.file().attempts).toHaveLength(3);

    const one = await setup();
    await Promise.all(keys.slice(0, 7).map(k => one.rec.receive('d_one', { k: 'recover_start', d: k.publicKey, n: randomNonce() })));
    expect(one.file().attempts).toHaveLength(RECOVER_PER_HOUR);
    expect(one.to('d_one').filter(f => f.k === 'recover_no').map(f => (f as { why: string }).why)).toEqual(['rate', 'rate']);
    // Each start replaced the one before it: the last counted one was replaced by a refused one, so no offer stands.
    expect(one.to('d_one').filter(f => f.k === 'recover_offer')).toHaveLength(0);

    const pair = await setup();
    await Promise.all(keys.slice(0, 2).map(k => pair.rec.receive('d_two', { k: 'recover_start', d: k.publicKey, n: randomNonce() })));
    expect(pair.to('d_two').filter(f => f.k === 'recover_offer')).toHaveLength(1);
  });

  it('a start replaced, reset or stopped while its unreadable key is read gets no answer: only the current start speaks', async () => {
    const t = await setup();
    const good = await generateIdentity();
    const bad = t.rec.receive('d_one', { k: 'recover_start', d: 'A'.repeat(87), n: randomNonce() });
    const next = t.rec.receive('d_one', { k: 'recover_start', d: good.publicKey, n: randomNonce() });
    await Promise.all([bad, next]);
    expect(t.to('d_one').map(f => f.k)).toEqual(['recover_offer']);

    const reset = await setup();
    const r = reset.rec.receive('d_one', { k: 'recover_start', d: 'A'.repeat(87), n: randomNonce() });
    reset.rec.reset();
    await r;
    expect(reset.to('d_one')).toEqual([]);

    const stop = await setup();
    const s = stop.rec.receive('d_one', { k: 'recover_start', d: 'A'.repeat(87), n: randomNonce() });
    stop.rec.stop();
    await s;
    expect(stop.to('d_one')).toEqual([]);
  });

  it('the device comes online while the proof is verified: connected, not restored', async () => {
    const t = await setup();
    const s = await t.start('d_phone', 'iPhone');
    await t.prove('d_phone', s, { during: () => { t.online.value = true; } });
    expect(t.last('d_phone')).toEqual({ k: 'recover_no', why: 'connected', device: 'iPad de G' });
    expect(t.calls.restored).toEqual([]);
    expect(t.calls.refused).toEqual([['ipad-id', 'iPhone']]);
  });

  it('the passkey is registered again while the proof is verified: failed, not restored, not counted', async () => {
    const t = await setup();
    const s = await t.start('d_phone');
    await t.prove('d_phone', s, { during: () => { t.ipad.credential = { ...t.ipad.credential, publicKey: softAuthenticator().publicKey }; } });
    expect(t.last('d_phone')).toEqual({ k: 'recover_no', why: 'failed' });
    expect(t.calls.restored).toEqual([]);
    expect(t.file().failures).toEqual([]);
  });

  it('recovery is blocked while a valid proof is verified: blocked, not restored', async () => {
    const t = await setup({ file: { failures: ['2026-11-10T07:58:00.000Z', '2026-11-10T07:59:00.000Z'] } });
    const good = await t.start('d_good');
    const bad = await t.start('d_bad');
    // The good proof waits on three digests, the bad one on one: the block lands between them.
    await Promise.all([t.prove('d_good', good), t.prove('d_bad', bad, { key: softAuthenticator() })]);
    expect(t.last('d_bad')).toEqual({ k: 'recover_no', why: 'blocked' });
    expect(t.last('d_good')).toEqual({ k: 'recover_no', why: 'blocked' });
    expect(t.calls.restored).toEqual([]);
  });

  it('a new welcome drops the recoveries waiting for their proof', async () => {
    const t = await setup();
    const s = await t.start('d_phone');
    t.rec.reset();
    await t.prove('d_phone', s);
    expect(t.last('d_phone')).toEqual({ k: 'recover_no', why: 'failed' });
  });
});
