// The phone's side of WebAuthn: it creates the device passkey and signs the daemon's challenges with it. The browser's
// API only; every binary field leaves as base64url, the form the protocol's `Credential` and `Assertion` take.
import { b64u, fromB64u } from '@ledge/seal';
import type { Assertion, Credential } from '@ledge/protocol';

/** A cancelled or timed-out prompt: the person said no, or did nothing. Not a failure. */
const isCancel = (e: unknown) => e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError');

/** Whether this device has a built-in authenticator that verifies the user (Face ID, fingerprint, PIN). False on any error. */
export async function platformAvailable(): Promise<boolean> {
  try {
    return (await globalThis.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()) === true;
  } catch { return false; }
}

/**
 * Creates the passkey for `ch.rpId`. `unsupported`: the browser cannot hand over the public key and its algorithm
 * (or no credentials API at all), or chose an algorithm the PC does not verify. `cancelled`: the prompt was dismissed.
 */
export async function createCredential(
  ch: { challenge: string; rpId: string },
  user: { label: string; id: Uint8Array }
): Promise<Credential | 'cancelled' | 'unsupported'> {
  const credentials = globalThis.navigator?.credentials;
  if (!credentials?.create) return 'unsupported';
  try {
    const made = await credentials.create({
      publicKey: {
        challenge: fromB64u(ch.challenge),
        rp: { id: ch.rpId, name: 'Ledge' },
        // `id`: « L1 » ‖ the PC key's digest ‖ random (recoveryUserId), what lets a reinstalled app recognise its PC.
        user: { id: user.id as Uint8Array<ArrayBuffer>, name: user.label, displayName: user.label },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
        attestation: 'none',
        timeout: 60_000
      }
    }) as PublicKeyCredential | null;
    const r = made?.response as AuthenticatorAttestationResponse | undefined;
    if (!made || !r) return 'cancelled';
    const key = r.getPublicKey?.();
    const alg = r.getPublicKeyAlgorithm?.();
    if (!key || (alg !== -7 && alg !== -257)) return 'unsupported';
    const transports = r.getTransports?.() ?? [];
    return {
      id: b64u(new Uint8Array(made.rawId)),
      publicKey: b64u(new Uint8Array(key)),
      alg,
      clientDataJSON: b64u(new Uint8Array(r.clientDataJSON)),
      authenticatorData: b64u(new Uint8Array(r.getAuthenticatorData())),
      ...(transports.length ? { transports } : {})
    };
  } catch (e) {
    if (isCancel(e)) return 'cancelled';
    throw e;
  }
}

/** Signs the daemon's challenge with the registered passkey. `cancelled`: the prompt was dismissed or timed out. */
export async function getAssertion(ch: { challenge: string; rpId: string; credentialId: string }): Promise<Assertion | 'cancelled'> {
  const credentials = globalThis.navigator?.credentials;
  if (!credentials?.get) return 'cancelled';
  try {
    const got = await credentials.get({
      publicKey: {
        challenge: fromB64u(ch.challenge),
        rpId: ch.rpId,
        allowCredentials: [{ type: 'public-key', id: fromB64u(ch.credentialId) }],
        userVerification: 'required',
        timeout: 60_000
      }
    }) as PublicKeyCredential | null;
    const r = got?.response as AuthenticatorAssertionResponse | undefined;
    if (!got || !r) return 'cancelled';
    return {
      id: b64u(new Uint8Array(got.rawId)),
      clientDataJSON: b64u(new Uint8Array(r.clientDataJSON)),
      authenticatorData: b64u(new Uint8Array(r.authenticatorData)),
      signature: b64u(new Uint8Array(r.signature))
    };
  } catch (e) {
    if (isCancel(e)) return 'cancelled';
    throw e;
  }
}

/** A discoverable assertion and the `userHandle` the passkey was made with (empty when the device gives none). */
export type Discoverable = { assertion: Assertion; userHandle: string };

/**
 * Asks the device for any passkey of `rpId` (no `allowCredentials`): after a reinstall the app knows none, and iOS still has
 * it in the iCloud keychain. `cancelled`: dismissed, timed out, or no passkey at all (iOS says the same for both, P3).
 */
export async function getDiscoverable(ch: { challenge: string; rpId: string }): Promise<Discoverable | 'cancelled'> {
  const credentials = globalThis.navigator?.credentials;
  if (!credentials?.get) return 'cancelled';
  try {
    const got = await credentials.get({
      publicKey: { challenge: fromB64u(ch.challenge), rpId: ch.rpId, userVerification: 'required', timeout: 60_000 }
    }) as PublicKeyCredential | null;
    const r = got?.response as AuthenticatorAssertionResponse | undefined;
    if (!got || !r) return 'cancelled';
    return {
      assertion: {
        id: b64u(new Uint8Array(got.rawId)),
        clientDataJSON: b64u(new Uint8Array(r.clientDataJSON)),
        authenticatorData: b64u(new Uint8Array(r.authenticatorData)),
        signature: b64u(new Uint8Array(r.signature))
      },
      userHandle: r.userHandle ? b64u(new Uint8Array(r.userHandle)) : ''
    };
  } catch (e) {
    if (isCancel(e)) return 'cancelled';
    throw e;
  }
}
