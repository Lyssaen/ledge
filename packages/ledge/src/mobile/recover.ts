// Passkey recovery on the PC: an app that lost its device key comes back under a new one with its passkey, without a pairing code
// (missions/passkey-reinstall/CONCEPTION.md, docs/mobile-passkey-recover-contract.md). Pairing's sibling: same peers, same frames' path.
import { RECOVER_TTL_MS, type RecoverRefusal, type SealedFrame } from '@ledge/protocol';
import { fingerprint, fromB64u, importPublicKey, randomNonce, recoverChallenge, userHandleMatches, type Identity } from '@ledge/seal';
import { verifyAssertion, type DeviceCredential, type Rp } from './webauthn.js';
import type { RecoveryFile } from './files.js';
import type { Schedule } from './link.js';
import { log } from '../log.js';

/** Recoveries asked on the account in an hour before `rate`. */
export const RECOVER_PER_HOUR = 5;
/** Failed verifications before recovery is blocked until « Débloquer » on the PC. */
export const RECOVER_FAILURES_MAX = 3;
/** Recoveries waiting for their proof at once, one per peer. */
export const RECOVERIES_MAX = 3;
/** How long a revoked passkey is still told apart from an unknown one (« révoqué le … »). */
export const TOMBSTONE_MS = 90 * 86_400_000;
const HOUR_MS = 3_600_000;

export interface RecoverTarget { id: string; name: string; credential: DeviceCredential }

export interface Recovery {
  /** True if `frame` was a `recover_*` frame (handled or ignored here). */
  receive(peer: string, frame: SealedFrame): Promise<boolean>;
  /** A device with a passkey was revoked: its passkey is told apart from an unknown one for 90 days (« révoqué le … »). */
  bury(credentialId: string, device: string, at: string): void;
  /** « Débloquer »: recovery is taken again, its failures forgotten. */
  unblock(): void;
  blocked(): RecoveryFile['blocked'];
  /** A new `welcome`: the recoveries waiting for a proof are dropped (their peers are gone). */
  reset(): void;
  stop(): void;
}

interface Entry { peer: string; device: string; deviceNonce: string; pcNonce: string; model?: string; expiresAt: number; cancel: () => void }

const realSchedule: Schedule = (fn, ms) => {
  const h = setTimeout(fn, ms);
  return () => clearTimeout(h);
};

/**
 * `byCredential` names the approved device a passkey belongs to; `restore` moves that device under its new
 * key (and returns the name it keeps), synchronously, given the passkey that signed so it can refuse one that changed since; `refused` notes on a connected device that another tried to take its place. `file` is the
 * persisted memory (recovery.json), written after each change. `now` and `schedule` are for tests.
 */
export function createRecovery(opts: {
  pc: Identity;
  pcName: () => string | undefined;
  send(peer: string, frame: SealedFrame): void;
  rp(): Rp | null;
  byCredential(credentialId: string): RecoverTarget | null;
  online(deviceId: string): boolean;
  restore(old: RecoverTarget, next: { publicKey: string; id: string; peer: string; model?: string; counter: number }): string;
  refused(deviceId: string, model: string | undefined): void;
  onBlocked(): void;
  file: { read(): RecoveryFile; write(f: RecoveryFile): void };
  now?: () => number;
  schedule?: Schedule;
}): Recovery {
  const now = opts.now ?? Date.now;
  const schedule = opts.schedule ?? realSchedule;
  const entries = new Map<string, Entry>();
  let stopped = false;
  let mem = opts.file.read();

  const save = (next: RecoveryFile) => {
    mem = next;
    try { opts.file.write(next); } catch (e) { log(`mobile recovery: recovery.json not written (${(e as Error).message})`); }
  };
  const no = (peer: string, why: RecoverRefusal, more: Omit<Extract<SealedFrame, { k: 'recover_no' }>, 'k' | 'why'> = {}) => {
    log(`mobile recovery: refused peer ${peer} (${why})`);
    opts.send(peer, { k: 'recover_no', why, ...more });
  };
  const drop = (e: Entry) => { e.cancel(); if (entries.get(e.peer) === e) entries.delete(e.peer); };

  const onStart = async (peer: string, f: Extract<SealedFrame, { k: 'recover_start' }>) => {
    const old = entries.get(peer);
    if (old) drop(old);
    if (mem.blocked) return no(peer, 'blocked');
    const t = now();
    const attempts = mem.attempts.filter(a => Date.parse(a) > t - HOUR_MS);
    if (attempts.length >= RECOVER_PER_HOUR) {
      const oldest = Math.min(...attempts.map(a => Date.parse(a)));
      return no(peer, 'rate', { retryInMs: Math.max(0, oldest + HOUR_MS - t) });
    }
    if (entries.size >= RECOVERIES_MAX) return no(peer, 'failed');
    let nonce: Uint8Array;
    try { nonce = fromB64u(f.n); } catch { return no(peer, 'failed'); }
    if (nonce.length !== 32) return no(peer, 'failed');
    // Counted and its place taken before anything waits: starts delivered together each see the others.
    save({ ...mem, attempts: [...attempts, new Date(t).toISOString()] });
    const e: Entry = { peer, device: f.d, deviceNonce: f.n, pcNonce: randomNonce(), ...(f.model ? { model: f.model } : {}), expiresAt: t + RECOVER_TTL_MS, cancel: () => {} };
    e.cancel = schedule(() => { if (entries.get(peer) === e) entries.delete(peer); }, RECOVER_TTL_MS);
    entries.set(peer, e);
    try { await importPublicKey(f.d); } catch { drop(e); return no(peer, 'failed'); }
    // A later start of the same peer, a new welcome or a stop took its place while the key was read: that one answers, or none.
    if (stopped || entries.get(peer) !== e) return;
    const name = opts.pcName();
    opts.send(peer, { k: 'recover_offer', pc: opts.pc.publicKey, n: e.pcNonce, ...(name ? { name } : {}) });
  };

  /** A failed verification of a known passkey: counted, and the third blocks recovery for the whole account. */
  const failed = (peer: string, why: string) => {
    log(`mobile recovery: verification failed for peer ${peer} (${why})`);
    const failures = [...mem.failures, new Date(now()).toISOString()];
    if (failures.length >= RECOVER_FAILURES_MAX) {
      save({ ...mem, failures, blocked: { since: new Date(now()).toISOString(), failures: failures.length } });
      opts.onBlocked();
      return no(peer, 'blocked');
    }
    save({ ...mem, failures });
    return no(peer, 'failed');
  };

  const onProof = async (peer: string, f: Extract<SealedFrame, { k: 'recover_proof' }>) => {
    const e = entries.get(peer);
    // Single use: the nonce is spent before anything is checked.
    if (e) drop(e);
    if (!e || now() > e.expiresAt) return no(peer, 'failed');
    if (mem.blocked) return no(peer, 'blocked');
    const rp = opts.rp();
    if (!rp) return no(peer, 'failed');
    const found = opts.byCredential(f.assertion.id);
    if (!found) {
      const t = mem.tombstones.find(x => x.credentialId === f.assertion.id && Date.parse(x.revokedAt) > now() - TOMBSTONE_MS);
      return no(peer, 'revoked', t ? { device: t.device, revokedAt: t.revokedAt } : {});
    }
    // The passkey as it is now: the checks after the waits below compare against it, not against what the list holds then.
    const target: RecoverTarget = { ...found, credential: { ...found.credential } };
    const challenge = await recoverChallenge({ pcPublicKey: opts.pc.publicKey, devicePublicKey: e.device, pcNonce: e.pcNonce, deviceNonce: e.deviceNonce });
    const verified = verifyAssertion(f.assertion, target.credential, rp, challenge);
    if (!verified.ok) return failed(peer, verified.why);
    // Not signed by WebAuthn: a consistency check only; the signed challenge is what binds the PC key (rule 1).
    if ((await userHandleMatches(f.userHandle, opts.pc.publicKey)) !== 'ok') return failed(peer, 'userHandle');
    const id = await fingerprint(e.device);
    // Nothing waits from here to the restore: the block, the passkey and the device's presence are read as the restore finds them.
    if (stopped) return;
    if (mem.blocked) return no(peer, 'blocked');
    const now_ = opts.byCredential(f.assertion.id);
    if (!now_ || now_.id !== target.id || now_.credential.publicKey !== target.credential.publicKey) {
      log(`mobile recovery: the passkey of device ${target.id} changed during the verification`);
      return no(peer, 'failed');
    }
    if (opts.online(target.id)) {
      opts.refused(target.id, e.model);
      return no(peer, 'connected', { device: target.name });
    }
    let name: string;
    try {
      name = opts.restore(target, { publicKey: e.device, id, peer, ...(e.model ? { model: e.model } : {}), counter: verified.counter });
    } catch (err) {
      log(`mobile recovery: device ${target.id} not restored (${(err as Error).message})`);
      return no(peer, 'failed');
    }
    save({ ...mem, failures: [] });
    log(`mobile recovery: device ${target.id} is back with its passkey`);
    opts.send(peer, { k: 'recover_ok', name });
  };

  return {
    async receive(peer, frame) {
      if (!frame.k.startsWith('recover_')) return false;
      if (stopped) return true;
      if (frame.k === 'recover_start') await onStart(peer, frame);
      else if (frame.k === 'recover_proof') await onProof(peer, frame);
      // recover_offer, recover_ok and recover_no only travel from the PC: ignored.
      return true;
    },
    bury(credentialId, device, at) {
      const limit = now() - TOMBSTONE_MS;
      const kept = mem.tombstones.filter(t => t.credentialId !== credentialId && Date.parse(t.revokedAt) > limit);
      save({ ...mem, tombstones: [...kept, { credentialId, device, revokedAt: at }] });
    },
    unblock() {
      if (!mem.blocked && mem.failures.length === 0) return;
      const { blocked: _b, ...rest } = mem;
      save({ ...rest, failures: [] });
    },
    blocked: () => mem.blocked,
    reset() { for (const e of [...entries.values()]) drop(e); },
    stop() { stopped = true; for (const e of [...entries.values()]) drop(e); }
  };
}
