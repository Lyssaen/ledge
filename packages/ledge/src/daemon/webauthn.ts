import { generateRegistrationOptions, verifyRegistrationResponse, type PublicKeyCredentialCreationOptionsJSON, type RegistrationResponseJSON } from '@simplewebauthn/server';
import { COSEALG, isoBase64URL } from '@simplewebauthn/server/helpers';
import { RegistrationJsonSchema } from '@ledge/protocol';
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
