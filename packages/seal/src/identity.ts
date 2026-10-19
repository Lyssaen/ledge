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

export async function importIdentity(pkcs8: string, publicKey: string): Promise<Identity> {
  await importPublicKey(publicKey);
  const privateKey = await subtle.importKey('pkcs8', fromB64u(pkcs8), ALGO, true, ['deriveBits']);
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
