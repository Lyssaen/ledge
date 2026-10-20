// The phone gateway: texts from approved devices are read against the whitelist, reads are answered here, writes go
// through the operation registry and then the local fronts' own `dispatch`. What the daemon broadcasts is projected for
// the devices that follow it. Logs carry a type, a code or an error's name, never a message's content.
import {
  PHONE_PROTOCOL, PhoneClientMessageSchema, RefusalCodeSchema, UNTYPABLE, pendingKey,
  type ClientMessage, type OperationReason, type OperationStatus, type PhoneClientMessage, type PhoneServerMessage, type ServerMessage, type Session, type ThreadItem
} from '@ledge/protocol';
import type { MobileService } from './service.js';
import { createOutbox } from './outbox.js';
import { fingerprint, OperationRegistry, type PhoneOperation } from './operations.js';
import { capabilities, toPhoneItem, toPhoneSession, toPhoneThread } from './project.js';
import { riskOf } from './risk.js';

export interface PhoneGateway {
  /** Passes a message the daemon broadcast to the local fronts on to the devices concerned; anything else is ignored. */
  forward(m: ServerMessage): void;
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
}

type Outcome = { status: Extract<OperationStatus, 'applied' | 'rejected' | 'failed'>; reason?: OperationReason };

/** The plain shape of a message type: only such a name is logged or echoed back. */
const REQUEST_NAME = /^[a-z][a-z.]{0,39}$/;

export function createPhoneGateway(deps: {
  mobile: Pick<MobileService, 'send' | 'onMessage' | 'state' | 'onChange'>;
  sessions: () => Session[];
  session: (id: string) => Session | undefined;
  thread: (id: string) => ThreadItem[] | undefined;
  preview: (id: string) => string[] | undefined;
  dispatch: (msg: ClientMessage, reply: (m: ServerMessage) => void) => Promise<void>;
  version: string;
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
    if (!f) followers.set(deviceId, f = { subscribed: false, watching: null, reads: new Map() });
    return f;
  };
  const forget = (deviceId: string) => {
    followers.delete(deviceId);
    outbox.drop(deviceId);
  };
  const approved = (deviceId: string) => mobile.state().devices.some(d => d.id === deviceId);

  const projected = (deviceId: string, s: Session) => toPhoneSession(s, followers.get(deviceId)?.reads.get(s.id) ?? startedAt);
  const snapshot = (deviceId: string): PhoneServerMessage => ({
    type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: deps.sessions().map(s => projected(deviceId, s)), capabilities: capabilities(), daemon: { version: deps.version }
  });

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

  /** The checks only a phone meets, in order; undefined lets the operation through. */
  const precheck = (msg: PhoneOperation): Outcome | undefined => {
    const s = deps.session(msg.id);
    if (!s) return { status: 'rejected', reason: 'unknown_session' };
    switch (msg.type) {
      case 'session.decide':
        if (!s.pending || pendingKey(s.pending) !== msg.expect.key) return { status: 'rejected', reason: 'stale' };
        // Until a device check exists (lot 6), a high request is only refused from the phone.
        if (msg.decision !== 'deny' && riskOf(s)?.risk !== 'low') return { status: 'rejected', reason: 'confirm_required' };
        // The note is typed into the terminal like a reply.
        return msg.note !== undefined && UNTYPABLE.test(msg.note) ? { status: 'rejected', reason: 'untypable' } : undefined;
      case 'session.reply':
        return UNTYPABLE.test(msg.text) ? { status: 'rejected', reason: 'untypable' } : undefined;
      case 'session.interrupt':
        // The local handler returns silently there: the phone would read a no-op as applied.
        return s.tmuxSession ? undefined : { status: 'rejected', reason: 'read_only' };
    }
  };

  /** The local message the operation stands for, built field by field. */
  const local = (msg: PhoneOperation): ClientMessage => {
    switch (msg.type) {
      case 'session.decide':
        return { type: 'session.decide', id: msg.id, decision: msg.decision, ...(msg.note !== undefined ? { note: msg.note } : {}), expect: { kind: msg.expect.kind, text: msg.expect.text, key: msg.expect.key } };
      case 'session.reply': return { type: 'session.reply', id: msg.id, text: msg.text };
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

  const run = async (msg: PhoneOperation): Promise<Outcome> => {
    const refused = precheck(msg);
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
      outcome = await run(msg);
    }
    catch (e) {
      log(`phone ${msg.type} failed (${e instanceof Error ? e.name : 'error'})`);
      outcome = { status: 'failed' };
    }
    registry.finish(msg.op, outcome.status, outcome.reason);
    result(deviceId, msg.op, outcome.status, outcome.reason);
  };

  const read = (deviceId: string, msg: Exclude<PhoneClientMessage, PhoneOperation>) => {
    switch (msg.type) {
      case 'snapshot.request':
        follower(deviceId).subscribed = true;
        return push(deviceId, snapshot(deviceId), 'snapshot');
      case 'session.thread': {
        if (!deps.session(msg.id)) return push(deviceId, { type: 'error', code: 'unknown_session', request: msg.type });
        return push(deviceId, { type: 'session.thread', id: msg.id, ...toPhoneThread(deps.thread(msg.id) ?? []) });
      }
      case 'session.watch': {
        if (msg.id === null) { follower(deviceId).watching = null; return; }
        if (!deps.session(msg.id)) return push(deviceId, { type: 'error', code: 'unknown_session', request: msg.type });
        follower(deviceId).watching = msg.id;
        const lines = deps.preview(msg.id);
        if (lines) push(deviceId, { type: 'session.preview', id: msg.id, lines: [...lines] }, `session.preview:${msg.id}`);
        return;
      }
      case 'session.read': {
        const s = deps.session(msg.id);
        if (!s) return push(deviceId, { type: 'error', code: 'unknown_session', request: msg.type });
        // Normalised, so marks of mixed fractional precision compare as strings.
        const at = new Date(msg.at).toISOString();
        const reads = follower(deviceId).reads;
        if (at > (reads.get(msg.id) ?? '')) reads.set(msg.id, at);
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

  /** A device no longer approved is forgotten, with all it followed. */
  const pruneRevoked = () => {
    if (followers.size === 0) return;
    const ids = new Set(mobile.state().devices.map(d => d.id));
    for (const deviceId of [...followers.keys()]) if (!ids.has(deviceId)) forget(deviceId);
  };

  const unsubscribeMessage = mobile.onMessage(receive);
  const unsubscribeChange = mobile.onChange(pruneRevoked);

  return {
    forward(m) {
      if (stopped || followers.size === 0) return;
      try {
        switch (m.type) {
          case 'session.updated':
            for (const [deviceId, f] of followers) {
              if (f.subscribed) push(deviceId, { type: 'session.updated', session: projected(deviceId, m.session) }, `session.updated:${m.session.id}`);
            }
            return;
          case 'session.removed':
            for (const [deviceId, f] of followers) {
              f.reads.delete(m.id);
              if (f.watching === m.id) f.watching = null;
              if (f.subscribed) push(deviceId, { type: 'session.removed', id: m.id });
            }
            return;
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
