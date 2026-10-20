import { describe, it, expect } from 'vitest';
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { encryptPush } from '../src/mobile/push/encrypt.js';

// RFC 8291 Appendix A, whitespace removed.
const b64u = (s: string) => new Uint8Array(Buffer.from(s.replace(/\s+/g, ''), 'base64url'));
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  header:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ',
};


/** Inverse of encryptPush, written independently with the user agent's private key. */
function decryptPush(body: Uint8Array, uaPrivate: Uint8Array, authSecret: Uint8Array): Uint8Array {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const idlen = buf[20]!;
  const asPublic = buf.subarray(21, 21 + idlen);
  const record = buf.subarray(21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(asPublic);
  const ikm = new Uint8Array(
    hkdfSync('sha256', secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32),
  );
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  expect(plain[end - 1]).toBe(2);
  return new Uint8Array(plain.subarray(0, end - 1));
}

const newSub = () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  return {
    priv: new Uint8Array(ua.getPrivateKey()),
    auth: new Uint8Array(auth),
    sub: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  };
};

describe('encryptPush', () => {
  it('matches the RFC 8291 appendix A body byte for byte', () => {
    const body = encryptPush(
      b64u(RFC.plaintext),
      { p256dh: RFC.uaPublic.replace(/\s+/g, ''), auth: RFC.authSecret },
      { salt: b64u(RFC.salt), ephemeralPrivateKey: b64u(RFC.asPrivate) },
    );
    const expected = Buffer.concat([b64u(RFC.header), b64u(RFC.ciphertext)]);
    expect(Buffer.from(body).toString('base64url')).toBe(expected.toString('base64url'));
    expect(Buffer.from(b64u(RFC.header)).subarray(21).toString('base64url')).toBe(RFC.asPublic.replace(/\s+/g, ''));
  });

  it('round-trips with the user agent private key', () => {
    const { priv, auth, sub } = newSub();
    const plain = new TextEncoder().encode('{"title":"héllo"}');
    expect(Buffer.from(decryptPush(encryptPush(plain, sub), priv, auth)).toString()).toBe('{"title":"héllo"}');
  });

  it('padTo hides the length and still decrypts', () => {
    const { priv, auth, sub } = newSub();
    const a = new Uint8Array(10).fill(65);
    const b = new Uint8Array(900).fill(66);
    const ea = encryptPush(a, sub, { padTo: 1024 });
    const eb = encryptPush(b, sub, { padTo: 1024 });
    expect(ea.length).toBe(eb.length);
    expect(Buffer.from(decryptPush(ea, priv, auth))).toEqual(Buffer.from(a));
    expect(Buffer.from(decryptPush(eb, priv, auth))).toEqual(Buffer.from(b));
  });

  it('rejects a p256dh that is not a point on the curve', () => {
    const { sub } = newSub();
    const bad = Buffer.alloc(65, 1);
    bad[0] = 4;
    expect(() => encryptPush(new Uint8Array(3), { ...sub, p256dh: bad.toString('base64url') })).toThrow();
  });
});
