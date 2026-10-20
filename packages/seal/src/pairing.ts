/**
 * Linking code with a commitment. Exchange order (implemented in lot 3):
 *  1. the phone sends `pair_commit` with `commit(devicePublicKey, deviceNonce)` and a label;
 *  2. the PC answers `pair_offer` with its public key and `pcNonce`;
 *  3. the phone sends `pair_reveal` with its public key and `deviceNonce`;
 *  4. the PC runs `checkCommitment`;
 *  5. both sides display `pairingCode`.
 * Each side fixes its share before seeing the other's, so a relay cannot
 * grind offline for keys whose code matches on both sides.
 */
import { concat } from './bytes.js';
import { b64u, fromB64u } from './encoding.js';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const COMMIT_DOMAIN = 'ledge-pair/1 commit';
const CODE_DOMAIN = 'ledge-pair/1 code';

export function randomNonce(): string {
  return b64u(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-256', concat(...parts)));
}

export async function commit(devicePublicKey: string, deviceNonce: string): Promise<string> {
  return b64u(await sha256(enc.encode(COMMIT_DOMAIN), fromB64u(devicePublicKey), fromB64u(deviceNonce)));
}

export async function checkCommitment(commitment: string, devicePublicKey: string, deviceNonce: string): Promise<boolean> {
  let given: Uint8Array;
  let expected: Uint8Array;
  try {
    given = fromB64u(commitment);
    if (fromB64u(deviceNonce).length !== 32) return false;
    expected = fromB64u(await commit(devicePublicKey, deviceNonce));
  } catch {
    return false;
  }
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given[i]! ^ expected[i]!;
  return diff === 0;
}

export async function pairingCode(input: {
  pcPublicKey: string;
  devicePublicKey: string;
  deviceNonce: string;
  pcNonce: string;
}): Promise<string> {
  const hash = await sha256(
    enc.encode(CODE_DOMAIN),
    fromB64u(input.pcPublicKey),
    fromB64u(input.devicePublicKey),
    fromB64u(input.deviceNonce),
    fromB64u(input.pcNonce),
  );
  const n = new DataView(hash.buffer, hash.byteOffset, 4).getUint32(0, false) % 1_000_000;
  const digits = String(n).padStart(6, '0');
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}
