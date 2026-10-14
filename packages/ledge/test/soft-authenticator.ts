import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON
} from '@simplewebauthn/server';

/** What a real phone would do differently: skip user verification, or answer for another origin. */
export interface SoftOpts { uv?: boolean; origin?: string }

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();
const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
const uint32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const uint16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

const UP = 0x01, UV = 0x04, AT = 0x40;

/**
 * A software WebAuthn authenticator for tests: one P-256 key, `none` attestation.
 * It does no checks of its own, so tests can make it answer what a hostile or broken client would.
 */
export function createSoftAuthenticator(o: { origin: string; rpID: string }) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = randomBytes(16);
  const jwk = publicKey.export({ format: 'jwk' });
  let signCount = 0;

  const clientData = (type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  const authData = (flags: number, extra: Buffer = Buffer.alloc(0)) =>
    Buffer.concat([sha256(o.rpID), Buffer.from([flags]), uint32(signCount), extra]);

  const coseKey = () => Buffer.from(isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(jwk.x!, 'base64url')],
    [-3, Buffer.from(jwk.y!, 'base64url')]
  ])));

  return {
    register(options: PublicKeyCredentialCreationOptionsJSON, opts: SoftOpts = {}): RegistrationResponseJSON {
      const uv = opts.uv ?? true;
      const attested = Buffer.concat([Buffer.alloc(16), uint16(credentialId.length), credentialId, coseKey()]);
      const data = authData(UP | (uv ? UV : 0) | AT, attested);
      const attestationObject = isoCBOR.encode(new Map<string, string | Uint8Array | Map<string, never>>([['fmt', 'none'], ['attStmt', new Map<string, never>()], ['authData', data]]));
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64u(clientData('webauthn.create', options.challenge, opts.origin ?? o.origin)),
          attestationObject: b64u(attestationObject),
          transports: ['internal']
        }
      };
    },

    assert(options: PublicKeyCredentialRequestOptionsJSON, opts: SoftOpts = {}): AuthenticationResponseJSON {
      const uv = opts.uv ?? true;
      signCount++;
      const data = authData(UP | (uv ? UV : 0));
      const cdj = clientData('webauthn.get', options.challenge, opts.origin ?? o.origin);
      const signer = createSign('SHA256');
      signer.update(Buffer.concat([data, sha256(cdj)]));
      const signature = signer.sign(privateKey);
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: 'public-key',
        clientExtensionResults: {},
        response: { clientDataJSON: b64u(cdj), authenticatorData: b64u(data), signature: b64u(signature) }
      };
    }
  };
}
