import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { b64u, checkCommitment, commit, generateIdentity, pairingCode, randomNonce } from '../src/index.js';

describe('pairing code', () => {
  it('gives both sides the same six digits', async () => {
    const pc = await generateIdentity(), dev = await generateIdentity();
    const input = { pcPublicKey: pc.publicKey, devicePublicKey: dev.publicKey, deviceNonce: randomNonce(), pcNonce: randomNonce() };
    const code = await pairingCode(input);
    expect(code).toMatch(/^\d{3} \d{3}$/);
    expect(await pairingCode({ ...input })).toBe(code);
  });
  it('changes with any input', async () => {
    const a = await generateIdentity(), b = await generateIdentity(), c = await generateIdentity();
    const base = { pcPublicKey: a.publicKey, devicePublicKey: b.publicKey, deviceNonce: randomNonce(), pcNonce: randomNonce() };
    const code = await pairingCode(base);
    for (const change of [{ pcPublicKey: c.publicKey }, { devicePublicKey: c.publicKey }, { deviceNonce: randomNonce() }, { pcNonce: randomNonce() }])
      expect(await pairingCode({ ...base, ...change })).not.toBe(code);
  });
  it('checks the commitment against the revealed key and nonce', async () => {
    const dev = await generateIdentity(), other = await generateIdentity(), n = randomNonce();
    const c = await commit(dev.publicKey, n);
    expect(await checkCommitment(c, dev.publicKey, n)).toBe(true);
    expect(await checkCommitment(c, other.publicKey, n)).toBe(false);
    expect(await checkCommitment(c, dev.publicKey, randomNonce())).toBe(false);
  });
  it('refuses a malformed commitment without throwing', async () => {
    const dev = await generateIdentity(), n = randomNonce();
    expect(await checkCommitment('!!', dev.publicKey, n)).toBe(false);
    expect(await checkCommitment('AAAA', dev.publicKey, n)).toBe(false);
  });
  it('refuses a commitment when the nonce is not 32 bytes', async () => {
    const dev = await generateIdentity();
    const short = b64u(new Uint8Array(16));
    const c = await commit(dev.publicKey, short);
    expect(await checkCommitment(c, dev.publicKey, short)).toBe(false);
  });
});

describe('pairing known answers', () => {
  const fixed = (byte: number) => {
    const raw = Buffer.alloc(65, byte);
    raw[0] = 4;
    return raw.toString('base64url');
  };
  const pcPublicKey = fixed(0x11);
  const devicePublicKey = fixed(0x22);
  const deviceNonce = Buffer.alloc(32, 0x33).toString('base64url');
  const pcNonce = Buffer.alloc(32, 0x44).toString('base64url');
  const raw = (s: string) => Buffer.from(s, 'base64url');
  const sha = (...parts: Uint8Array[]) => {
    const h = createHash('sha256');
    for (const p of parts) h.update(p);
    return h.digest();
  };
  const codeOf = (h: Buffer) => {
    const d = String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
    return `${d.slice(0, 3)} ${d.slice(3)}`;
  };

  it('commit matches an independent SHA-256', async () => {
    const expected = sha(Buffer.from('ledge-pair/1 commit'), raw(devicePublicKey), raw(deviceNonce)).toString('base64url');
    expect(await commit(devicePublicKey, deviceNonce)).toBe(expected);
  });
  it('pairingCode matches an independent SHA-256', async () => {
    const h = sha(Buffer.from('ledge-pair/1 code'), raw(pcPublicKey), raw(devicePublicKey), raw(deviceNonce), raw(pcNonce));
    expect(await pairingCode({ pcPublicKey, devicePublicKey, deviceNonce, pcNonce })).toBe(codeOf(h));
  });
  it('pads a leading zero', async () => {
    const zeroNonce = 'AAAAAUREREREREREREREREREREREREREREREREREREQ'; // pcNonce found offline: code starts with 0
    const h = sha(Buffer.from('ledge-pair/1 code'), raw(pcPublicKey), raw(devicePublicKey), raw(deviceNonce), raw(zeroNonce));
    expect(codeOf(h)).toBe('006 256');
    expect(await pairingCode({ pcPublicKey, devicePublicKey, deviceNonce, pcNonce: zeroNonce })).toBe('006 256');
  });
});
