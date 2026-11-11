/**
 * Reconnecting an app that lost its device key with its passkey (missions/passkey-reinstall/CONCEPTION.md §3-4).
 *
 * Rule 1: the phone computes the WebAuthn challenge itself from both keys and both nonces (`recoverChallenge`), so an assertion
 * made for a key the relay substituted is worthless to the real PC, which recomputes it with its own key.
 * Rule 2: the passkey's `user.id` carries the PC key's digest (`recoveryUserId`); on recovery the phone reads the assertion's
 * `userHandle` and checks it names the key the PC presents (`userHandleMatches`) before it sends anything.
 */
import { concat } from './bytes.js';
import { b64u, fromB64u } from './encoding.js';
import { importPublicKey } from './identity.js';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const CHALLENGE_DOMAIN = enc.encode('ledge-recover/1');
/** The same domain as `fingerprint`: the digest in a passkey is the fingerprint's first bytes. */
const KEY_DOMAIN = enc.encode('ledge-key/1');
/** The version tag a passkey made for recovery starts its `user.id` with (ASCII « L1 »). */
export const USER_ID_TAG = 'L1';
const TAG = enc.encode(USER_ID_TAG);
/** How many bytes of the PC key's digest a `user.id` carries, and how many random bytes follow. */
export const USER_ID_DIGEST_BYTES = 16;
export const USER_ID_RANDOM_BYTES = 16;
export const USER_ID_BYTES = TAG.length + USER_ID_DIGEST_BYTES + USER_ID_RANDOM_BYTES;

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-256', concat(...parts)));
}

/** The first bytes of SHA-256("ledge-key/1" ‖ raw point), as a passkey's `user.id` carries them. Throws `bad_key` on an invalid point. */
export async function keyDigest(publicKey: string): Promise<Uint8Array> {
  await importPublicKey(publicKey);
  return (await sha256(KEY_DOMAIN, fromB64u(publicKey))).slice(0, USER_ID_DIGEST_BYTES);
}

/** `c = SHA-256("ledge-recover/1" ‖ PC key ‖ new device key ‖ PC nonce ‖ device nonce)`, base64url: the WebAuthn challenge of a recovery. */
export async function recoverChallenge(input: { pcPublicKey: string; devicePublicKey: string; pcNonce: string; deviceNonce: string }): Promise<string> {
  return b64u(await sha256(
    CHALLENGE_DOMAIN,
    fromB64u(input.pcPublicKey),
    fromB64u(input.devicePublicKey),
    fromB64u(input.pcNonce),
    fromB64u(input.deviceNonce)
  ));
}

/** The `user.id` of a passkey made for this PC: « L1 » ‖ its key's digest ‖ random bytes (so two passkeys never share it). */
export async function recoveryUserId(pcPublicKey: string): Promise<Uint8Array> {
  return concat(TAG, await keyDigest(pcPublicKey), globalThis.crypto.getRandomValues(new Uint8Array(USER_ID_RANDOM_BYTES)));
}

/** The PC key digest a `user.id` / `userHandle` carries, or null for a passkey made before recovery existed (random id, no « L1 »). */
export function userHandleDigest(userHandle: string | Uint8Array): Uint8Array | null {
  let b: Uint8Array;
  try { b = typeof userHandle === 'string' ? fromB64u(userHandle) : userHandle; } catch { return null; }
  if (b.length !== USER_ID_BYTES || b[0] !== TAG[0] || b[1] !== TAG[1]) return null;
  return b.slice(TAG.length, TAG.length + USER_ID_DIGEST_BYTES);
}

/**
 * What a passkey's `userHandle` says of the PC key presented: `ok` it was made for that key, `old` it carries no key (made before
 * recovery: re-register it once), `other` it was made for another key (another PC, or this PC's key regenerated).
 */
export async function userHandleMatches(userHandle: string | Uint8Array, pcPublicKey: string): Promise<'ok' | 'old' | 'other'> {
  const got = userHandleDigest(userHandle);
  if (!got) return 'old';
  const want = await keyDigest(pcPublicKey);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got[i]! ^ want[i]!;
  return diff === 0 ? 'ok' : 'other';
}

/** A short tag for a key digest, as the phone shows two of them side by side: its first 4 bytes in hex, « 7F3A 91C2 ». */
export function digestTag(digest: Uint8Array): string {
  const hex = [...digest.slice(0, 4)].map(x => x.toString(16).padStart(2, '0').toUpperCase()).join('');
  return `${hex.slice(0, 4)} ${hex.slice(4)}`;
}
