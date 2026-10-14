import type { ClientMessage, OperationReason, Pending, ServerMessage, Session } from '@ledge/protocol';
import type { Store } from './store.js';
import type { Peer } from './peers.js';
import { adapterFor, type KeyPlan } from '../adapters/index.js';
import { fingerprint, type OperationRecord, type OperationRegistry } from './operations.js';
import type { Binding, ChallengeStore } from './challenges.js';
import type { DeviceStore } from './devices.js';
import type { MobileConfig } from '../mobile/config.js';
import { assertionOptions, challengeOf, verifyAssertion } from './webauthn.js';
import { log } from '../log.js';

export type SessionDecide = Extract<ClientMessage, { type: 'session.decide' }>;
export type SessionReply = Extract<ClientMessage, { type: 'session.reply' }>;
export type DecidePrepare = Extract<ClientMessage, { type: 'decide.prepare' }>;
export type OperationStatusMsg = Extract<ClientMessage, { type: 'operation.status' }>;

export const READ_ONLY = 'session started without ledge, read only';
export const NO_PROMPT = 'no prompt visible in the terminal, open the tab';
export const NOT_TAKEN = 'the terminal did not take it';
export const BUSY = 'a decision is already in progress';
const FREE_TEXT = 'free-text answers are not supported yet, answer in the terminal';

/**
 * Why a decision was not carried out. `reason` is what a phone reads in `operation.result`; `message` is what a local
 * client reads in `error { id }`, unchanged from before for the paths it already knew (D10).
 */
export class Refusal extends Error {
  constructor(readonly reason: OperationReason, message: string = reason) { super(message); this.name = 'Refusal'; }
}

export interface DecisionDeps {
  store: Store;
  ops: OperationRegistry;
  challenges: ChallengeStore;
  devices?: DeviceStore;
  config(): MobileConfig | null;
  /** Live remote peers of a device: the final result of its operation goes to all of them, not only to the socket that asked. */
  peersOf?(deviceId: string): Peer[];
  /** `injectAndVerify`: takes the session lock, re-checks `expected` and builds the plan before the first character. */
  inject(id: string, planFor: (pane: string) => KeyPlan, requirePrompt: boolean, expected?: { id: string; version: number }): Promise<void>;
}

/** Whose operations these are: a phone reads only its own (and conflicts with any other). */
const ownerOf = (peer: Peer) => peer.ctx.kind === 'remote' ? `device:${peer.ctx.deviceId}` : 'local';

const resultOf = (r: OperationRecord): ServerMessage => ({ type: 'operation.result', operationId: r.id, status: r.status, ...(r.reason ? { reason: r.reason } : {}) });

/** `not_taken` and `no_prompt` mean the terminal was tried; every other reason is a refusal before anything was typed. */
const statusOf = (reason: OperationReason) => reason === 'not_taken' || reason === 'no_prompt' ? 'failed' as const : 'rejected' as const;

/** Both or neither: a request named by its id alone could be answered in a version nobody read. */
const namesRequestHalfway = (msg: { pendingId?: string; pendingVersion?: number }) => (msg.pendingId === undefined) !== (msg.pendingVersion === undefined);

/** Point 4 of the chain: the session still waits on exactly this request, in exactly this version. */
function requestFor(store: Store, id: string, pendingId: string, pendingVersion: number): { session: Session; pending: Pending & { id: string; version: number } } {
  const session = store.get(id);
  if (!session) throw new Refusal('stale', 'unknown session');
  const pending = session.pending;
  if (!pending || pending.id !== pendingId || pending.version === undefined) throw new Refusal('stale');
  if (pending.version !== pendingVersion) throw new Refusal('changed');
  if (session.source === 'hook_only') throw new Refusal('read_only', READ_ONLY);
  return { session, pending: pending as Pending & { id: string; version: number } };
}

/**
 * Runs `body` as an operation: the same `operationId` never runs twice (a replay gets the known result, another payload
 * or another owner a `conflict`). `operation.*` is sent only when the client named an operation; a local client still
 * gets `error { id }` on any failure (D10).
 */
async function operate(peer: Peer, msg: SessionDecide | SessionReply, deps: DecisionDeps, body: () => Promise<void>): Promise<void> {
  const opId = msg.operationId;
  const local = peer.ctx.kind === 'local';
  const notify = (m: ServerMessage) => {
    const to = new Set<Peer>([peer]);
    if (peer.ctx.kind === 'remote') for (const p of deps.peersOf?.(peer.ctx.deviceId) ?? []) to.add(p);
    for (const p of to) p.send(m);
  };
  if (opId) {
    const begun = deps.ops.begin(opId, ownerOf(peer), fingerprint(msg));
    if (begun.kind === 'conflict') {
      log(`${msg.type} ${msg.id}: operation ${opId} conflicts with an earlier one`);
      peer.send({ type: 'operation.result', operationId: opId, status: 'rejected', reason: 'conflict' });
      if (local) peer.send({ type: 'error', id: msg.id, message: 'conflict' });
      return;
    }
    if (begun.kind === 'replay') return peer.send(resultOf(begun.record));
    notify({ type: 'operation.received', operationId: opId });
  }
  try {
    await body();
  } catch (e) {
    const reason: OperationReason = e instanceof Refusal ? e.reason : 'not_taken';
    const status = statusOf(reason);
    log(`${msg.type} ${msg.id} ${status} (${reason}): ${(e as Error).message}`);
    if (opId) notify(resultOf(deps.ops.finish(opId, status, reason)));
    if (local) peer.send({ type: 'error', id: msg.id, message: (e as Error).message });
    return;
  }
  if (opId) notify(resultOf(deps.ops.finish(opId, 'applied')));
}

/** Raised from inside the plan builder, under the lock and before the first character: a phone revoked meanwhile types nothing. */
function stillPaired(peer: Peer, deps: DecisionDeps): void {
  if (peer.ctx.kind === 'remote' && !deps.devices?.get(peer.ctx.deviceId)) throw new Refusal('forbidden');
}

/**
 * Point 5: a phone's accept of anything but a low-risk request carries a WebAuthn assertion for a challenge bound to
 * this device, session, request, version and decision. The challenge is spent before any await; the key is the device's
 * own (never looked up from the assertion); the new counter is stored.
 */
async function checkAssertion(deviceId: string, msg: SessionDecide, sessionId: string, pending: { id: string; version: number }, deps: DecisionDeps): Promise<void> {
  if (!msg.assertion) throw new Refusal('assertion_required');
  const binding: Binding = { deviceId, sessionId, pendingId: pending.id, pendingVersion: pending.version, decision: 'accept' };
  const challenge = challengeOf(msg.assertion);
  const spent = challenge === null ? 'unknown' : deps.challenges.consume(challenge, binding);
  const device = deps.devices?.get(deviceId);
  const cfg = deps.config();
  if (!device || !cfg) throw new Refusal('forbidden');
  if (spent === 'expired') throw new Refusal('assertion_expired');
  if (spent !== 'ok') throw new Refusal('assertion_invalid');
  let newCounter: number;
  try { ({ newCounter } = await verifyAssertion(cfg, device.credential, msg.assertion, challenge!)); }
  catch (e) { throw new Refusal('assertion_invalid', `assertion not verified: ${(e as Error).message}`); }
  await deps.devices!.setCounter(deviceId, newCounter);
}

export async function runDecide(peer: Peer, msg: SessionDecide, deps: DecisionDeps): Promise<void> {
  const remote = peer.ctx.kind === 'remote';
  if ((remote && (msg.pendingId === undefined || !msg.operationId)) || namesRequestHalfway(msg)) {
    return peer.send({ type: 'error', id: msg.id, message: 'invalid' });
  }
  return operate(peer, msg, deps, async () => {
    if (msg.pendingId === undefined) {
      // A local client that does not name the request (D10): what it did before, word for word.
      const s = deps.store.get(msg.id);
      if (!s) throw new Refusal('stale', 'unknown session');
      if (s.source === 'hook_only') throw new Refusal('read_only', READ_ONLY);
      if (!s.pending) throw new Refusal('stale', 'nothing to decide');
      const pending = s.pending; const adapter = adapterFor(s.tool);
      return deps.inject(msg.id, pane => adapter.keysFor(msg.decision, pending, pane), true);
    }
    const { session, pending } = requestFor(deps.store, msg.id, msg.pendingId, msg.pendingVersion!);
    // Only a phone proves who it is; the overlay on this PC decides without WebAuthn. A missing risk counts as high.
    if (peer.ctx.kind === 'remote' && msg.decision === 'accept' && pending.risk !== 'low') {
      await checkAssertion(peer.ctx.deviceId, msg, session.id, pending, deps);
    }
    const adapter = adapterFor(session.tool);
    return deps.inject(msg.id, pane => { stillPaired(peer, deps); return adapter.keysFor(msg.decision, pending, pane); }, true, { id: pending.id, version: pending.version });
  });
}

export async function runAnswer(peer: Peer, msg: SessionReply, deps: DecisionDeps): Promise<void> {
  const remote = peer.ctx.kind === 'remote';
  if ((remote && !msg.operationId) || namesRequestHalfway(msg)) return peer.send({ type: 'error', id: msg.id, message: 'invalid' });
  return operate(peer, msg, deps, async () => {
    if (msg.pendingId === undefined) {
      // Free text to the input line from a phone comes with lot 3.
      if (remote) throw new Refusal('forbidden');
      return legacyReply(msg, deps);
    }
    const { session, pending } = requestFor(deps.store, msg.id, msg.pendingId, msg.pendingVersion!);
    if (remote) {
      // A phone picks one of the options it was shown; free text arrives with lot 5.
      const n = /^[1-9]$/.test(msg.text) ? Number(msg.text) : 0;
      if (pending.kind !== 'question' || n === 0 || n > (pending.options?.length ?? 0)) throw new Refusal('unsupported');
      // Questions are classified low today and carry no assertion: should that change, a phone must not slip through.
      if (pending.risk !== 'low') throw new Refusal('forbidden');
    } else {
      if (pending.kind !== 'question') throw new Refusal('unsupported', `a ${pending.kind} prompt takes accept or deny, not a reply`);
      if (!/^[1-9]$/.test(msg.text.trim())) throw new Refusal('unsupported', FREE_TEXT);
    }
    const adapter = adapterFor(session.tool);
    return deps.inject(msg.id, pane => { stillPaired(peer, deps); return adapter.replyPlan(msg.text, pending, pane || undefined); }, true, { id: pending.id, version: pending.version });
  });
}

/** A local reply that does not name a request: what it did before (D10). */
function legacyReply(msg: SessionReply, deps: DecisionDeps): Promise<void> {
  const s = deps.store.get(msg.id);
  if (!s) throw new Refusal('stale', 'unknown session');
  if (s.source === 'hook_only') throw new Refusal('read_only', READ_ONLY);
  // A select dialog ignores typed text and Enter would pick option 1: those take decide only.
  if (s.pending && s.pending.kind !== 'question') throw new Refusal('unsupported', `a ${s.pending.kind} prompt takes accept or deny, not a reply`);
  if (msg.text.trim() === '') throw new Refusal('invalid', 'empty reply');
  // The 2.x question dialog is a select: typed text then Enter would silently pick the highlighted option.
  if (s.pending?.kind === 'question' && !/^[1-9]$/.test(msg.text.trim())) throw new Refusal('unsupported', FREE_TEXT);
  // With no pending (idle, your turn) the text goes to the input line: no prompt to check for.
  const pending = s.pending; const adapter = adapterFor(s.tool);
  return deps.inject(msg.id, pane => adapter.replyPlan(msg.text, pending, pane || undefined), !!pending);
}

/**
 * A phone asks for the challenge of a high-risk accept. Every refusal is an `error { id, message: OperationReason }` to
 * the asker only; the challenge is bound to the request actually waiting and to the asking device.
 */
export async function prepareDecide(peer: Peer, msg: DecidePrepare, deps: DecisionDeps): Promise<void> {
  const refuse = (reason: OperationReason) => peer.send({ type: 'error', id: msg.id, message: reason });
  if (peer.ctx.kind !== 'remote') return refuse('forbidden');
  let found: ReturnType<typeof requestFor>;
  try { found = requestFor(deps.store, msg.id, msg.pendingId, msg.pendingVersion); }
  catch (e) { if (e instanceof Refusal) return refuse(e.reason); throw e; }
  const { session, pending } = found;
  if (pending.risk === 'low') return refuse('invalid');
  let issued: { challenge: string; expiresAt: string; options: unknown };
  try {
    const device = deps.devices?.get(peer.ctx.deviceId);
    const cfg = deps.config();
    if (!device?.credential || !cfg) return refuse('forbidden');
    const { challenge, expiresAt } = deps.challenges.issue({ deviceId: device.id, sessionId: session.id, pendingId: pending.id, pendingVersion: pending.version, decision: 'accept' });
    issued = { challenge, expiresAt, options: await assertionOptions(cfg, device.credential, challenge) };
  } catch (e) {
    // Never leak exception text to a phone.
    log(`decide.prepare ${msg.id} failed: ${(e as Error).message}`);
    return refuse('forbidden');
  }
  const { expiresAt, options } = issued;
  peer.send({ type: 'decide.challenge', id: msg.id, pendingId: pending.id, pendingVersion: pending.version, decision: 'accept', options: options as unknown as Record<string, unknown>, expiresAt });
}

/** Where an operation of this peer ended up; `unknown` after a restart, for another device's operation, or for an id never seen. */
export function operationStatus(peer: Peer, msg: OperationStatusMsg, deps: DecisionDeps): void {
  const r = deps.ops.get(msg.operationId, ownerOf(peer));
  peer.send(r ? resultOf(r) : { type: 'operation.result', operationId: msg.operationId, status: 'unknown' });
}
