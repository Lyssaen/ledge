import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

// A software passkey for tests: builds clientDataJSON, authenticatorData and signatures like a platform authenticator would.
// The attested credential's COSE key is a dummy byte: the daemon reads the SPKI from the credential, not the COSE.

export interface SoftRp { rpId: string; origin: string }
export interface SoftCredential { id: string; publicKey: string; alg: -7 | -257; clientDataJSON: string; authenticatorData: string }
export interface SoftAssertion { id: string; clientDataJSON: string; authenticatorData: string; signature: string }
/** Knobs to build a deliberately wrong ceremony. */
export interface SoftOpts { counter?: number; type?: string; origin?: string; crossOrigin?: boolean; rpIdOf?: string; flags?: number }

const sha256 = (b: Buffer | string): Buffer => createHash('sha256').update(b).digest();

export function softAuthenticator(init: { alg?: -7 | -257; uv?: boolean; up?: boolean; idLength?: number; rsaBits?: number; curve?: string } = {}) {
  const alg = init.alg ?? -7;
  const up = init.up ?? true;
  const uv = init.uv ?? true;
  const { publicKey, privateKey }: { publicKey: KeyObject; privateKey: KeyObject } =
    alg === -7 ? generateKeyPairSync('ec', { namedCurve: init.curve ?? 'P-256' }) : generateKeyPairSync('rsa', { modulusLength: init.rsaBits ?? 2048 });
  const rawId = randomBytes(init.idLength ?? 32);
  const flags = (up ? 0x01 : 0) | (uv ? 0x04 : 0);

  const clientData = (type: string, rp: SoftRp, challenge: string, o: SoftOpts): string =>
    Buffer.from(JSON.stringify({ type, challenge, origin: o.origin ?? rp.origin, crossOrigin: o.crossOrigin ?? false })).toString('base64url');
  const header = (rp: SoftRp, f: number, counter: number, o: SoftOpts): Buffer => {
    const h = Buffer.alloc(37);
    sha256(o.rpIdOf ?? rp.rpId).copy(h, 0);
    h[32] = f;
    h.writeUInt32BE(counter, 33);
    return h;
  };

  return {
    id: rawId.toString('base64url'),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    alg,
    create(rp: SoftRp, challenge: string, o: SoftOpts & { at?: boolean } = {}): SoftCredential {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(rawId.length);
      const authData = Buffer.concat([header(rp, flags | (o.at === false ? 0 : 0x40), o.counter ?? 0, o), Buffer.alloc(16), len, rawId, Buffer.from([0xa0])]);
      return {
        id: rawId.toString('base64url'),
        publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
        alg,
        clientDataJSON: clientData(o.type ?? 'webauthn.create', rp, challenge, o),
        authenticatorData: authData.toString('base64url')
      };
    },
    get(rp: SoftRp, challenge: string, o: SoftOpts = {}): SoftAssertion {
      const authData = header(rp, o.flags ?? flags, o.counter ?? 0, o);
      const cdj = clientData(o.type ?? 'webauthn.get', rp, challenge, o);
      const data = Buffer.concat([authData, sha256(Buffer.from(cdj, 'base64url'))]);
      return {
        id: rawId.toString('base64url'),
        clientDataJSON: cdj,
        authenticatorData: authData.toString('base64url'),
        signature: sign('sha256', data, privateKey).toString('base64url')
      };
    }
  };
}
