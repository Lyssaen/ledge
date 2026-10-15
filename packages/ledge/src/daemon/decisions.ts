import type { ClientMessage, OperationReason, Pending, ServerMessage, Session } from '@ledge/protocol';
import type { Note } from './history.js';
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
export type SessionInterrupt = Extract<ClientMessage, { type: 'session.interrupt' }>;

export const READ_ONLY = 'session started without ledge, read only';
export const NO_PROMPT = 'no prompt visible in the terminal, open the tab';
export const NOT_TAKEN = 'the terminal did not take it';
export const BUSY = 'a decision is already in progress';
export const FREE_TEXT = 'free-text answers are not supported yet, answer in the terminal';
/** The longest instruction a phone may type into an agent's input line. */
export const MESSAGE_MAX = 4_000;
/** The longest free answer (Other) a phone may type into a question. */
export const OTHER_MAX = 2_000;
/** A free answer is one line: no line break, and no control character that could drive the terminal (ESC, C0, C1). */
const UNTYPABLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** The free answer as it will be typed (trimmed), or null when it is empty, too long or not one plain line. */
function freeAnswer(text: string): string | null {
  const t = text.trim();
  return t === '' || t.length > OTHER_MAX || UNTYPABLE.test(text) ? null : t;
}

/** What decisions write to a session's shared thread (history.ts; server.ts dates the note). */
export interface Thread {
  record(id: string, note: Note): void;
  /** A phone's instruction is about to be typed: the next prompt with this text is the phone's. */
  expectPrompt(id: string, text: string): void;
  /** Nothing was typed after all. */
  dropPrompt(id: string): void;
}

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
  /**
   * `injectAndVerify`: takes the session lock, re-checks `expected` and builds the plan before the first character.
   * True once the terminal took it, false when a newer prompt arrived meanwhile and was left alone.
   */
  inject(id: string, planFor: (pane: string) => KeyPlan, requirePrompt: boolean, expected?: { id: string; version: number }): Promise<boolean>;
  /** Sends the agent's interrupt keys once. */
  interrupt(session: Session): Promise<void>;
  thread?: Thread;
}

/** Whose operations these are: a phone reads only its own (and conflicts with any other). */
const ownerOf = (peer: Peer) => peer.ctx.kind === 'remote' ? `device:${peer.ctx.deviceId}` : 'local';

/** Where a turn was decided: a remote peer is a phone, a local one is this PC (overlay, CLI). */
const sourceOf = (peer: Peer) => peer.ctx.kind === 'remote' ? 'phone' as const : 'pc' as const;

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
async function operate(peer: Peer, msg: SessionDecide | SessionReply | SessionInterrupt, deps: DecisionDeps, body: () => Promise<void>): Promise<void> {
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
      // Only a decision the terminal took lands in the thread: otherwise the last open permission may be the newer one.
      if (await deps.inject(msg.id, pane => adapter.keysFor(msg.decision, pending, pane), true)) recordDecision(peer, msg, pending, deps);
      return;
    }
    const { session, pending } = requestFor(deps.store, msg.id, msg.pendingId, msg.pendingVersion!);
    // Only a phone proves who it is; the overlay on this PC decides without WebAuthn. A missing risk counts as high.
    if (peer.ctx.kind === 'remote' && msg.decision === 'accept' && pending.risk !== 'low') {
      await checkAssertion(peer.ctx.deviceId, msg, session.id, pending, deps);
    }
    const adapter = adapterFor(session.tool);
    if (await deps.inject(msg.id, pane => { stillPaired(peer, deps); return adapter.keysFor(msg.decision, pending, pane); }, true, { id: pending.id, version: pending.version })) recordDecision(peer, msg, pending, deps);
  });
}

function recordDecision(peer: Peer, msg: SessionDecide, pending: Pending, deps: DecisionDeps): void {
  deps.thread?.record(msg.id, { note: 'decision', decision: msg.decision, source: sourceOf(peer), ...(pending.id ? { pendingId: pending.id } : {}) });
}

/** An option picked by its number is written to the thread by its label; a free answer as typed. */
function recordAnswer(peer: Peer, msg: SessionReply, pending: Pending, deps: DecisionDeps, typed?: string): void {
  const n = typed === undefined && /^[1-9]$/.test(msg.text.trim()) ? Number(msg.text.trim()) : 0;
  const text = typed ?? pending.options?.[n - 1] ?? msg.text;
  deps.thread?.record(msg.id, { note: 'answer', text, source: sourceOf(peer), ...(pending.id ? { pendingId: pending.id } : {}) });
}

export async function runAnswer(peer: Peer, msg: SessionReply, deps: DecisionDeps): Promise<void> {
  const remote = peer.ctx.kind === 'remote';
  // A free answer always names the question it answers.
  if ((remote && !msg.operationId) || namesRequestHalfway(msg) || (msg.other && msg.pendingId === undefined)) return peer.send({ type: 'error', id: msg.id, message: 'invalid' });
  // From a phone, text that names no request is an instruction to an idle agent.
  if (remote && msg.pendingId === undefined) return runMessage(peer, msg, deps);
  return operate(peer, msg, deps, async () => {
    if (msg.pendingId === undefined) return legacyReply(peer, msg, deps);
    const { session, pending } = requestFor(deps.store, msg.id, msg.pendingId, msg.pendingVersion!);
    if (msg.other) return otherAnswer(peer, msg, session, pending, deps);
    if (remote) {
      // Without `other`, a phone picks one of the options it was shown.
      const n = /^[1-9]$/.test(msg.text) ? Number(msg.text) : 0;
      if (pending.kind !== 'question' || n === 0 || n > (pending.options?.length ?? 0)) throw new Refusal('unsupported');
      // Questions are classified low today and carry no assertion: should that change, a phone must not slip through.
      if (pending.risk !== 'low') throw new Refusal('forbidden');
    } else {
      if (pending.kind !== 'question') throw new Refusal('unsupported', `a ${pending.kind} prompt takes accept or deny, not a reply`);
      if (!/^[1-9]$/.test(msg.text.trim()) && !adapterFor(session.tool).freeText) throw new Refusal('unsupported', FREE_TEXT);
    }
    const adapter = adapterFor(session.tool);
    if (await deps.inject(msg.id, pane => { stillPaired(peer, deps); return adapter.replyPlan(msg.text, pending, pane || undefined); }, true, { id: pending.id, version: pending.version })) recordAnswer(peer, msg, pending, deps);
  });
}

/**
 * A free answer (`other`) to the question named, from a phone or this PC: only for a tool that declares it
 * (`unsupported` otherwise), one plain line of text (`invalid` otherwise), and from a phone only on a low-risk question.
 * It goes through the same lock, identity check and verification as an option number; its text is never read as one.
 */
async function otherAnswer(peer: Peer, msg: SessionReply, session: Session, pending: Pending & { id: string; version: number }, deps: DecisionDeps): Promise<void> {
  const adapter = adapterFor(session.tool);
  const plan = adapter.otherPlan;
  if (pending.kind !== 'question' || !adapter.capabilities.freeTextAnswer || !plan) throw new Refusal('unsupported');
  const text = freeAnswer(msg.text);
  if (text === null) throw new Refusal('invalid');
  if (peer.ctx.kind === 'remote' && pending.risk !== 'low') throw new Refusal('forbidden');
  const build = (pane: string) => {
    stillPaired(peer, deps);
    // Raised before the first character: the dialog on screen has no free field.
    try { return plan(text, pending, pane); }
    catch (e) { throw new Refusal('unsupported', (e as Error).message); }
  };
  if (await deps.inject(msg.id, build, true, { id: pending.id, version: pending.version })) recordAnswer(peer, msg, pending, deps, text);
}

/** Free to take an instruction: idle, with nothing waiting on an answer. */
const takesInstruction = (s: Session | undefined) => s?.state === 'idle' && !s.pending;

/**
 * A phone's instruction (`session.reply` without a request): typed into the input line of an idle agent, once per
 * operation. A busy agent refuses it (`agent_busy`): nothing is typed and nothing is kept for later. Its prompt hook,
 * matched on the text within 30 s, makes the `prompt` turn the phone's.
 */
export async function runMessage(peer: Peer, msg: SessionReply, deps: DecisionDeps): Promise<void> {
  if (!msg.operationId) return peer.send({ type: 'error', id: msg.id, message: 'invalid' });
  return operate(peer, msg, deps, async () => {
    const s = deps.store.get(msg.id);
    if (!s) throw new Refusal('stale', 'unknown session');
    if (s.source === 'hook_only') throw new Refusal('read_only', READ_ONLY);
    if (msg.text.trim() === '' || msg.text.length > MESSAGE_MAX) throw new Refusal('invalid');
    if (!takesInstruction(s)) throw new Refusal('agent_busy');
    const adapter = adapterFor(s.tool);
    try {
      // Checked again under the lock, right before the first character.
      await deps.inject(msg.id, () => {
        stillPaired(peer, deps);
        if (!takesInstruction(deps.store.get(msg.id))) throw new Refusal('agent_busy');
        deps.thread?.expectPrompt(msg.id, msg.text);
        return adapter.replyPlan(msg.text, undefined, undefined);
      }, false);
    } catch (e) {
      // `not_taken`: the text may have reached the agent anyway, its prompt then stays the phone's.
      if (!(e instanceof Refusal && e.reason === 'not_taken')) deps.thread?.dropPrompt(msg.id);
      throw e;
    }
  });
}

/**
 * Interrupts the agent. From a phone it is an operation (D9): only a working agent is interrupted, and the keys go out
 * once per `operationId` (two Ctrl-C quit Cursor Agent). `applied` as soon as the keys are sent: their effect cannot
 * be checked. A local client without an operation does what it did before.
 */
export async function runInterrupt(peer: Peer, msg: SessionInterrupt, deps: DecisionDeps): Promise<void> {
  const remote = peer.ctx.kind === 'remote';
  if (remote && !msg.operationId) return peer.send({ type: 'error', id: msg.id, message: 'invalid' });
  const send = async (s: Session) => {
    await deps.interrupt(s);
    deps.thread?.record(s.id, { note: 'interrupt', source: sourceOf(peer) });
  };
  if (!msg.operationId) {
    const s = deps.store.get(msg.id);
    if (s?.source === 'hook_only') return peer.send({ type: 'error', id: msg.id, message: READ_ONLY });
    if (!s?.tmuxSession) return;
    return send(s);
  }
  return operate(peer, msg, deps, async () => {
    const s = deps.store.get(msg.id);
    if (!s) throw new Refusal('stale', 'unknown session');
    if (s.source === 'hook_only' || !s.tmuxSession) throw new Refusal('read_only', READ_ONLY);
    if (remote && s.state !== 'working') throw new Refusal('agent_busy');
    stillPaired(peer, deps);
    await send(s);
  });
}

/** A local reply that does not name a request: what it did before (D10). */
async function legacyReply(peer: Peer, msg: SessionReply, deps: DecisionDeps): Promise<void> {
  const s = deps.store.get(msg.id);
  if (!s) throw new Refusal('stale', 'unknown session');
  if (s.source === 'hook_only') throw new Refusal('read_only', READ_ONLY);
  // A select dialog ignores typed text and Enter would pick option 1: those take decide only.
  if (s.pending && s.pending.kind !== 'question') throw new Refusal('unsupported', `a ${s.pending.kind} prompt takes accept or deny, not a reply`);
  if (msg.text.trim() === '') throw new Refusal('invalid', 'empty reply');
  // A question dialog is a select: typed text then Enter would silently pick the highlighted option, unless the
  // adapter knows the dialog's own free-text field (as the server's replyTo, shared with the chat's relay).
  const pending = s.pending; const adapter = adapterFor(s.tool);
  if (pending?.kind === 'question' && !/^[1-9]$/.test(msg.text.trim()) && !adapter.freeText) throw new Refusal('unsupported', FREE_TEXT);
  // With no pending (idle, your turn) the text goes to the input line: no prompt to check for.
  const taken = await deps.inject(msg.id, pane => adapter.replyPlan(msg.text, pending, pane || undefined), !!pending);
  // Text typed into the input line comes back as the agent's prompt hook: only an answer is written here.
  if (pending && taken) recordAnswer(peer, msg, pending, deps);
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
