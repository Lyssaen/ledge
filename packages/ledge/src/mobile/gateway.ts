// The phone gateway: texts from approved devices are read against the whitelist, reads are answered here, writes go
// through the operation registry and then the local fronts' own `dispatch`. What the daemon broadcasts is projected for
// the devices that follow it. Logs carry a type, a code or an error's name, never a message's content.
import { hostname } from 'node:os';
import {
  OperationIdSchema, PHONE_PROTOCOL, PhoneClientMessageSchema, pushEndpointAllowed, RefusalCodeSchema, UNTYPABLE, backendOf, isArchived, pendingKey,
  type ClientMessage, type OperationReason, type OperationStatus, type PhoneClientMessage, type PhoneServerMessage, type ServerMessage, type Session, type ThreadItem
} from '@ledge/protocol';
import type { MobileService } from './service.js';
import { createOutbox } from './outbox.js';
import { fingerprint, OperationRegistry, type PhoneOperation } from './operations.js';
import { capabilities, clip, toPhoneFullRequest, toPhoneItem, toPhoneSession, toPhoneThread } from './project.js';
import { riskOf } from './risk.js';
import { CHALLENGE_TTL_MS, type ChallengeStore } from './challenges.js';
import { challengeOf, verifyAssertion, verifyRegistration, type DeviceCredential, type Rp } from './webauthn.js';

export interface PhoneGateway {
  /** Passes a message the daemon broadcast to the local fronts on to the devices concerned; anything else is ignored. */
  forward(m: ServerMessage): void;
  /** Whether the device's app is in front right now (it said so, and its channel is still up). */
  visible(deviceId: string): boolean;
  stop(): void;
}

/** What one device follows; forgotten whole when the device goes. */
interface Follower {
  /** Asked for a snapshot: gets every session's update and removal. */
  subscribed: boolean;
  /** The session whose terminal and thread it shows. */
  watching: string | null;
  /** Per session, the newest moment it read up to (ISO, normalised). */
  reads: Map<string, string>;
  /** The phone's app is in front: it gets no push. Cleared when its channel falls. */
  visible: boolean;
  /** What the last snapshot sent said of push, to see when a change deserves a new one. */
  pushStatus?: PushStatus;
}

type PushStatus = 'on' | 'off' | 'stale' | 'unavailable';

type Outcome = { status: Extract<OperationStatus, 'applied' | 'rejected' | 'failed'>; reason?: OperationReason };

/** The plain shape of a message type: only such a name is logged or echoed back. */
/** How long a signing-out device's answer may wait in the queue before its revoke goes ahead anyway. */
const FLUSH_BEFORE_REVOKE_MS = 5_000;

const REQUEST_NAME = /^[a-z][a-z.]{0,39}$/;

export function createPhoneGateway(deps: {
  mobile: Pick<MobileService, 'send' | 'onMessage' | 'state' | 'onChange' | 'revoke' | 'pushOf' | 'setPush' | 'relayPushKey'>;
  /** The relying party of the current relay; none when it is not served over https or from localhost. */
  rp: () => Rp | null;
  challenges: ChallengeStore;
  credential: (deviceId: string) => DeviceCredential | null;
  setCredential: (deviceId: string, c: DeviceCredential) => void;
  sessions: () => Session[];
  session: (id: string) => Session | undefined;
  thread: (id: string) => ThreadItem[] | undefined;
  preview: (id: string) => string[] | undefined;
  dispatch: (msg: ClientMessage, reply: (m: ServerMessage) => void) => Promise<void>;
  version: string;
  /** Fresh for each daemon start: the phone tells a restarted PC (empty registry) from the same one. */
  boot: string;
  log: (line: string) => void;
  now?: () => string;
  outbox?: { now?: () => number; frames?: number; bytes?: number; windowMs?: number };
}): PhoneGateway {
  const { mobile, log } = deps;
  /** The read mark of a session no device marked: what was replied before the gateway started counts as read. */
  const startedAt = new Date(deps.now ? deps.now() : Date.now()).toISOString();
  const registry = new OperationRegistry();
  const followers = new Map<string, Follower>();
  let stopped = false;

  const follower = (deviceId: string): Follower => {
    let f = followers.get(deviceId);
    if (!f) followers.set(deviceId, f = { subscribed: false, watching: null, reads: new Map(), visible: false });
    return f;
  };
  const forget = (deviceId: string) => {
    followers.delete(deviceId);
    outbox.drop(deviceId);
  };
  const approved = (deviceId: string) => mobile.state().devices.some(d => d.id === deviceId);

  /** A session the phone may see: an archived one is, for the phone, gone. */
  const live = (id: string): Session | undefined => {
    const s = deps.session(id);
    return s && !isArchived(s) ? s : undefined;
  };
  const projected = (deviceId: string, s: Session) => toPhoneSession(s, followers.get(deviceId)?.reads.get(s.id) ?? startedAt);
  const pushStatus = (deviceId: string): PushStatus => {
    const key = mobile.relayPushKey();
    if (key === null) return 'unavailable';
    const p = mobile.pushOf(deviceId);
    if (!p) return 'off';
    return key !== undefined && p.key !== key ? 'stale' : 'on';
  };
  const snapshot = (deviceId: string): PhoneServerMessage => {
    const push = pushStatus(deviceId);
    const f = followers.get(deviceId);
    if (f) f.pushStatus = push;
    return {
    type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: deps.sessions().filter(s => !isArchived(s)).map(s => projected(deviceId, s)), capabilities: capabilities(), daemon: { version: deps.version, boot: deps.boot, name: clip(hostname(), 40).text },
    device: { confirm: deps.credential(deviceId) !== null, push }
    };
  };

  const outbox = createOutbox({
    send: (deviceId, text) => mobile.send(deviceId, text),
    onGone: deviceId => {
      log(`phone: device ${deviceId} gone`);
      followers.delete(deviceId);
    },
    onOverflow: deviceId => {
      if (followers.get(deviceId)?.subscribed) outbox.push(deviceId, snapshot(deviceId), 'snapshot');
    },
    log,
    ...deps.outbox
  });

  const push = (deviceId: string, msg: PhoneServerMessage, key?: string) => { if (!stopped) outbox.push(deviceId, msg, key); };
  const result = (deviceId: string, op: string, status: OperationStatus, reason?: OperationReason) => {
    // A device revoked while its operation ran hears nothing more.
    if (stopped || !approved(deviceId)) return;
    push(deviceId, { type: 'operation.result', op, status, ...(reason ? { reason } : {}) });
  };

  /** Whether the operation needs the device's own check: an accept of a request that is not low, or a reply to an OMP (rpc) dialog, which is never low. */
  /** The operations that act on a tracked session (the chat ones are the gateway's own, Task 5). */
  type SessionOperation = Exclude<PhoneOperation, { type: 'credential.register' | 'device.forget' | 'push.subscribe' | 'push.unsubscribe' | 'chat.relay' | 'chat.launch' }>;
  const needsAssertion = (msg: SessionOperation, s: Session): boolean => {
    if (msg.type === 'session.decide') return msg.decision !== 'deny' && riskOf(s)?.risk !== 'low';
    if (msg.type === 'session.reply') return !!msg.expect && s.pending?.source === 'rpc' && riskOf(s)?.risk !== 'low';
    return false;
  };

  /** What a challenge is bound to: the session and the request, and for an OMP dialog the dialog itself (its requestId), since two dialogs can read the same. */
  const subjectOf = (id: string, key: string, s: Session | undefined): string =>
    `${id}:${key}${s?.pending?.source === 'rpc' && s.pending.requestId ? `:${s.pending.requestId}` : ''}`;

  /** The device check of a decision: its challenge is spent first, whatever the verdict, and the counter is kept once it verifies. */
  const assertionOutcome = (deviceId: string, msg: Extract<PhoneOperation, { type: 'session.decide' | 'session.reply' }>, s: Session): Outcome | undefined => {
    const cred = deps.credential(deviceId);
    const rp = deps.rp();
    const key = msg.expect?.key;
    if (!cred || !rp || !msg.assertion || key === undefined) return { status: 'rejected', reason: 'confirm_required' };
    const invalid: Outcome = { status: 'rejected', reason: 'assertion_invalid' };
    const challenge = challengeOf(msg.assertion.clientDataJSON);
    if (challenge === null) return invalid;
    const verdict = deps.challenges.consume(challenge, { deviceId, purpose: 'decide', subject: subjectOf(msg.id, key, s) });
    if (verdict === 'expired') return { status: 'rejected', reason: 'assertion_expired' };
    if (verdict !== 'ok') return invalid;
    const verified = verifyAssertion(msg.assertion, cred, rp, challenge);
    if (!verified.ok) {
      log(`phone: assertion refused for device ${deviceId}`);
      return invalid;
    }
    deps.setCredential(deviceId, { ...cred, counter: verified.counter });
    return undefined;
  };

  /** The checks only a phone meets, in order; undefined lets the operation through. */
  const precheck = (deviceId: string, msg: SessionOperation): Outcome | undefined => {
    const s = live(msg.id);
    if (!s) return { status: 'rejected', reason: 'unknown_session' };
    switch (msg.type) {
      case 'session.decide':
        if (!s.pending || pendingKey(s.pending) !== msg.expect.key) return { status: 'rejected', reason: 'stale' };
        // OMP's dialogs are answered with `session.answer`; refused before any challenge is spent.
        if (backendOf(s) === 'omp-rpc') return { status: 'rejected', reason: 'not_offered' };
        // An assertion no check will bind means the request is not the one the phone confirmed: refused, its challenge untouched.
        if (msg.assertion && !needsAssertion(msg, s)) return { status: 'rejected', reason: 'stale' };
        if (needsAssertion(msg, s)) { const refused = assertionOutcome(deviceId, msg, s); if (refused) return refused; }
        // The note is typed into the terminal like a reply.
        return msg.note !== undefined && UNTYPABLE.test(msg.note) ? { status: 'rejected', reason: 'untypable' } : undefined;
      case 'session.reply': {
        // The reply is meant for the request the phone showed (or for none): a newer one would read it as its answer.
        if (msg.expect ? !s.pending || pendingKey(s.pending) !== msg.expect.key : !!s.pending) return { status: 'rejected', reason: 'stale' };
        const options = s.pending?.kind === 'question' ? s.pending.options : undefined;
        if (options?.length && /^[1-9]$/.test(msg.text) && Number(msg.text) > options.length) return { status: 'rejected', reason: 'invalid' };
        if (msg.assertion && !needsAssertion(msg, s)) return { status: 'rejected', reason: 'stale' };
        if (needsAssertion(msg, s)) { const refused = assertionOutcome(deviceId, msg, s); if (refused) return refused; }
        return UNTYPABLE.test(msg.text) ? { status: 'rejected', reason: 'untypable' } : undefined;
      }
      case 'session.answer':
        if (!s.pending || pendingKey(s.pending) !== msg.expect.key) return { status: 'rejected', reason: 'stale' };
        if (backendOf(s) !== 'omp-rpc') return { status: 'rejected', reason: 'not_offered' };
        return s.pending.requestId === msg.requestId ? undefined : { status: 'rejected', reason: 'stale' };
      case 'session.interrupt':
        // The local handler returns silently without a terminal: the phone would read a no-op as applied. OMP stops over its RPC.
        return s.tmuxSession || backendOf(s) === 'omp-rpc' ? undefined : { status: 'rejected', reason: 'read_only' };
    }
  };

  /** The local message the operation stands for, built field by field. */
  const local = (msg: SessionOperation): ClientMessage => {
    switch (msg.type) {
      case 'session.decide':
        return { type: 'session.decide', id: msg.id, decision: msg.decision, ...(msg.note !== undefined ? { note: msg.note } : {}), expect: { kind: msg.expect.kind, text: msg.expect.text, key: msg.expect.key } };
      case 'session.reply': return { type: 'session.reply', id: msg.id, text: msg.text };
      case 'session.answer': return { type: 'session.answer', id: msg.id, requestId: msg.requestId, answers: msg.answers, ...(msg.cancel ? { cancel: true } : {}) };
      case 'session.interrupt': return { type: 'session.interrupt', id: msg.id };
    }
  };

  /** An `error` for the request: its code says why it was refused; none is a failure of the machinery (tmux…). */
  const outcomeOf = (code: string | undefined): Outcome => {
    if (!code) return { status: 'failed' };
    if (code === 'not_taken') return { status: 'failed', reason: 'not_taken' };
    const known = RefusalCodeSchema.safeParse(code);
    return { status: 'rejected', reason: known.success ? known.data : 'invalid' };
  };

  /** The device's passkey, checked over the challenge `confirm.prepare` gave it. The challenge is spent whatever the verdict. */
  const register = (deviceId: string, msg: Extract<PhoneOperation, { type: 'credential.register' }>): Outcome => {
    const challenge = challengeOf(msg.credential.clientDataJSON);
    const rp = deps.rp();
    const invalid: Outcome = { status: 'rejected', reason: 'assertion_invalid' };
    if (challenge === null) return invalid;
    const verdict = deps.challenges.consume(challenge, { deviceId, purpose: 'register', subject: '' });
    if (verdict === 'expired') return { status: 'rejected', reason: 'assertion_expired' };
    if (verdict !== 'ok' || !rp) return invalid;
    const verified = verifyRegistration(msg.credential, rp, challenge);
    if (!verified.ok) return invalid;
    deps.setCredential(deviceId, verified.credential);
    return { status: 'applied' };
  };

  const run = async (deviceId: string, msg: PhoneOperation): Promise<Outcome> => {
    if (msg.type === 'credential.register') return register(deviceId, msg);
    // Applied here; the device is revoked by `write`, once the answer has left.
    if (msg.type === 'device.forget') return { status: 'applied' };
    if (msg.type === 'push.subscribe') {
      // Already refused by the schema; checked again here because the PC is the one that will send to it.
      if (!pushEndpointAllowed(msg.subscription.endpoint)) return { status: 'rejected', reason: 'invalid' };
      mobile.setPush(deviceId, { endpoint: msg.subscription.endpoint, p256dh: msg.subscription.keys.p256dh, auth: msg.subscription.keys.auth, key: msg.key });
      return { status: 'applied' };
    }
    if (msg.type === 'push.unsubscribe') {
      mobile.setPush(deviceId, null);
      return { status: 'applied' };
    }
    // The phone's chat is not served yet: refused rather than read as a session operation.
    if (msg.type === 'chat.relay' || msg.type === 'chat.launch') return { status: 'rejected', reason: 'invalid' };
    const refused = precheck(deviceId, msg);
    if (refused) return refused;
    const out = local(msg);
    let error: { code?: string } | undefined;
    await deps.dispatch(out, m => {
      if (m.type === 'error' && (m.request === undefined || m.request === out.type)) error ??= { code: m.code };
    });
    return error ? outcomeOf(error.code) : { status: 'applied' };
  };

  const write = async (deviceId: string, msg: PhoneOperation) => {
    const begun = registry.begin(deviceId, msg.op, fingerprint(msg));
    if (begun.kind === 'conflict') return result(deviceId, msg.op, 'rejected', 'conflict');
    if (begun.kind === 'replay') return result(deviceId, msg.op, begun.record.status, begun.record.reason);
    let outcome: Outcome;
    try {
      result(deviceId, msg.op, 'received');
      outcome = await run(deviceId, msg);
    }
    catch (e) {
      log(`phone ${msg.type} failed (${e instanceof Error ? e.name : 'error'})`);
      outcome = { status: 'failed' };
    }
    registry.finish(msg.op, outcome.status, outcome.reason);
    result(deviceId, msg.op, outcome.status, outcome.reason);
    // The phone learns it can confirm from the snapshot that follows.
    if (msg.type === 'credential.register' && outcome.status === 'applied' && approved(deviceId)) push(deviceId, snapshot(deviceId), 'snapshot');
    if (msg.type === 'device.forget' && outcome.status === 'applied') {
      // Revoking closes the channel and drops what is queued: the answer must be on its way first (bounded: a slow relay must not hold the revoke).
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([outbox.flush(deviceId), new Promise<void>(r => { timer = setTimeout(r, FLUSH_BEFORE_REVOKE_MS); })]);
      clearTimeout(timer);
      if (!stopped) await mobile.revoke(deviceId);
    }
  };

  const read = (deviceId: string, msg: Exclude<PhoneClientMessage, PhoneOperation>) => {
    switch (msg.type) {
      case 'presence':
        follower(deviceId).visible = msg.visible;
        return;
      case 'snapshot.request':
        follower(deviceId).subscribed = true;
        return push(deviceId, snapshot(deviceId), 'snapshot');
      case 'session.thread': {
        if (!live(msg.id)) return push(deviceId, { type: 'error', code: 'unknown_session', request: msg.type });
        return push(deviceId, { type: 'session.thread', id: msg.id, ...toPhoneThread(deps.thread(msg.id) ?? []) });
      }
      case 'session.pending': {
        const session = live(msg.id);
        const pending = session && toPhoneFullRequest(session);
        if (!pending) return push(deviceId, { type: 'error', code: 'unknown_session', request: msg.type });
        return push(deviceId, { type: 'session.pending', id: msg.id, pending });
      }
      case 'session.watch': {
        if (msg.id === null) { follower(deviceId).watching = null; return; }
        if (!live(msg.id)) return push(deviceId, { type: 'error', code: 'unknown_session', request: msg.type });
        follower(deviceId).watching = msg.id;
        const lines = deps.preview(msg.id);
        if (lines) push(deviceId, { type: 'session.preview', id: msg.id, lines: [...lines] }, `session.preview:${msg.id}`);
        return;
      }
      case 'confirm.prepare': {
        const rp = deps.rp();
        const invalid = () => push(deviceId, { type: 'error', code: 'invalid', request: msg.type });
        if (!rp) return invalid();
        if (msg.purpose === 'decide') {
          if (!msg.id || !msg.expect) return invalid();
          if (!live(msg.id)) return push(deviceId, { type: 'error', code: 'unknown_session', request: msg.type });
          const cred = deps.credential(deviceId);
          if (!cred || cred.rpId !== rp.rpId) return invalid();
          const challenge = deps.challenges.issue({ deviceId, purpose: 'decide', subject: subjectOf(msg.id, msg.expect.key, live(msg.id)) });
          return push(deviceId, { type: 'confirm.challenge', purpose: 'decide', challenge, rpId: rp.rpId, credentialId: cred.id, expiresInMs: CHALLENGE_TTL_MS });
        }
        const challenge = deps.challenges.issue({ deviceId, purpose: 'register', subject: '' });
        return push(deviceId, { type: 'confirm.challenge', purpose: 'register', challenge, rpId: rp.rpId, expiresInMs: CHALLENGE_TTL_MS });
      }
      case 'session.read': {
        const s = live(msg.id);
        if (!s) return push(deviceId, { type: 'error', code: 'unknown_session', request: msg.type });
        // Normalised, so marks of mixed fractional precision compare as strings.
        const at = new Date(msg.at).toISOString();
        const f = follower(deviceId);
        if (at > (f.reads.get(msg.id) ?? '')) f.reads.set(msg.id, at);
        // Only a device that follows the sessions hears of them.
        if (!f.subscribed) return;
        return push(deviceId, { type: 'session.updated', session: projected(deviceId, s) }, `session.updated:${s.id}`);
      }
    }
  };

  const receive = (deviceId: string, text: string) => {
    if (stopped) return;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { raw = undefined; }
    const parsed = raw === undefined ? undefined : PhoneClientMessageSchema.safeParse(raw);
    if (!parsed?.success) {
      const type = (raw as { type?: unknown } | null | undefined)?.type;
      const request = typeof type === 'string' && REQUEST_NAME.test(type) ? type : undefined;
      log(`phone message refused: ${request ?? '?'}`);
      // A subscription to an endpoint off the list is an operation the phone waits an answer for.
      const op = OperationIdSchema.safeParse((raw as { op?: unknown } | null | undefined)?.op);
      if (request === 'push.subscribe' && op.success && approved(deviceId)) return push(deviceId, { type: 'operation.result', op: op.data, status: 'rejected', reason: 'invalid' });
      return push(deviceId, { type: 'error', code: 'invalid', ...(request !== undefined ? { request } : {}) });
    }
    const msg = parsed.data;
    if ('op' in msg) {
      void write(deviceId, msg).catch((e: unknown) => log(`phone ${msg.type} failed (${e instanceof Error ? e.name : 'error'})`));
      return;
    }
    try { read(deviceId, msg); }
    catch (e) { log(`phone ${msg.type} failed (${e instanceof Error ? e.name : 'error'})`); }
  };

  /** A device no longer approved is forgotten, with all it followed; one whose channel fell is no longer in front; one whose push status changed hears of it. */
  const pruneRevoked = () => {
    if (followers.size === 0) return;
    const devices = new Map(mobile.state().devices.map(d => [d.id, d]));
    for (const [deviceId, f] of [...followers]) {
      const d = devices.get(deviceId);
      if (!d) { forget(deviceId); continue; }
      if (!d.online) f.visible = false;
      if (f.subscribed && f.pushStatus !== undefined && f.pushStatus !== pushStatus(deviceId)) push(deviceId, snapshot(deviceId), 'snapshot');
    }
  };

  /** A session gone for the phone (removed or archived): its read mark and watch go with it. */
  const removed = (id: string) => {
    for (const [deviceId, f] of followers) {
      f.reads.delete(id);
      if (f.watching === id) f.watching = null;
      if (f.subscribed) push(deviceId, { type: 'session.removed', id });
    }
  };

  const unsubscribeMessage = mobile.onMessage(receive);
  const unsubscribeChange = mobile.onChange(pruneRevoked);

  return {
    forward(m) {
      if (stopped || followers.size === 0) return;
      try {
        switch (m.type) {
          case 'session.updated':
            if (isArchived(m.session)) return removed(m.session.id);
            for (const [deviceId, f] of followers) {
              if (f.subscribed) push(deviceId, { type: 'session.updated', session: projected(deviceId, m.session) }, `session.updated:${m.session.id}`);
            }
            return;
          case 'session.removed':
            return removed(m.id);
          case 'session.preview':
            for (const [deviceId, f] of followers) {
              if (f.watching === m.id) push(deviceId, { type: 'session.preview', id: m.id, lines: [...m.lines] }, `session.preview:${m.id}`);
            }
            return;
          case 'session.thread.item': {
            const watchers = [...followers].filter(([, f]) => f.watching === m.id);
            if (watchers.length === 0) return;
            const { item, cut } = toPhoneItem(m.item);
            for (const [deviceId] of watchers) push(deviceId, { type: 'session.thread.item', id: m.id, item, ...(cut ? { cut: true as const } : {}) });
            return;
          }
          default:
            return;
        }
      } catch (e) {
        log(`phone forward of ${m.type} failed (${e instanceof Error ? e.name : 'error'})`);
      }
    },
    visible: deviceId => followers.get(deviceId)?.visible === true,
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribeMessage();
      unsubscribeChange();
      outbox.close();
      followers.clear();
    }
  };
}
