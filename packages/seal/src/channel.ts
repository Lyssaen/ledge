import { concat } from './bytes.js';
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
  let ephPrivate: CryptoKey | null = eph.privateKey;

  return {
    hello: b64u(ephRaw),
    async finish(peerHello: string): Promise<Channel> {
      // One-shot: a second finish would yield a second channel with the same keys and nonces.
      // Consumed synchronously (before any await), even if peerHello turns out invalid.
      const priv = ephPrivate;
      ephPrivate = null;
      if (!priv) throw new SealError('bad_key', 'handshake already finished');
      const peerEph = await importPublicKey(peerHello);
      const peerEphRaw = fromB64u(peerHello);
      const ee = await ecdh(priv, peerEph);

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
      const aes = (raw: Uint8Array<ArrayBuffer>, usage: 'encrypt' | 'decrypt') =>
        subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);
      const pcToDevice = okm.slice(0, 32);
      const deviceToPc = okm.slice(32, 64);
      const sendKey = await aes(role === 'pc' ? pcToDevice : deviceToPc, 'encrypt');
      const recvKey = await aes(role === 'pc' ? deviceToPc : pcToDevice, 'decrypt');

      let sendSeq = 0;
      let recvSeq = 0;
      const params = (seq: Uint8Array<ArrayBuffer>) => ({
        name: 'AES-GCM' as const,
        iv: concat(new Uint8Array(4), seq),
        additionalData: concat(th, seq),
      });

      // Each direction runs one operation at a time so that seq order and
      // resolution order are preserved; a rejection does not break the chain.
      let sealChain: Promise<unknown> = Promise.resolve();
      let openChain: Promise<unknown> = Promise.resolve();
      const serial = <T>(chain: Promise<unknown>, task: () => Promise<T>): [Promise<T>, Promise<unknown>] => {
        const run = chain.then(task);
        return [run, run.catch(() => undefined)];
      };

      const sealOne = async (text: string): Promise<string> => {
        const seq = seqBytes(sendSeq++);
        const ct = new Uint8Array(await subtle.encrypt(params(seq), sendKey, enc.encode(text)));
        return b64u(concat(seq, ct));
      };

      const openOne = async (sealed: string): Promise<string> => {
        const frame = fromB64u(sealed);
        if (frame.length < SEQ_BYTES + TAG_BYTES) throw new SealError('bad_seal', 'frame too short');
        const seq = frame.slice(0, SEQ_BYTES);
        const got = new DataView(seq.buffer).getBigUint64(0);
        // A gap means a frame was lost (e.g. refused by the relay): the channel cannot resume, re-handshake.
        if (got > BigInt(recvSeq)) throw new SealError('gap', 'a frame is missing before this one');
        if (got < BigInt(recvSeq)) throw new SealError('replay', 'frame already seen');
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
      };

      return {
        seal(text) {
          const [run, next] = serial(sealChain, () => sealOne(text));
          sealChain = next;
          return run;
        },
        open(sealed) {
          const [run, next] = serial(openChain, () => openOne(sealed));
          openChain = next;
          return run;
        },
      };
    },
  };
}
