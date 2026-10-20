import { createHash, createPublicKey, timingSafeEqual, verify, type KeyObject } from 'node:crypto';

// Verifies a device passkey with node:crypto only: no WebAuthn library, and no import of the protocol, so the
// e2e fake PC can load this file by relative path. The input shapes mirror the protocol's Credential and Assertion.

export interface Rp { rpId: string; origin: string }
/** A registered passkey as the daemon stores it. Strings are base64url. */
export interface DeviceCredential { id: string; publicKey: string; alg: -7 | -257; counter: number; rpId: string; transports?: string[] }
export interface CredentialInput { id: string; publicKey: string; alg: -7 | -257; clientDataJSON: string; authenticatorData: string; transports?: string[] }
export interface AssertionInput { id: string; clientDataJSON: string; authenticatorData: string; signature: string }
type Fail = { ok: false; why: string };

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;
const HEADER = 37;
const ATTESTED = HEADER + 16 + 2;

const fail = (why: string): Fail => ({ ok: false, why });
const sha256 = (b: Buffer | string): Buffer => createHash('sha256').update(b).digest();
const B64U = /^[A-Za-z0-9_-]+$/;
const bytes = (s: unknown): Buffer | null => (typeof s === 'string' && B64U.test(s) ? Buffer.from(s, 'base64url') : null);
const same = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

/** The relying party of a relay URL: its host and origin. None unless the page is served over https or from localhost. */
export function rpOf(relayUrl: string): Rp | null {
  try {
    const u = new URL(relayUrl);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost') return null;
    return { rpId: u.hostname, origin: u.origin };
  } catch { return null; }
}

function parseClientData(clientDataJSON: string): { type: unknown; challenge: unknown; origin: unknown; crossOrigin: unknown; raw: Buffer } | null {
  const raw = bytes(clientDataJSON);
  if (!raw) return null;
  try {
    const j: unknown = JSON.parse(raw.toString('utf8'));
    if (typeof j !== 'object' || j === null || Array.isArray(j)) return null;
    const o = j as Record<string, unknown>;
    return { type: o.type, challenge: o.challenge, origin: o.origin, crossOrigin: o.crossOrigin, raw };
  } catch { return null; }
}

/** The `challenge` field of a client data JSON, or null when it is not readable. */
export function challengeOf(clientDataJSON: string): string | null {
  const c = parseClientData(clientDataJSON);
  return c && typeof c.challenge === 'string' ? c.challenge : null;
}

/** The checks both ceremonies share on the client data. */
function checkClient(c: NonNullable<ReturnType<typeof parseClientData>>, type: string, rp: Rp, challenge: string): Fail | null {
  if (c.type !== type) return fail('type');
  if (typeof c.challenge !== 'string' || !same(Buffer.from(c.challenge), Buffer.from(challenge))) return fail('challenge');
  if (c.origin !== rp.origin || c.crossOrigin === true) return fail('origin');
  return null;
}

function publicKeyOf(spki: Buffer, alg: -7 | -257): KeyObject | null {
  try {
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    if (alg === -7) return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? key : null;
    return key.asymmetricKeyType === 'rsa' ? key : null;
  } catch { return null; }
}

export function verifyRegistration(c: CredentialInput, rp: Rp, challenge: string): { ok: true; credential: DeviceCredential } | Fail {
  const id = bytes(c?.id);
  const spki = bytes(c?.publicKey);
  const authData = bytes(c?.authenticatorData);
  const client = parseClientData(c?.clientDataJSON);
  if (!id || !spki || !authData || !client || authData.length < HEADER) return fail('malformed');
  if (c.alg !== -7 && c.alg !== -257) return fail('alg');
  const bad = checkClient(client, 'webauthn.create', rp, challenge);
  if (bad) return bad;
  if (!same(authData.subarray(0, 32), sha256(rp.rpId))) return fail('rp');
  const flags = authData[32]!;
  if (!(flags & UP) || !(flags & UV) || !(flags & AT)) return fail('flags');
  if (authData.length < ATTESTED) return fail('malformed');
  const idLen = authData.readUInt16BE(HEADER + 16);
  if (ATTESTED + idLen > authData.length) return fail('malformed');
  if (!same(authData.subarray(ATTESTED, ATTESTED + idLen), id)) return fail('credential');
  if (!publicKeyOf(spki, c.alg)) return fail('alg');
  const credential: DeviceCredential = { id: c.id, publicKey: c.publicKey, alg: c.alg, counter: authData.readUInt32BE(33), rpId: rp.rpId };
  if (c.transports) credential.transports = c.transports;
  return { ok: true, credential };
}

export function verifyAssertion(a: AssertionInput, cred: DeviceCredential, rp: Rp, challenge: string): { ok: true; counter: number } | Fail {
  const authData = bytes(a?.authenticatorData);
  const sig = bytes(a?.signature);
  const spki = bytes(cred?.publicKey);
  const client = parseClientData(a?.clientDataJSON);
  if (!authData || !sig || !spki || !client || authData.length < HEADER) return fail('malformed');
  if (a.id !== cred.id) return fail('credential');
  if (cred.rpId !== rp.rpId) return fail('rp');
  const bad = checkClient(client, 'webauthn.get', rp, challenge);
  if (bad) return bad;
  if (!same(authData.subarray(0, 32), sha256(rp.rpId))) return fail('rp');
  const flags = authData[32]!;
  if (!(flags & UP) || !(flags & UV)) return fail('flags');
  const key = publicKeyOf(spki, cred.alg);
  if (!key) return fail('alg');
  let ok = false;
  try { ok = verify('sha256', Buffer.concat([authData, sha256(client.raw)]), key, sig); } catch { /* an unreadable signature is an invalid one */ }
  if (!ok) return fail('signature');
  const counter = authData.readUInt32BE(33);
  if (!(counter > cred.counter || (counter === 0 && cred.counter === 0))) return fail('counter');
  return { ok: true, counter };
}
