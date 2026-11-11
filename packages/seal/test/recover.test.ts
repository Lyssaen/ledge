import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { b64u, digestTag, fingerprint, fromB64u, generateIdentity, keyDigest, randomNonce, recoverChallenge, recoveryUserId, userHandleDigest, userHandleMatches, USER_ID_BYTES } from '../src/index.js';

describe('recovery challenge (rule 1)', () => {
  it('is SHA-256 of the domain, both keys and both nonces, in that order', async () => {
    const pc = await generateIdentity(), dev = await generateIdentity();
    const input = { pcPublicKey: pc.publicKey, devicePublicKey: dev.publicKey, pcNonce: randomNonce(), deviceNonce: randomNonce() };
    const want = createHash('sha256').update(Buffer.concat([Buffer.from('ledge-recover/1'), ...[input.pcPublicKey, input.devicePublicKey, input.pcNonce, input.deviceNonce].map(x => Buffer.from(fromB64u(x)))])).digest('base64url');
    expect(await recoverChallenge(input)).toBe(want);
  });
  it('changes with either key or either nonce: an assertion for a substituted PC key is worthless to the real PC', async () => {
    const [a, b, c] = await Promise.all([generateIdentity(), generateIdentity(), generateIdentity()]);
    const base = { pcPublicKey: a.publicKey, devicePublicKey: b.publicKey, pcNonce: randomNonce(), deviceNonce: randomNonce() };
    const ch = await recoverChallenge(base);
    for (const change of [{ pcPublicKey: c.publicKey }, { devicePublicKey: c.publicKey }, { pcNonce: randomNonce() }, { deviceNonce: randomNonce() }])
      expect(await recoverChallenge({ ...base, ...change })).not.toBe(ch);
  });
});

describe('the passkey user.id (rule 2)', () => {
  it('is « L1 », the PC key digest (the fingerprint\'s first bytes) and 16 random bytes', async () => {
    const pc = await generateIdentity();
    const id = await recoveryUserId(pc.publicKey);
    expect(id.length).toBe(USER_ID_BYTES);
    expect(new TextDecoder().decode(id.slice(0, 2))).toBe('L1');
    expect(b64u(id.slice(2, 18)).slice(0, 21)).toBe((await fingerprint(pc.publicKey)).slice(0, 21));
    expect(b64u(await recoveryUserId(pc.publicKey))).not.toBe(b64u(id));
  });
  it('tells a handle made for this key, an old random one, and one for another key', async () => {
    const pc = await generateIdentity(), other = await generateIdentity();
    const handle = b64u(await recoveryUserId(pc.publicKey));
    expect(await userHandleMatches(handle, pc.publicKey)).toBe('ok');
    expect(await userHandleMatches(handle, other.publicKey)).toBe('other');
    expect(await userHandleMatches(b64u(globalThis.crypto.getRandomValues(new Uint8Array(16))), pc.publicKey)).toBe('old');
    expect(await userHandleMatches('', pc.publicKey)).toBe('old');
    expect(await userHandleMatches('!!', pc.publicKey)).toBe('old');
    expect(userHandleDigest(handle)).toEqual(await keyDigest(pc.publicKey));
  });
  it('shows a digest as two groups of hex', async () => {
    expect(digestTag(new Uint8Array([0x7f, 0x3a, 0x91, 0xc2, 9]))).toBe('7F3A 91C2');
  });
});
