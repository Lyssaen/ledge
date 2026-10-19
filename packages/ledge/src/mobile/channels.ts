// Sealed channels between the PC and its approved devices. The PC only responds: a device says hello, the PC answers.
import type { SealedFrame } from '@ledge/protocol';
import { fingerprint, SealError, startHandshake, type Channel, type Identity } from '@ledge/seal';
import type { ApprovedDevice } from './files.js';
import { log } from '../log.js';

/** Key confirmation: the first sealed message each way. */
const READY = '{"t":"ready"}';
/** At most one `rekey` per peer in this window. */
export const REKEY_INTERVAL_MS = 2000;
/** Past this many peers in the rekey table, entries older than the window are pruned. */
const REKEY_TABLE_PRUNE_AT = 256;

export interface Channels {
  /** A `hello` or `msg` from `peer`; other kinds are ignored. Frames of one peer are handled in arrival order. */
  receive(peer: string, frame: SealedFrame): Promise<void>;
  /** Seals `text` to the device's confirmed channel; false if it has none. */
  send(deviceId: string, text: string): Promise<boolean>;
  /** The peer went away (`presence` offline, or an `error` naming it). */
  drop(peer: string): void;
  /** The device was revoked. */
  dropDevice(deviceId: string): void;
  /** A new `welcome`: every channel is gone. */
  reset(): void;
  /** Ids of the devices that have a confirmed channel. */
  online(): Set<string>;
}

interface Entry {
  peer: string;
  deviceId: string;
  publicKey: string;
  channel: Channel;
  confirmed: boolean;
  /** Order of confirmation, so `send` picks the newest channel of a device. */
  confirmedSeq: number;
}

const codeOf = (err: unknown) => (err instanceof SealError ? err.code : err instanceof Error ? err.name : 'error');

/**
 * One channel per peer socket. A device is named by its key's fingerprint, never by its peer id: a channel only
 * counts once the device's sealed ready opens, which needs the private key that matches the approved public key.
 * `now` drives the rekey rate limit; it defaults to `Date.now`.
 */
export function createChannels(opts: {
  pc: Identity;
  devices(): ApprovedDevice[];
  send(peer: string, frame: SealedFrame): void;
  onConfirmed(deviceId: string, peer: string): void;
  onMessage(deviceId: string, text: string): void;
  onClosed(deviceId: string): void;
  now?: () => number;
}): Channels {
  const now = opts.now ?? Date.now;
  const entries = new Map<string, Entry>();
  /** The device a peer last opened a channel for, so a revoked device's later frames get `denied`, not `rekey`. */
  const lastDevice = new Map<string, string>();
  const lastRekey = new Map<string, number>();
  const queues = new Map<string, Promise<void>>();
  /** Bumped by `reset`, and per peer by `drop`: a hello still in its handshake then no longer counts. */
  let epoch = 0;
  const peerGen = new Map<string, number>();
  let confirmations = 0;
  let pcFingerprint: Promise<string> | null = null;

  const approved = (deviceId: string, publicKey?: string) =>
    opts.devices().find((d) => d.id === deviceId && (publicKey === undefined || d.publicKey === publicKey));

  const hasConfirmed = (deviceId: string) => [...entries.values()].some((e) => e.deviceId === deviceId && e.confirmed);

  const close = (e: Entry, why: string) => {
    if (entries.get(e.peer) !== e) return;
    entries.delete(e.peer);
    log(`mobile channel: closed for device ${e.deviceId} on peer ${e.peer} (${why})`);
    if (e.confirmed && !hasConfirmed(e.deviceId)) opts.onClosed(e.deviceId);
  };

  const denied = (peer: string) => opts.send(peer, { k: 'denied' });

  const rekey = (peer: string) => {
    const t = now();
    const last = lastRekey.get(peer);
    if (last !== undefined && t - last < REKEY_INTERVAL_MS) return;
    if (lastRekey.size >= REKEY_TABLE_PRUNE_AT) {
      for (const [p, at] of lastRekey) if (t - at >= REKEY_INTERVAL_MS) lastRekey.delete(p);
    }
    lastRekey.set(peer, t);
    opts.send(peer, { k: 'rekey' });
  };

  const onHello = async (peer: string, frame: Extract<SealedFrame, { k: 'hello' }>) => {
    const device = approved(frame.f);
    // The stored id must be the fingerprint of the stored key, or the key is not the one that was approved under it.
    if (!device || (await fingerprint(device.publicKey).catch(() => null)) !== device.id) {
      log(`mobile channel: denied hello from peer ${peer} for fingerprint ${frame.f}`);
      denied(peer);
      return;
    }
    const e0 = epoch;
    const g0 = peerGen.get(peer) ?? 0;
    let channel: Channel;
    let reply: string;
    try {
      const hs = await startHandshake(opts.pc, 'pc', device.publicKey);
      channel = await hs.finish(frame.e);
      reply = hs.hello;
    } catch (err) {
      log(`mobile channel: handshake failed for device ${device.id} on peer ${peer} (${codeOf(err)})`);
      const old = entries.get(peer);
      if (old) close(old, 'new hello');
      if (epoch === e0 && (peerGen.get(peer) ?? 0) === g0) rekey(peer);
      return;
    }
    pcFingerprint ??= fingerprint(opts.pc.publicKey);
    const f = await pcFingerprint;
    // Reset, dropped or revoked during the handshake: this hello no longer counts.
    if (epoch !== e0 || (peerGen.get(peer) ?? 0) !== g0) return;
    if (!approved(device.id, device.publicKey)) {
      log(`mobile channel: denied hello from peer ${peer}, device ${device.id} revoked`);
      denied(peer);
      return;
    }
    const old = entries.get(peer);
    if (old) close(old, 'new hello');
    entries.set(peer, { peer, deviceId: device.id, publicKey: device.publicKey, channel, confirmed: false, confirmedSeq: 0 });
    lastDevice.set(peer, device.id);
    log(`mobile channel: hello from device ${device.id} on peer ${peer}`);
    opts.send(peer, { k: 'hello', e: reply, f });
  };

  const onMsg = async (peer: string, frame: Extract<SealedFrame, { k: 'msg' }>) => {
    const e = entries.get(peer);
    if (!e) {
      const id = lastDevice.get(peer);
      if (id !== undefined && !approved(id)) {
        log(`mobile channel: denied msg from peer ${peer}, device ${id} revoked`);
        denied(peer);
      } else {
        rekey(peer);
      }
      return;
    }
    if (!approved(e.deviceId, e.publicKey)) {
      close(e, 'revoked');
      denied(peer);
      return;
    }
    let text: string;
    try {
      text = await e.channel.open(frame.s);
    } catch (err) {
      if (err instanceof SealError && err.code === 'replay') return;
      if (entries.get(peer) !== e) return;
      close(e, codeOf(err));
      rekey(peer);
      return;
    }
    // Closed, replaced or revoked while opening.
    if (entries.get(peer) !== e) return;
    if (!approved(e.deviceId, e.publicKey)) {
      close(e, 'revoked');
      denied(peer);
      return;
    }
    if (e.confirmed) {
      opts.onMessage(e.deviceId, text);
      return;
    }
    if (text !== READY) {
      close(e, 'no key confirmation');
      rekey(peer);
      return;
    }
    // Sealed before the channel counts as confirmed, so the PC's ready is its first sealed message.
    const sealed = await e.channel.seal(READY);
    if (entries.get(peer) !== e) return;
    e.confirmed = true;
    e.confirmedSeq = ++confirmations;
    opts.send(peer, { k: 'msg', s: sealed });
    log(`mobile channel: confirmed device ${e.deviceId} on peer ${peer}`);
    opts.onConfirmed(e.deviceId, peer);
  };

  const handle = async (peer: string, frame: SealedFrame) => {
    if (frame.k === 'hello') await onHello(peer, frame);
    else if (frame.k === 'msg') await onMsg(peer, frame);
    // pair_* go to pairing; denied and rekey only travel from the PC.
  };

  return {
    receive(peer, frame) {
      const run = (queues.get(peer) ?? Promise.resolve())
        .then(() => handle(peer, frame))
        .catch((err: unknown) => log(`mobile channel: error on peer ${peer} (${codeOf(err)})`));
      queues.set(peer, run);
      void run.then(() => { if (queues.get(peer) === run) queues.delete(peer); });
      return run;
    },

    async send(deviceId, text) {
      let best: Entry | null = null;
      for (const e of entries.values()) {
        if (e.deviceId === deviceId && e.confirmed && (!best || e.confirmedSeq > best.confirmedSeq)) best = e;
      }
      if (!best || !approved(best.deviceId, best.publicKey)) return false;
      const e = best;
      const sealed = await e.channel.seal(text);
      if (entries.get(e.peer) !== e) return false;
      opts.send(e.peer, { k: 'msg', s: sealed });
      return true;
    },

    drop(peer) {
      peerGen.set(peer, (peerGen.get(peer) ?? 0) + 1);
      const e = entries.get(peer);
      if (e) close(e, 'peer gone');
    },

    dropDevice(deviceId) {
      for (const e of [...entries.values()]) if (e.deviceId === deviceId) close(e, 'revoked');
    },

    reset() {
      epoch++;
      peerGen.clear();
      for (const e of [...entries.values()]) close(e, 'relay welcome');
    },

    online() {
      return new Set([...entries.values()].filter((e) => e.confirmed).map((e) => e.deviceId));
    }
  };
}
