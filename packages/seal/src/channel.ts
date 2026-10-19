import { b64u, fromB64u } from './encoding.js';
import { SealError } from './errors.js';
import { importPublicKey, type Identity } from './identity.js';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const VERSION = 'ledge-seal/1';
const SEQ_BYTES = 8;
const TAG_BYTES = 16;

export type Role = 'pc' | 'device';

export interface Channel {
  seal(text: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

export interface Handshake {
  /** Ephemeral public key (65 bytes, base64url) to send to the peer. */
  hello: string;
  finish(peerHello: string): Promise<Channel>;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function seqBytes(seq: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(SEQ_BYTES);
  new DataView(out.buffer).setBigUint64(0, BigInt(seq));
  return out;
}

async function ecdh(priv: CryptoKey, pub: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256));
}

export async function startHandshake(self: Identity, role: Role, peerPublicKey: string): Promise<Handshake> {
  const peerStatic = await importPublicKey(peerPublicKey);
  const ss = await ecdh(self.privateKey, peerStatic);
  const eph = await subtle.generateKey(ECDH, false, ['deriveBits']);
  const ephRaw = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));

  return {
    hello: b64u(ephRaw),
    async finish(peerHello: string): Promise<Channel> {
      const peerEph = await importPublicKey(peerHello);
      const peerEphRaw = fromB64u(peerHello);
      const ee = await ecdh(eph.privateKey, peerEph);

      const selfStaticRaw = fromB64u(self.publicKey);
      const peerStaticRaw = fromB64u(peerPublicKey);
      const [pcStatic, deviceStatic, pcEph, deviceEph] =
        role === 'pc'
          ? [selfStaticRaw, peerStaticRaw, ephRaw, peerEphRaw]
          : [peerStaticRaw, selfStaticRaw, peerEphRaw, ephRaw];

      const th = new Uint8Array(
        await subtle.digest('SHA-256', concat(enc.encode(VERSION), pcStatic, deviceStatic, pcEph, deviceEph)),
      );
      const ikm = await subtle.importKey('raw', concat(ss, ee), 'HKDF', false, ['deriveBits']);
      const okm = new Uint8Array(
        await subtle.deriveBits(
          { name: 'HKDF', hash: 'SHA-256', salt: th, info: enc.encode(`${VERSION} keys`) },
          ikm,
          512,
        ),
      );
      const aes = (raw: Uint8Array<ArrayBuffer>) =>
        subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      const kPcToDevice = await aes(okm.slice(0, 32));
      const kDeviceToPc = await aes(okm.slice(32, 64));
      const sendKey = role === 'pc' ? kPcToDevice : kDeviceToPc;
      const recvKey = role === 'pc' ? kDeviceToPc : kPcToDevice;

      let sendSeq = 0;
      let recvSeq = 0;
      const params = (seq: Uint8Array<ArrayBuffer>) => ({
        name: 'AES-GCM' as const,
        iv: concat(new Uint8Array(4), seq),
        additionalData: concat(th, seq),
      });

      return {
        async seal(text) {
          const seq = seqBytes(sendSeq++);
          const ct = new Uint8Array(await subtle.encrypt(params(seq), sendKey, enc.encode(text)));
          return b64u(concat(seq, ct));
        },
        async open(sealed) {
          const frame = fromB64u(sealed);
          if (frame.length < SEQ_BYTES + TAG_BYTES) throw new SealError('bad_seal', 'frame too short');
          const seq = frame.slice(0, SEQ_BYTES);
          if (new DataView(seq.buffer).getBigUint64(0) !== BigInt(recvSeq)) {
            throw new SealError('replay', 'unexpected sequence number');
          }
          let plain: ArrayBuffer;
          try {
            plain = await subtle.decrypt(params(seq), recvKey, frame.slice(SEQ_BYTES));
          } catch {
            throw new SealError('bad_seal', 'authentication failed');
          }
          recvSeq++;
          try {
            return dec.decode(plain);
          } catch {
            throw new SealError('bad_seal', 'payload is not UTF-8');
          }
        },
      };
    },
  };
}
