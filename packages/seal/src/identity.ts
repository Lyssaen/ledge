import { concat } from './bytes.js';
import { b64u, fromB64u } from './encoding.js';
import { SealError } from './errors.js';

const subtle = globalThis.crypto.subtle;
const ALGO = { name: 'ECDH', namedCurve: 'P-256' } as const;

export interface Identity {
  /** Uncompressed P-256 point (65 bytes, leading 0x04), base64url. */
  publicKey: string;
  privateKey: CryptoKey;
}

export async function generateIdentity(opts: { extractable?: boolean } = {}): Promise<Identity> {
  const extractable = opts.extractable ?? false;
  const pair = await subtle.generateKey(ALGO, extractable, ['deriveBits']);
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const privateKey = pair.privateKey;
  return { publicKey: b64u(raw), privateKey };
}

export async function exportIdentity(id: Identity): Promise<string> {
  return b64u(new Uint8Array(await subtle.exportKey('pkcs8', id.privateKey)));
}

/** The public key is derived from the private key, never taken from a separate stored copy. */
export async function importIdentity(pkcs8: string): Promise<Identity> {
  const privateKey = await subtle.importKey('pkcs8', fromB64u(pkcs8), ALGO, true, ['deriveBits']);
  const jwk = await subtle.exportKey('jwk', privateKey);
  if (!jwk.x || !jwk.y) throw new SealError('bad_key', 'private key has no public coordinates');
  const point = concat(new Uint8Array([0x04]), fromB64u(jwk.x), fromB64u(jwk.y));
  const publicKey = b64u(point);
  await importPublicKey(publicKey);
  return { publicKey, privateKey };
}

export async function importPublicKey(publicKey: string): Promise<CryptoKey> {
  const raw = fromB64u(publicKey);
  if (raw.length !== 65 || raw[0] !== 0x04) throw new SealError('bad_key', 'not an uncompressed P-256 point');
  try {
    return await subtle.importKey('raw', raw, ALGO, true, []);
  } catch {
    throw new SealError('bad_key', 'point rejected by WebCrypto');
  }
}
