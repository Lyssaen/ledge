import { beforeEach, describe, expect, it } from 'vitest';
import type { MobileConfig } from '../src/mobile/config.js';
import type { StoredCredential } from '../src/daemon/devices.js';
import { ChallengeStore, type Binding } from '../src/daemon/challenges.js';
import { assertionOptions, challengeOf, registrationOptions, verifyAssertion, verifyRegistration } from '../src/daemon/webauthn.js';
import { createSoftAuthenticator } from './soft-authenticator.js';

const cfg: MobileConfig = { origin: 'https://pc.t.ts.net', rpID: 'pc.t.ts.net' };
const b: Binding = { deviceId: 'dev-1', sessionId: 's1', pendingId: 'p-A', pendingVersion: 1, decision: 'accept' };

/** A soft authenticator registered through the daemon's own path, so its stored credential is what pairing keeps. */
async function paired() {
  const soft = createSoftAuthenticator(cfg);
  const options = await registrationOptions(cfg, 'iPhone');
  const credential: StoredCredential = await verifyRegistration(cfg, soft.register(options), options.challenge);
  return { soft, credential };
}

describe('ChallengeStore', () => {
  let t: number;
  let store: ChallengeStore;
  beforeEach(() => { t = 1_000_000; store = new ChallengeStore({ now: () => t }); });

  it('issues 32 random bytes in base64url, valid for 60 s', () => {
    const { challenge, expiresAt } = store.issue(b);
    expect(Buffer.from(challenge, 'base64url')).toHaveLength(32);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(new Date(t + 60_000).toISOString());
    expect(store.issue(b).challenge).not.toBe(challenge);
  });

  it('a challenge verifies once for its exact binding', async () => {
    const { soft, credential } = await paired();
    const { challenge } = store.issue(b);
    const response = soft.assert(await assertionOptions(cfg, credential, challenge));
    expect(challengeOf(response)).toBe(challenge);
    expect(store.consume(challengeOf(response)!, b)).toBe('ok');
    const { newCounter } = await verifyAssertion(cfg, credential, response, challenge);
    expect(newCounter).toBe(1);
  });

  it('the same assertion replayed is refused', async () => {
    const { soft, credential } = await paired();
    const { challenge } = store.issue(b);
    const response = soft.assert(await assertionOptions(cfg, credential, challenge));
    expect(store.consume(challengeOf(response)!, b)).toBe('ok');
    expect(store.consume(challengeOf(response)!, b)).toBe('unknown');
  });

  it('a challenge for version 1 does not verify version 2', () => {
    const c = store.issue(b).challenge;
    expect(store.consume(c, { ...b, pendingVersion: 2 })).toBe('mismatch');
    // A mismatch spends the challenge: the right binding cannot use it afterwards.
    expect(store.consume(c, b)).toBe('unknown');
  });

  it('a challenge for accept on request A does not verify request B', () => {
    const c = store.issue(b).challenge;
    expect(store.consume(c, { ...b, pendingId: 'p-B' })).toBe('mismatch');
  });

  it('a challenge issued to one device does not verify for another device or session', () => {
    const c1 = store.issue(b).challenge;
    expect(store.consume(c1, { ...b, deviceId: 'dev-2' })).toBe('mismatch');
    const c2 = store.issue(b).challenge;
    expect(store.consume(c2, { ...b, sessionId: 's2' })).toBe('mismatch');
  });

  it('an expired challenge is refused and not consumed twice', () => {
    const c = store.issue(b).challenge;
    t += 60_001;
    expect(store.consume(c, b)).toBe('expired');
    expect(store.consume(c, b)).toBe('unknown');
  });

  it('a challenge is still valid at exactly 60 s', () => {
    const c = store.issue(b).challenge;
    t += 60_000;
    expect(store.consume(c, b)).toBe('ok');
  });

  it('a new challenge for the same device and request replaces the previous one', () => {
    const first = store.issue(b).challenge;
    const second = store.issue({ ...b, pendingVersion: 2 }).challenge;
    expect(store.consume(first, b)).toBe('unknown');
    expect(store.consume(second, { ...b, pendingVersion: 2 })).toBe('ok');
  });

  it('challenges of other devices or requests are kept', () => {
    const mine = store.issue(b).challenge;
    const otherDevice = store.issue({ ...b, deviceId: 'dev-2' }).challenge;
    const otherRequest = store.issue({ ...b, pendingId: 'p-B' }).challenge;
    expect(store.consume(mine, b)).toBe('ok');
    expect(store.consume(otherDevice, { ...b, deviceId: 'dev-2' })).toBe('ok');
    expect(store.consume(otherRequest, { ...b, pendingId: 'p-B' })).toBe('ok');
  });

  it('an unknown challenge is refused', () => {
    expect(store.consume('nope', b)).toBe('unknown');
  });

  it('honours a custom ttl', () => {
    const s = new ChallengeStore({ now: () => t, ttlMs: 10 });
    const c = s.issue(b).challenge;
    t += 11;
    expect(s.consume(c, b)).toBe('expired');
  });
});

describe('assertions', () => {
  it('asks for the device key only, with user verification, on the configured rpID', async () => {
    const { credential } = await paired();
    const o = await assertionOptions(cfg, credential, 'Y2hhbGxlbmdl');
    expect(o.challenge).toBe('Y2hhbGxlbmdl');
    expect(o.rpId).toBe(cfg.rpID);
    expect(o.userVerification).toBe('required');
    expect(o.timeout).toBe(60_000);
    expect(o.allowCredentials?.map(c => c.id)).toEqual([credential.id]);
  });

  it('an assertion signed by another device key is refused', async () => {
    const { credential } = await paired();
    const other = await paired();
    const challenge = new ChallengeStore().issue(b).challenge;
    const response = other.soft.assert(await assertionOptions(cfg, credential, challenge));
    await expect(verifyAssertion(cfg, credential, response, challenge)).rejects.toThrow();
    // Same key, claiming to be the device's credential: the signature does not match its public key.
    const forged = { ...response, id: credential.id, rawId: credential.id };
    await expect(verifyAssertion(cfg, credential, forged, challenge)).rejects.toThrow();
  });

  it('an assertion without user verification is refused', async () => {
    const { soft, credential } = await paired();
    const challenge = new ChallengeStore().issue(b).challenge;
    const response = soft.assert(await assertionOptions(cfg, credential, challenge), { uv: false });
    await expect(verifyAssertion(cfg, credential, response, challenge)).rejects.toThrow();
  });

  it('an assertion for another challenge or origin is refused', async () => {
    const { soft, credential } = await paired();
    const store = new ChallengeStore();
    const c1 = store.issue(b).challenge;
    const c2 = store.issue({ ...b, pendingId: 'p-B' }).challenge;
    const response = soft.assert(await assertionOptions(cfg, credential, c1));
    await expect(verifyAssertion(cfg, credential, response, c2)).rejects.toThrow();
    const elsewhere = soft.assert(await assertionOptions(cfg, credential, c1), { origin: 'https://evil.example' });
    await expect(verifyAssertion(cfg, credential, elsewhere, c1)).rejects.toThrow();
  });

  it('a counter that does not move forward is refused', async () => {
    const { soft, credential } = await paired();
    const challenge = new ChallengeStore().issue(b).challenge;
    const response = soft.assert(await assertionOptions(cfg, credential, challenge));
    await expect(verifyAssertion(cfg, { ...credential, counter: 5 }, response, challenge)).rejects.toThrow();
  });

  it('a malformed response is refused', async () => {
    const { credential } = await paired();
    await expect(verifyAssertion(cfg, credential, { id: 'x' }, 'c')).rejects.toThrow();
    await expect(verifyAssertion(cfg, credential, null, 'c')).rejects.toThrow();
  });

  it('challengeOf reads clientDataJSON and tolerates garbage', async () => {
    const { soft, credential } = await paired();
    const response = soft.assert(await assertionOptions(cfg, credential, 'Y2hhbGxlbmdl'));
    expect(challengeOf(response)).toBe('Y2hhbGxlbmdl');
    expect(challengeOf(null)).toBeNull();
    expect(challengeOf({ response: { clientDataJSON: 'not json' } })).toBeNull();
    expect(challengeOf({ response: { clientDataJSON: Buffer.from('{"challenge":42}').toString('base64url') } })).toBeNull();
    expect(challengeOf({ response: { clientDataJSON: Buffer.from('[]').toString('base64url') } })).toBeNull();
  });
});
