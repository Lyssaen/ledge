// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECOVER_TTL_MS, type SealedFrame } from '@ledge/protocol';
import { b64u, digestTag, fingerprint, generateIdentity, keyDigest, randomNonce, recoverChallenge, recoveryUserId, userHandleDigest } from '@ledge/seal';
import { startRecovery, type Recovery } from '../../src/link/recover';
import type { Discoverable } from '../../src/link/webauthn';

afterEach(() => { vi.useRealTimers(); });

const ASSERTION = { id: 'cid', clientDataJSON: 'cdj', authenticatorData: 'ad', signature: 'sig' };

/** A recovery from a fresh device key, the frames it sends, the challenges it asked the device to sign. */
async function setup(opts: { answer?: (challenge: string) => Promise<Discoverable | 'cancelled'>; sendOk?: boolean; pin?: () => Promise<void> } = {}) {
  const device = await generateIdentity();
  const pc = await generateIdentity();
  const sent: SealedFrame[] = [];
  const challenges: string[] = [];
  let changes = 0;
  const pinned: string[] = [];
  const handle = b64u(await recoveryUserId(pc.publicKey));
  let t = Date.parse('2026-11-10T20:00:00.000Z');
  const r: Recovery = startRecovery({
    identity: device,
    model: 'iPad',
    send: (f) => { sent.push(f); return opts.sendOk ?? true; },
    assert: async (c) => { challenges.push(c); return opts.answer ? opts.answer(c) : { assertion: ASSERTION, userHandle: handle }; },
    changed: () => { changes++; },
    pin: async (p) => { pinned.push(p.publicKey); if (opts.pin) await opts.pin(); },
    now: () => t
  });
  const offer = { k: 'recover_offer' as const, pc: pc.publicKey, n: randomNonce(), name: 'WSL' };
  return { r, device, pc, sent, challenges, handle, offer, pinned, changes: () => changes, advance: (ms: number) => { t += ms; } };
}

describe('startRecovery', () => {
  it('sends recover_start with the new key, a nonce and the model, and waits for the offer', async () => {
    const s = await setup();
    expect(s.sent).toEqual([{ k: 'recover_start', d: s.device.publicKey, n: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), model: 'iPad' }]);
    expect(s.r.state()).toEqual({ step: 'reaching' });
  });

  it('signs a challenge it computed itself from both keys and both nonces, then sends the proof with the userHandle', async () => {
    const s = await setup();
    await s.r.receive(s.offer);
    const start = s.sent[0] as Extract<SealedFrame, { k: 'recover_start' }>;
    expect(s.challenges).toEqual([await recoverChallenge({ pcPublicKey: s.pc.publicKey, devicePublicKey: s.device.publicKey, pcNonce: s.offer.n, deviceNonce: start.n })]);
    expect(s.sent[1]).toEqual({ k: 'recover_proof', assertion: ASSERTION, userHandle: s.handle });
    expect(s.r.state()).toEqual({ step: 'checking', pcName: 'WSL' });
  });

  it('is back on recover_ok, with the PC key of the offer to pin and the name it keeps', async () => {
    const s = await setup();
    await s.r.receive(s.offer);
    await s.r.receive({ k: 'recover_ok', name: 'iPad de G' });
    expect(s.r.state()).toEqual({
      step: 'done', name: 'iPad de G',
      pc: { publicKey: s.pc.publicKey, fingerprint: await fingerprint(s.pc.publicKey), name: 'WSL', pinnedAt: '2026-11-10T20:00:00.000Z' }
    });
  });

  it('keeps the PC key before it says done; a key it cannot keep is « unsaved », not done', async () => {
    const s = await setup();
    await s.r.receive(s.offer);
    await s.r.receive({ k: 'recover_ok' });
    expect(s.pinned).toEqual([s.pc.publicKey]);
    const away = await setup({ pin: async () => { throw new Error('quota'); } });
    await away.r.receive(away.offer);
    await away.r.receive({ k: 'recover_ok', name: 'iPad' });
    expect(away.r.state()).toEqual({ step: 'failed', why: 'unsaved', pcName: 'WSL' });
  });

  it('sends nothing for an old passkey (no « L1 »), and says so', async () => {
    const s = await setup({ answer: async () => ({ assertion: ASSERTION, userHandle: b64u(new Uint8Array(16)) }) });
    await s.r.receive(s.offer);
    expect(s.sent.map(f => f.k)).toEqual(['recover_start']);
    expect(s.r.state()).toMatchObject({ step: 'failed', why: 'old' });
  });

  it('sends nothing for a passkey made for another PC key, and shows both fingerprints', async () => {
    const other = await generateIdentity();
    const otherHandle = await recoveryUserId(other.publicKey);
    const s = await setup({ answer: async () => ({ assertion: ASSERTION, userHandle: b64u(otherHandle) }) });
    await s.r.receive(s.offer);
    expect(s.sent.map(f => f.k)).toEqual(['recover_start']);
    expect(s.r.state()).toEqual({
      step: 'failed', why: 'otherPc', pcName: 'WSL',
      tags: [digestTag(userHandleDigest(otherHandle)!), digestTag(await keyDigest(s.pc.publicKey))]
    });
  });

  it('says « none » when the sheet was dismissed, and opens it again on the same offer without a new start', async () => {
    let answers = 0;
    const s = await setup({ answer: async () => (answers++ === 0 ? 'cancelled' : { assertion: ASSERTION, userHandle: s.handle }) });
    await s.r.receive(s.offer);
    expect(s.r.state()).toMatchObject({ step: 'failed', why: 'none', pcName: 'WSL' });
    expect(s.r.again()).toBe(true);
    await vi.waitFor(() => expect(s.r.state()).toEqual({ step: 'checking', pcName: 'WSL' }));
    expect(s.challenges).toHaveLength(2);
    expect(s.challenges[1]).toBe(s.challenges[0]);
    expect(s.sent.map(f => f.k)).toEqual(['recover_start', 'recover_proof']);
  });

  it('needs a new recovery once the offer is too old to be used again', async () => {
    const s = await setup({ answer: async () => 'cancelled' });
    await s.r.receive(s.offer);
    s.advance(RECOVER_TTL_MS - 10_000);
    expect(s.r.again()).toBe(false);
  });

  it('shows each refusal of the PC with its data, and the PC\'s « failed » as a timeout', async () => {
    const cases: Array<[SealedFrame, object]> = [
      [{ k: 'recover_no', why: 'revoked', device: 'iPad', revokedAt: '2026-11-03T10:00:00.000Z' }, { why: 'revoked', device: 'iPad', revokedAt: '2026-11-03T10:00:00.000Z' }],
      [{ k: 'recover_no', why: 'connected', device: 'iPad' }, { why: 'connected', device: 'iPad' }],
      [{ k: 'recover_no', why: 'rate', retryInMs: 2_520_000 }, { why: 'rate', retryInMs: 2_520_000 }],
      [{ k: 'recover_no', why: 'blocked' }, { why: 'blocked' }],
      [{ k: 'recover_no', why: 'failed' }, { why: 'timeout' }]
    ];
    for (const [no, want] of cases) {
      const s = await setup();
      await s.r.receive(s.offer);
      await s.r.receive(no);
      expect(s.r.state()).toMatchObject({ step: 'failed', pcName: 'WSL', ...want });
    }
    // Before the offer too: rate and blocked come in answer to the start.
    const s = await setup();
    await s.r.receive({ k: 'recover_no', why: 'rate' });
    expect(s.r.state()).toEqual({ step: 'failed', why: 'rate', pcName: null });
  });

  it('times out when the PC does not answer within the nonce\'s life', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const s = await setup();
    vi.advanceTimersByTime(RECOVER_TTL_MS);
    expect(s.r.state()).toMatchObject({ step: 'failed', why: 'timeout' });
    expect(s.changes()).toBeGreaterThan(0);
  });

  it('is offline when the start cannot leave, and ignores frames once cancelled', async () => {
    const away = await setup({ sendOk: false });
    expect(away.r.state()).toEqual({ step: 'failed', why: 'offline', pcName: null });
    const s = await setup();
    s.r.cancel();
    await s.r.receive(s.offer);
    expect(s.r.state()).toEqual({ step: 'cancelled' });
    expect(s.challenges).toEqual([]);
  });
});
