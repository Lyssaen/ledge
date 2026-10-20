import { concat } from './bytes.js';
import { b64u, fromB64u } from './encoding.js';
import { importPublicKey } from './identity.js';

const subtle = globalThis.crypto.subtle;
const DOMAIN = new TextEncoder().encode('ledge-key/1');

/** First 22 characters of base64url(SHA-256("ledge-key/1" || raw point)). Throws `bad_key` on an invalid point. */
export async function fingerprint(publicKey: string): Promise<string> {
  await importPublicKey(publicKey);
  const digest = await subtle.digest('SHA-256', concat(DOMAIN, fromB64u(publicKey)));
  return b64u(new Uint8Array(digest)).slice(0, 22);
}
