import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON
} from '@simplewebauthn/server';
import { COSEALG, isoBase64URL } from '@simplewebauthn/server/helpers';
import { AuthenticationJsonSchema, RegistrationJsonSchema } from '@ledge/protocol';
import type { MobileConfig } from '../mobile/config.js';
import type { StoredCredential } from './devices.js';

/**
 * The library's classic defaults, named so it never probes for post-quantum algorithms: that probe prints
 * Node's "experimental feature" warnings into the daemon's output.
 */
const ALGORITHMS = [COSEALG.EdDSA, COSEALG.ES256, COSEALG.RS256];

/** The options the phone passes to `navigator.credentials.create()`. User verification is required (Face ID, Touch ID or the passcode). */
export function registrationOptions(cfg: MobileConfig, deviceName: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: 'Ledge',
    rpID: cfg.rpID,
    userName: deviceName,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    timeout: 60_000,
    supportedAlgorithmIDs: ALGORITHMS
  });
}

/** Checks the phone's answer against the challenge, the configured origin and its host; throws on any failure. */
export async function verifyRegistration(cfg: MobileConfig, response: unknown, expectedChallenge: string): Promise<StoredCredential> {
  const parsed = RegistrationJsonSchema.safeParse(response);
  if (!parsed.success) throw new Error('malformed registration response');
  const v = await verifyRegistrationResponse({
    response: parsed.data as unknown as RegistrationResponseJSON,
    expectedChallenge,
    expectedOrigin: cfg.origin,
    expectedRPID: cfg.rpID,
    requireUserVerification: true,
    supportedAlgorithmIDs: ALGORITHMS
  });
  if (!v.verified) throw new Error('registration not verified');
  const { credential } = v.registrationInfo;
  return {
    id: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    ...(credential.transports?.length ? { transports: credential.transports } : {})
  };
}

/**
 * The options the phone passes to `navigator.credentials.get()` for a high-impact decision. The challenge comes
 * from `ChallengeStore` and is passed as bytes, so the options carry it unchanged (a string would be re-encoded).
 */
export function assertionOptions(cfg: MobileConfig, credential: StoredCredential, challenge: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: cfg.rpID,
    challenge: isoBase64URL.toBuffer(challenge),
    allowCredentials: [{ id: credential.id, ...(credential.transports ? { transports: credential.transports as AuthenticatorTransport[] } : {}) }],
    userVerification: 'required',
    timeout: 60_000
  });
}

/**
 * Checks an assertion against the requesting device's own key (H4: a passkey synced to another phone is useless
 * without this device's token), the challenge, the configured origin and its host, with user verification.
 * Throws on any failure; the caller stores `newCounter`.
 */
export async function verifyAssertion(cfg: MobileConfig, credential: StoredCredential, response: unknown, expectedChallenge: string): Promise<{ newCounter: number }> {
  const parsed = AuthenticationJsonSchema.safeParse(response);
  if (!parsed.success) throw new Error('malformed assertion');
  if (parsed.data.id !== credential.id || parsed.data.rawId !== credential.id) throw new Error('assertion from another credential');
  const v = await verifyAuthenticationResponse({
    response: parsed.data as unknown as AuthenticationResponseJSON,
    expectedChallenge,
    expectedOrigin: cfg.origin,
    expectedRPID: cfg.rpID,
    requireUserVerification: true,
    credential: { id: credential.id, publicKey: isoBase64URL.toBuffer(credential.publicKey), counter: credential.counter }
  });
  if (!v.verified) throw new Error('assertion not verified');
  return { newCounter: v.authenticationInfo.newCounter };
}

/** The challenge the browser signed, read from `clientDataJSON`; null when the response is not shaped like one. Not a verification. */
export function challengeOf(response: unknown): string | null {
  const cdj = (response as { response?: { clientDataJSON?: unknown } } | null)?.response?.clientDataJSON;
  if (typeof cdj !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cdj, 'base64url').toString('utf8'));
    const challenge = (parsed as { challenge?: unknown } | null)?.challenge;
    return typeof challenge === 'string' ? challenge : null;
  } catch {
    return null;
  }
}
