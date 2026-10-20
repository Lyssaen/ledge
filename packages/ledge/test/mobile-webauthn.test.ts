import { describe, it, expect } from 'vitest';
import { challengeOf, rpOf, verifyAssertion, verifyRegistration, type DeviceCredential } from '../src/mobile/webauthn.js';
import { softAuthenticator } from './mobile-soft-authenticator.js';

const rp = { rpId: 'relay.example.com', origin: 'https://relay.example.com' };
const CH = 'Y2hhbGxlbmdl';
const reg = (auth = softAuthenticator()) => verifyRegistration(auth.create(rp, CH), rp, CH);
const stored = (auth = softAuthenticator(), counter = 0): DeviceCredential => {
  const r = verifyRegistration(auth.create(rp, CH), rp, CH);
  if (!r.ok) throw new Error(r.why);
  return { ...r.credential, counter };
};
const cdj = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const cut = (b64: string, n: number): string => Buffer.from(b64, 'base64url').subarray(0, n).toString('base64url');

describe('verifyRegistration', () => {
  it.each([-7, -257] as const)('accepts alg %i', (alg) => {
    const auth = softAuthenticator({ alg });
    const r = verifyRegistration(auth.create(rp, CH, { counter: 3 }), rp, CH);
    expect(r).toMatchObject({ ok: true, credential: { id: auth.id, alg, rpId: rp.rpId, counter: 3 } });
  });

  it('refuses each wrong ceremony', () => {
    const a = softAuthenticator();
    const why = (c: ReturnType<typeof a.create>, r = rp) => verifyRegistration(c, r, CH);
    expect(why(a.create(rp, CH, { type: 'webauthn.get' }))).toEqual({ ok: false, why: 'type' });
    expect(verifyRegistration(a.create(rp, CH), rp, 'other')).toEqual({ ok: false, why: 'challenge' });
    expect(why(a.create(rp, CH, { origin: 'https://evil.example' }))).toEqual({ ok: false, why: 'origin' });
    expect(why(a.create(rp, CH, { crossOrigin: true }))).toEqual({ ok: false, why: 'origin' });
    expect(why(a.create(rp, CH, { rpIdOf: 'other.example' }))).toEqual({ ok: false, why: 'rp' });
    expect(why(softAuthenticator({ uv: false }).create(rp, CH))).toEqual({ ok: false, why: 'flags' });
    expect(why(a.create(rp, CH, { at: false }))).toEqual({ ok: false, why: 'flags' });
  });

  it('refuses a credential id that differs from the attested one', () => {
    const a = softAuthenticator();
    const c = a.create(rp, CH);
    expect(verifyRegistration({ ...c, id: softAuthenticator().id }, rp, CH)).toEqual({ ok: false, why: 'credential' });
  });

  it('refuses a truncated authenticatorData without throwing', () => {
    const c = softAuthenticator().create(rp, CH);
    expect(verifyRegistration({ ...c, authenticatorData: cut(c.authenticatorData, 36) }, rp, CH)).toEqual({ ok: false, why: 'malformed' });
    expect(verifyRegistration({ ...c, authenticatorData: cut(c.authenticatorData, 60) }, rp, CH)).toEqual({ ok: false, why: 'malformed' });
    expect(verifyRegistration({ ...c, authenticatorData: cut(c.authenticatorData, 40) }, rp, CH)).toEqual({ ok: false, why: 'malformed' });
  });

  it('refuses a key that does not match alg, and empty or garbage fields', () => {
    const ec = softAuthenticator().create(rp, CH);
    expect(verifyRegistration({ ...ec, alg: -257 }, rp, CH)).toEqual({ ok: false, why: 'alg' });
    const rsa = softAuthenticator({ alg: -257 }).create(rp, CH);
    expect(verifyRegistration({ ...rsa, alg: -7 }, rp, CH)).toEqual({ ok: false, why: 'alg' });
    expect(verifyRegistration({ ...ec, publicKey: 'AAAA' }, rp, CH)).toMatchObject({ ok: false });
    for (const k of ['id', 'publicKey', 'clientDataJSON', 'authenticatorData'] as const)
      expect(verifyRegistration({ ...ec, [k]: '' }, rp, CH)).toEqual({ ok: false, why: 'malformed' });
    expect(verifyRegistration({ ...ec, clientDataJSON: '!!' }, rp, CH)).toEqual({ ok: false, why: 'malformed' });
    expect(verifyRegistration({ ...ec, clientDataJSON: cdj([1]) }, rp, CH)).toEqual({ ok: false, why: 'malformed' });
  });

  it('keeps the transports', () => {
    const c = softAuthenticator().create(rp, CH);
    const r = verifyRegistration({ ...c, transports: ['internal'] }, rp, CH);
    expect(r.ok && r.credential.transports).toEqual(['internal']);
  });
});

describe('verifyAssertion', () => {
  it.each([-7, -257] as const)('accepts a valid signature, alg %i', (alg) => {
    const a = softAuthenticator({ alg });
    expect(verifyAssertion(a.get(rp, CH, { counter: 5 }), stored(a, 4), rp, CH)).toEqual({ ok: true, counter: 5 });
  });

  it('accepts counter 0 after 0', () => {
    const a = softAuthenticator();
    expect(verifyAssertion(a.get(rp, CH), stored(a, 0), rp, CH)).toEqual({ ok: true, counter: 0 });
  });

  it('refuses a signature from another key', () => {
    const a = softAuthenticator();
    const other = softAuthenticator();
    const forged = { ...other.get(rp, CH, { counter: 5 }), id: a.id };
    expect(verifyAssertion(forged, stored(a, 4), rp, CH)).toEqual({ ok: false, why: 'signature' });
  });

  it('refuses a counter that does not grow', () => {
    const a = softAuthenticator();
    expect(verifyAssertion(a.get(rp, CH, { counter: 4 }), stored(a, 4), rp, CH)).toEqual({ ok: false, why: 'counter' });
    expect(verifyAssertion(a.get(rp, CH, { counter: 0 }), stored(a, 3), rp, CH)).toEqual({ ok: false, why: 'counter' });
  });

  it('refuses each wrong ceremony', () => {
    const a = softAuthenticator();
    const cred = stored(a, 0);
    expect(verifyAssertion(a.get(rp, CH, { counter: 1, type: 'webauthn.create' }), cred, rp, CH)).toEqual({ ok: false, why: 'type' });
    expect(verifyAssertion(a.get(rp, 'other', { counter: 1 }), cred, rp, CH)).toEqual({ ok: false, why: 'challenge' });
    expect(verifyAssertion(a.get(rp, CH, { counter: 1, origin: 'https://evil.example' }), cred, rp, CH)).toEqual({ ok: false, why: 'origin' });
    expect(verifyAssertion(a.get(rp, CH, { counter: 1, crossOrigin: true }), cred, rp, CH)).toEqual({ ok: false, why: 'origin' });
    expect(verifyAssertion(a.get(rp, CH, { counter: 1, rpIdOf: 'other.example' }), cred, rp, CH)).toEqual({ ok: false, why: 'rp' });
    expect(verifyAssertion(a.get(rp, CH, { counter: 1, flags: 0x04 }), cred, rp, CH)).toEqual({ ok: false, why: 'flags' });
    expect(verifyAssertion(a.get(rp, CH, { counter: 1, flags: 0x01 }), cred, rp, CH)).toEqual({ ok: false, why: 'flags' });
    expect(verifyAssertion({ ...a.get(rp, CH, { counter: 1 }), id: 'AAAA' }, cred, rp, CH)).toEqual({ ok: false, why: 'credential' });
    expect(verifyAssertion(a.get(rp, CH, { counter: 1 }), { ...cred, rpId: 'other.example' }, rp, CH)).toEqual({ ok: false, why: 'rp' });
  });

  it('refuses empty or garbage fields without throwing', () => {
    const a = softAuthenticator();
    const cred = stored(a, 0);
    const good = a.get(rp, CH, { counter: 1 });
    for (const k of ['clientDataJSON', 'authenticatorData', 'signature'] as const)
      expect(verifyAssertion({ ...good, [k]: '' }, cred, rp, CH)).toEqual({ ok: false, why: 'malformed' });
    expect(verifyAssertion({ ...good, authenticatorData: cut(good.authenticatorData, 10) }, cred, rp, CH)).toEqual({ ok: false, why: 'malformed' });
    expect(verifyAssertion({ ...good, signature: 'AAAA' }, cred, rp, CH)).toEqual({ ok: false, why: 'signature' });
    expect(verifyAssertion(good, { ...cred, publicKey: 'AAAA' }, rp, CH)).toMatchObject({ ok: false });
    expect(reg().ok).toBe(true);
  });
});

describe('challengeOf', () => {
  it('reads the challenge', () => expect(challengeOf(cdj({ challenge: 'abc' }))).toBe('abc'));
  it('is null on invalid JSON, a missing challenge or an empty input', () => {
    expect(challengeOf(Buffer.from('{nope').toString('base64url'))).toBeNull();
    expect(challengeOf(cdj({ type: 'x' }))).toBeNull();
    expect(challengeOf('')).toBeNull();
  });
});

describe('rpOf', () => {
  it('derives the relying party', () => {
    expect(rpOf('https://relay.example.com/some/path')).toEqual(rp);
    expect(rpOf('http://localhost:5173')).toEqual({ rpId: 'localhost', origin: 'http://localhost:5173' });
  });
  it('refuses plain http off localhost and garbage', () => {
    expect(rpOf('http://192.168.1.10')).toBeNull();
    expect(rpOf('not a url')).toBeNull();
  });
});
