import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

export interface PushSubscriptionKeys {
  /** User agent public key: uncompressed P-256 point, base64url. */
  p256dh: string;
  /** Authentication secret, base64url. */
  auth: string;
}

export interface EncryptPushOptions {
  /** Pad the plaintext (delimiter included) with zeros up to this many octets. */
  padTo?: number;
  salt?: Uint8Array;
  /** Test hook: the application server's ephemeral private key. */
  ephemeralPrivateKey?: Uint8Array;
}

const RS = 4096;

const expand = (ikm: Uint8Array, salt: Uint8Array, info: string, len: number): Buffer =>
  Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from(info, 'latin1'), len));

/** RFC 8291 web push encryption, aes128gcm (RFC 8188), a single record. Returns the full body. */
export function encryptPush(plain: Uint8Array, sub: PushSubscriptionKeys, opts: EncryptPushOptions = {}): Uint8Array {
  const uaPublic = Buffer.from(sub.p256dh, 'base64url');
  const authSecret = Buffer.from(sub.auth, 'base64url');
  const salt = Buffer.from(opts.salt ?? randomBytes(16));
  if (salt.length !== 16) throw new Error('salt must be 16 octets');
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('p256dh is not an uncompressed P-256 point');

  const eph = createECDH('prime256v1');
  if (opts.ephemeralPrivateKey) eph.setPrivateKey(Buffer.from(opts.ephemeralPrivateKey));
  else eph.generateKeys();
  const asPublic = eph.getPublicKey();
  const secret = eph.computeSecret(uaPublic); // throws when the point is not on the curve

  const ikm = Buffer.from(
    hkdfSync(
      'sha256',
      secret,
      authSecret,
      Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), uaPublic, asPublic]),
      32,
    ),
  );
  const cek = expand(ikm, salt, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = expand(ikm, salt, 'Content-Encoding: nonce\0', 12);

  const padded = Math.max(opts.padTo ?? 0, plain.length + 1);
  const record = Buffer.alloc(padded);
  record.set(plain, 0);
  record[plain.length] = 2;
  if (padded + 16 > RS) throw new Error('payload does not fit in one record');

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RS, 16);
  header[20] = asPublic.length;
  return new Uint8Array(Buffer.concat([header, asPublic, sealed]));
}
