import { describe, expect, it } from 'vitest';
import { checkCommitment, commit, generateIdentity, pairingCode, randomNonce } from '../src/index.js';

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
});
