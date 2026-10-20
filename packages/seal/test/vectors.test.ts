import { describe, expect, it } from 'vitest';
import { commit, fingerprint, importIdentity, importPublicKey, pairingCode, SealError, startHandshake } from '../src/index.js';
import vectors from './vectors.json' with { type: 'json' };

const v = vectors;

describe('key-derivation vectors (shared with the browser, apps/mobile/e2e/crypto.spec.ts)', () => {
  it('recomputes every frozen output', async () => {
    const pc = await importIdentity(v.pc.pkcs8);
    const device = await importIdentity(v.device.pkcs8);
    expect(pc.publicKey).toBe(v.pc.publicKey);
    expect(device.publicKey).toBe(v.device.publicKey);
    expect(await fingerprint(pc.publicKey)).toBe(v.expected.pcFingerprint);
    expect(await fingerprint(device.publicKey)).toBe(v.expected.deviceFingerprint);
    expect(await commit(device.publicKey, v.deviceNonce)).toBe(v.expected.commit);
    expect(
      await pairingCode({ pcPublicKey: pc.publicKey, devicePublicKey: device.publicKey, deviceNonce: v.deviceNonce, pcNonce: v.pcNonce }),
    ).toBe(v.expected.pairingCode);

    const hp = await startHandshake(pc, 'pc', device.publicKey, { ephemeralPkcs8: v.pcEphemeral.pkcs8 });
    const hd = await startHandshake(device, 'device', pc.publicKey, { ephemeralPkcs8: v.deviceEphemeral.pkcs8 });
    const cp = await hp.finish(hd.hello);
    const cd = await hd.finish(hp.hello);
    const ready = '{"t":"ready"}';
    expect(await cp.seal(ready)).toBe(v.expected.sealed.pcToDevice);
    expect(await cd.seal(ready)).toBe(v.expected.sealed.deviceToPc);
    expect(await cd.open(v.expected.sealed.pcToDevice)).toBe(ready);
    expect(await cp.open(v.expected.sealed.deviceToPc)).toBe(ready);
  });

  it('refuses a point that starts with 0x04 but is not on P-256', async () => {
    const raw = Buffer.from(v.offCurve, 'base64url');
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(0x04);
    await expect(importPublicKey(v.offCurve)).rejects.toMatchObject({ name: 'SealError', code: 'bad_key' });
    await expect(importPublicKey(v.offCurve)).rejects.toBeInstanceOf(SealError);
    const device = await importIdentity(v.device.pkcs8);
    await expect(startHandshake(device, 'device', v.offCurve)).rejects.toMatchObject({ code: 'bad_key' });
  });
});
