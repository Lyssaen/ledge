// The phone gateway: texts from approved devices are read against the whitelist, reads are answered here, writes go
// through the operation registry and then the local fronts' own `dispatch`. What the daemon broadcasts is projected for
// the devices that follow it. Logs carry a type, a code or an error's name, never a message's content.
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { slugOfGoal } from '@ledge/ui/launch/rigModel';
import { inspectRepos } from '../daemon/repos.js';
import { rigKey, toPhoneRig, toPhoneEscalation, toPhoneDecision, toPhoneExchange, toPhoneThreadItem, toPhonePlan, fromPhone } from './orchestrator.js';
import { rigSubject } from '@ledge/protocol';
import {
  ATTACHMENT_MAX, EXCHANGES_MAX, THREAD_PAGE, OperationIdSchema, PHONE_PROTOCOL, actionById, TOOL_TEXT_MAX, proposalRows, PhoneClientMessageSchema, pushEndpointAllowed, RefusalCodeSchema, UNTYPABLE, backendOf, isArchived, pendingKey,
  SEMVER, pcSubject, type AttachmentRef, type ChatErrorCode, type ChatTurn, type CloseHow, type ClientMessage, type OperationReason, type OperationStatus, type PhoneClientMessage, type PhoneServerMessage, type ServerMessage, type Session, type ThreadItem
} from '@ledge/protocol';
import { ModelRefusalSchema, type ModelRefusal, type Tool } from '@ledge/protocol';
import { latestTodos, TODO_TOOLS, type PhoneChecklist, type PhoneChecklistSummary } from '@ledge/protocol';
import type { ConfirmPurpose } from '@ledge/protocol';
import { compareVersions } from '@ledge/ui/semver';
import type { MobileService } from './service.js';
import type { ChatThreads, ChatThreadId } from '../chat/threads.js';
import { phoneCut, phoneEmitter, toPhoneHistory } from './chat.js';
import type { ChatMessage } from '../chat/service.js';
import { CloseRefused } from '../chat/close.js';
import { ActRefused } from '../chat/act.js';
import { AttachmentError, type AttachmentStore } from '../daemon/attachments.js';
import { createOutbox } from './outbox.js';
import { fingerprint, OperationRegistry, type Outcome, type PhoneOperation } from './operations.js';
import { capabilities, clip, toPhoneFullRequest, toPhoneItem, toPhoneSession, toPhoneThread } from './project.js';
import { canSwitch, toPhoneModels } from './project.js';
import { checklistSummary, toPhoneChecklist } from './project.js';
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

/** The plain shape of a message type: only such a name is logged or echoed back. */
/** How long a signing-out device's answer may wait in the queue before its revoke goes ahead anyway. */
const FLUSH_BEFORE_REVOKE_MS = 5_000;

const REQUEST_NAME = /^[a-z][a-z.]{0,39}$/;

/** How long a phone's `models.list` waits for the daemon's listing (whose agent probe gives up after 15 s) before it is told none came. */
const MODELS_WAIT_MS = 20_000;

export function createPhoneGateway(deps: {
  mobile: Pick<MobileService, 'send' | 'onMessage' | 'state' | 'onChange' | 'revoke' | 'pushOf' | 'setPush' | 'relayPushKey'>;
  /** Authoritative OpenRig view; absent until the daemon connects an orchestrator. */
  openrig?: {
    rigs(): import('@ledge/protocol').Rig[];
    escalations(): import('@ledge/protocol').Escalation[];
    escalation(id: string): import('@ledge/protocol').Escalation | undefined;
    rules(): import('@ledge/protocol').LedgeRule[];
    decisions(): import('@ledge/protocol').LedgeDecision[];
    projects(): import('@ledge/protocol').Projects;
    thread(before?: string): { items: import('@ledge/protocol').LedgeThreadItem[]; before?: string };
    exchanges(machine: string, rigId: string): import('@ledge/protocol').Exchange[] | null;
  };
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
  /** The images a device sends or asks for, by id. */
  attachments: Pick<AttachmentStore, 'put' | 'read' | 'ref'>;
  version: string;
  /** Fresh for each daemon start: the phone tells a restarted PC (empty registry) from the same one. */
  boot: string;
  log: (line: string) => void;
  now?: () => string;
  outbox?: { now?: () => number; frames?: number; bytes?: number; windowMs?: number };
  /** The chat threads: each device talks to its own. Without them the phone has no chat. */
  chats?: Pick<ChatThreads, 'device' | 'peek' | 'deviceTool' | 'owner' | 'drop' | 'setEmitter'>;
  /** The chat relay: hands a turn's instruction to its session. */
  relay?: { request(qid: string): Promise<void> };
  /** Starts the sessions of a turn's card, on that thread (its own emitter and refusals). */
  launchChat?: (thread: ChatThreadId, qid: string, rows?: number[]) => Promise<{ launched: string[]; failed: number }>;
  /** Closes the sessions of a turn's close card, on that thread (its own emitter and marks). */
  closeChat?: (thread: ChatThreadId, qid: string, rows?: number[]) => Promise<{ closed: Array<{ row: number; id: string; how: CloseHow }>; failed: Array<{ row: number; message: string }> }>;
  /** Applies the rows of a turn's generic card, on that thread (its own emitter and marks); `rid` names the request. */
  actChat?: (thread: ChatThreadId, qid: string, rid: string, rows?: number[], confirmed?: true, deny?: true) => Promise<{ done: number[]; failed: Array<{ row: number; message: string }> }>;
  /** A device's question ended (answered, or with a code). */
  onChatEnd?: (deviceId: string, end: { qid: string; code?: ChatErrorCode }) => void;
  chatThrottleMs?: number;
  /**
   * The daemon's own update and restart, for the phone only (spec 2026-10-28 mobile daemon update): never a `ClientMessage`.
   * Each runs on its own; its progress and refusals are broadcast, and `reply` gets a refusal meant for the asker alone (busy).
   */
  pc?: { canUpdate: boolean; canRestart: boolean; update: (version: string, reply: (m: ServerMessage) => void) => void; restart: (reply: (m: ServerMessage) => void) => void };
  /** The context threshold the user chose (context handover spec §3.2). */
  contextNear?: () => number;
  /** The daemon takes `session.model` with coded answers and lists an agent's models (#58): the phone offers the switch. */
  models?: true;
  /**
   * Ends a live session as the chat's close cards do (its exit command, a kill as a last resort), sharing a close already under
   * way. With it the phone offers « Fermer » and « Reprendre » on a session's page; it rejects with the daemon's refusal.
   */
  closeSession?: (id: string) => Promise<{ how: CloseHow }>;
}): PhoneGateway {
  const { mobile, log } = deps;
  /** The read mark of a session no device marked: what was replied before the gateway started counts as read. */
  const startedAt = new Date(deps.now ? deps.now() : Date.now()).toISOString();
  const registry = new OperationRegistry();
  const followers = new Map<string, Follower>();
  let stopped = false;
  /**
   * The last model change that failed once applied, by session (#58), with the model and effort it then ran: a phone that did not
   * follow when it failed (locked) hears it after its next snapshot. Gone with a new change accepted, a new model or effort, the session.
   */
  const modelFailures = new Map<string, { reason: ModelRefusal; model: string | undefined; effort: string | undefined }>();

  const follower = (deviceId: string): Follower => {
    let f = followers.get(deviceId);
    if (!f) followers.set(deviceId, f = { subscribed: false, watching: null, reads: new Map(), visible: false });
    return f;
  };
  const forget = (deviceId: string) => {
    followers.delete(deviceId);
    outbox.drop(deviceId);
    dropThread(deviceId);
  };
  /** The devices approved at the last look: one that leaves the list loses its thread, connected or not. */
  const known = new Set(mobile.state().devices.map(d => d.id));
  const emitters = new Map<string, (m: ChatMessage) => void>();
  /** Forgets the device's thread: its question is stopped and its folder removed. */
  const dropThread = (deviceId: string) => {
    emitters.delete(deviceId);
    if (!deps.chats) return;
    try { deps.chats.drop(deviceId).catch((e: unknown) => log(`phone chat drop failed (${e instanceof Error ? e.name : 'error'})`)); }
    catch (e) { log(`phone chat drop failed (${e instanceof Error ? e.name : 'error'})`); }
  };
  /** The device's emitter, made once and registered as its thread's; what it sends goes to that device only. */
  const emitterOf = (deviceId: string): (m: ChatMessage) => void => {
    let e = emitters.get(deviceId);
    if (!e) {
      const chats = deps.chats!;
      // A phone with no live channel gets nothing: its history on the next ready covers the gap, and the push (`onEnd`) does not pass here.
      const online = () => mobile.state().devices.some(d => d.id === deviceId && d.online);
      e = phoneEmitter((m, key) => { if (online()) push(deviceId, m, key); }, { history: () => chats.peek(deviceId)?.history() ?? [] }, {
        ...(deps.chatThrottleMs !== undefined ? { throttleMs: deps.chatThrottleMs } : {}),
        onEnd: end => deps.onChatEnd?.(deviceId, end)
      });
      emitters.set(deviceId, e);
      chats.setEmitter(`device:${deviceId}`, e);
    }
    return e;
  };
  const approved = (deviceId: string) => mobile.state().devices.some(d => d.id === deviceId);

  /** A session the phone may see: an archived one is, for the phone, gone. */
  const live = (id: string): Session | undefined => {
    const s = deps.session(id);
    return s && !isArchived(s) ? s : undefined;
  };
  /** Each session's checklist from its main thread, computed when first asked and kept while a device follows. */
  const checklists = new Map<string, { list: PhoneChecklist | null; summary: PhoneChecklistSummary | undefined }>();
  const computeChecklist = (id: string) => {
    const todos = latestTodos(deps.thread(id) ?? []);
    return { list: toPhoneChecklist(todos), summary: checklistSummary(todos) };
  };
  const checklistOf = (id: string) => {
    let c = checklists.get(id);
    if (!c) checklists.set(id, c = computeChecklist(id));
    return c;
  };
  const projected = (deviceId: string, s: Session) => toPhoneSession(s, followers.get(deviceId)?.reads.get(s.id) ?? startedAt, checklistOf(s.id).summary);
  const pushStatus = (deviceId: string): PushStatus => {
    const key = mobile.relayPushKey();
    if (key === null) return 'unavailable';
    const p = mobile.pushOf(deviceId);
    if (!p) return 'off';
    return key !== undefined && p.key !== key ? 'stale' : 'on';
  };
  const projectName = (id: string) => deps.openrig?.projects().projects.find(p => p.id === id)?.name;
  const threadContext = () => ({ rigs: deps.openrig?.rigs() ?? [], rules: deps.openrig?.rules() ?? [], decisions: deps.openrig?.decisions() ?? [], escalation: (id: string) => deps.openrig?.escalation(id), exchanges: (machine: string, rigId: string) => deps.openrig?.exchanges(machine, rigId) ?? null });
  const keys = () => new Map((deps.openrig?.rigs() ?? []).map(r => [rigKey(r.machine, r.id), { machine: r.machine, rigId: r.id }]));
  const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const snapshot = (deviceId: string): PhoneServerMessage => {
    const push = pushStatus(deviceId);
    const f = followers.get(deviceId);
    if (f) f.pushStatus = push;
    const message: Extract<PhoneServerMessage, { type: 'snapshot' }> = {
    type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: deps.sessions().filter(s => !isArchived(s) && !s.brain).map(s => projected(deviceId, s)), capabilities: capabilities(), daemon: { version: deps.version, boot: deps.boot, name: clip(hostname(), 40).text, ...(deps.pc?.canUpdate ? { update: true as const } : {}), ...(deps.pc?.canRestart ? { restart: true as const } : {}), checklist: true as const, ...(deps.closeSession ? { sessionClose: true as const } : {}) },
    device: { confirm: deps.credential(deviceId) !== null, push, ...(deps.chats ? { chat: true as const } : {}), ...(deps.contextNear ? { contextNear: deps.contextNear() } : {}) }
    };
    // Each record is validated before it enters the encrypted payload; malformed source records are omitted, never partially routed.
    if (deps.openrig) {
      const view = deps.openrig; const rigs = view.rigs(); const rules = view.rules();
      const safeMap = <A, B>(items: A[], f: (a: A) => B): B[] => items.flatMap(a => { try { return [f(a)]; } catch { return []; } });
      message.daemon.openrig = true;
      message.rigs = safeMap(rigs.slice(0, 40), r => toPhoneRig(r, projectName));
      message.escalations = safeMap(view.escalations().slice(0, 40), e => toPhoneEscalation(e, rules, rigs));
      message.decisionsToday = safeMap(view.decisions().filter(d => d.by === 'ledge' && day(new Date(d.at)) === day(new Date(deps.now ? deps.now() : Date.now()))).slice(-50), d => toPhoneDecision(d, rigs));
    }
    // The daemon takes `session.model` and lists an agent's models (#58).
    return deps.models ? { ...message, daemon: { ...message.daemon, models: true } } : message;
  };

  const outbox = createOutbox({
    send: (deviceId, text) => mobile.send(deviceId, text),
    onGone: deviceId => {
      log(`phone: device ${deviceId} gone`);
      followers.delete(deviceId);
    },
    onOverflow: deviceId => {
      if (followers.get(deviceId)?.subscribed) {
        outbox.push(deviceId, snapshot(deviceId), 'snapshot');
        // The full list of the session it is watching, which the snapshot does not carry.
        const watching = followers.get(deviceId)?.watching;
        if (watching) outbox.push(deviceId, { type: 'session.checklist', id: watching, checklist: checklistOf(watching).list }, `session.checklist:${watching}`);
      }
    },
    log,
    ...deps.outbox
  });

  const push = (deviceId: string, msg: PhoneServerMessage, key?: string) => { if (!stopped) outbox.push(deviceId, msg, key); };
  /** After a snapshot: the kept model failures of the sessions still there. */
  const replayModelFailures = (deviceId: string) => {
    for (const [id, f] of modelFailures) if (live(id)) push(deviceId, { type: 'session.model.failed', id, reason: f.reason });
  };
  /** What the daemon says that keeps or drops a model failure, followed or not. */
  const keepModelFailure = (m: ServerMessage) => {
    if (m.type === 'session.removed') { modelFailures.delete(m.id); return; }
    if (m.type === 'session.updated') {
      const f = modelFailures.get(m.session.id);
      if (f && (isArchived(m.session) || f.model !== m.session.model || f.effort !== m.session.effort)) modelFailures.delete(m.session.id);
      return;
    }
    if (m.type !== 'error' || m.request !== 'session.model' || m.id === undefined) return;
    const reason = ModelRefusalSchema.safeParse(m.code);
    const s = live(m.id);
    if (reason.success && s) modelFailures.set(m.id, { reason: reason.data, model: s.model, effort: s.effort });
  };
  const result = (deviceId: string, op: string, status: OperationStatus, reason?: OperationReason, how?: CloseHow) => {
    // A device revoked while its operation ran hears nothing more.
    if (stopped || !approved(deviceId)) return;
    push(deviceId, { type: 'operation.result', op, status, ...(reason ? { reason } : {}), ...(how ? { how } : {}) });
  };

  /** The operations that act on a tracked session: the registry's own, the credential's, the device's and the chat's are handled before it. */
  type SessionOperation = Extract<PhoneOperation, { type: 'session.decide' | 'session.reply' | 'session.answer' | 'session.interrupt' | 'session.model' }>;
  /** Whether the operation needs the device's own check: an accept of a request that is not low, or a reply to an OMP (rpc) dialog, which is never low. */
  const needsAssertion = (msg: SessionOperation, s: Session): boolean => {
    if (msg.type === 'session.decide') return msg.decision !== 'deny' && riskOf(s)?.risk !== 'low';
    if (msg.type === 'session.reply') return !!msg.expect && s.pending?.source === 'rpc' && riskOf(s)?.risk !== 'low';
    return false;
  };

  /** What a challenge is bound to: the session and the request, and for an OMP dialog the dialog itself (its requestId), since two dialogs can read the same. */
  const subjectOf = (id: string, key: string, s: Session | undefined): string =>
    `${id}:${key}${s?.pending?.source === 'rpc' && s.pending.requestId ? `:${s.pending.requestId}` : ''}`;

  /** The device check: the challenge is spent first, whatever the verdict, then the signature is verified and the counter kept. */
  const checkAssertion = (deviceId: string, assertion: NonNullable<Extract<PhoneOperation, { type: 'session.decide' }>['assertion']> | undefined, purpose: ConfirmPurpose, subject: string | undefined): Outcome | undefined => {
    const cred = deps.credential(deviceId);
    const rp = deps.rp();
    if (!cred || !rp || !assertion || subject === undefined) return { status: 'rejected', reason: 'confirm_required' };
    const invalid: Outcome = { status: 'rejected', reason: 'assertion_invalid' };
    const challenge = challengeOf(assertion.clientDataJSON);
    if (challenge === null) return invalid;
    const verdict = deps.challenges.consume(challenge, { deviceId, purpose, subject });
    if (verdict === 'expired') return { status: 'rejected', reason: 'assertion_expired' };
    if (verdict !== 'ok') return invalid;
    const verified = verifyAssertion(assertion, cred, rp, challenge);
    if (!verified.ok) {
      log(`phone: assertion refused for device ${deviceId}`);
      return invalid;
    }
    deps.setCredential(deviceId, { ...cred, counter: verified.counter });
    return undefined;
  };

  /** The device check of a decision. */
  const assertionOutcome = (deviceId: string, msg: Extract<PhoneOperation, { type: 'session.decide' | 'session.reply' }>, s: Session): Outcome | undefined => {
    const key = msg.expect?.key;
    return checkAssertion(deviceId, msg.assertion, 'decide', key === undefined ? undefined : subjectOf(msg.id, key, s));
  };

  /** The device check of a launch, bound to the turn. */
  const launchAssertionOutcome = (deviceId: string, qid: string, assertion: Extract<PhoneOperation, { type: 'chat.launch' }>['assertion']): Outcome | undefined =>
    checkAssertion(deviceId, assertion, 'launch', qid);

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
        // Images alone are a reply; nothing at all is not.
        if (msg.text === '' && !msg.attachments?.length) return { status: 'rejected', reason: 'invalid' };
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
      case 'session.model':
        // What the phone was shown (`canSwitch`): an ended session, or one Ledge did not launch, never reaches the daemon.
        if (canSwitch(s)) return undefined;
        return { status: 'rejected', reason: s.state === 'exited' ? 'ended' : 'not_launched' };
    }
  };

  /** The local message the operation stands for, built field by field. */
  const local = (msg: SessionOperation): ClientMessage => {
    switch (msg.type) {
      case 'session.decide':
        return { type: 'session.decide', id: msg.id, decision: msg.decision, ...(msg.note !== undefined ? { note: msg.note } : {}), expect: { kind: msg.expect.kind, text: msg.expect.text, key: msg.expect.key } };
      case 'session.reply': return { type: 'session.reply', id: msg.id, text: msg.text, ...(msg.attachments?.length ? { attachments: msg.attachments } : {}) };
      case 'session.answer': return { type: 'session.answer', id: msg.id, requestId: msg.requestId, answers: msg.answers, ...(msg.cancel ? { cancel: true } : {}) };
      case 'session.interrupt': return { type: 'session.interrupt', id: msg.id };
      case 'session.model': return { type: 'session.model', id: msg.id, model: msg.model, effort: msg.effort };
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

  /** The thread's turn the device may act on: its own thread's, never the PC's or another device's. A thread that cannot be reached is refused too. */
  const ownTurn = (deviceId: string, qid: string): ChatTurn | undefined => {
    const chats = deps.chats;
    if (!chats) return undefined;
    try {
      if (chats.owner(qid) !== `device:${deviceId}`) return undefined;
      return chats.device(deviceId).history().find(t => t.qid === qid);
    } catch { return undefined; }
  };

  /** A card set aside (« Ignorer », on any device) applies no more until it is opened again. */
  const SET_ASIDE: Outcome = { status: 'rejected', reason: 'stale' };

  const chatRelay = async (deviceId: string, msg: Extract<PhoneOperation, { type: 'chat.relay' }>): Promise<Outcome> => {
    const turn = ownTurn(deviceId, msg.qid);
    if (!turn || !deps.relay) return { status: 'rejected', reason: 'unknown_session' };
    if (turn.ignoredAt) return SET_ASIDE;
    if (!turn.relay || turn.relay.text.length > TOOL_TEXT_MAX) return { status: 'rejected', reason: 'invalid' };
    try { await deps.relay.request(msg.qid); } catch (e) { log(`phone chat.relay failed (${e instanceof Error ? e.name : 'error'})`); return { status: 'failed' }; }
    return { status: 'applied' };
  };

  const chatLaunch = async (deviceId: string, msg: Extract<PhoneOperation, { type: 'chat.launch' }>): Promise<Outcome> => {
    const turn = ownTurn(deviceId, msg.qid);
    if (!turn || !deps.launchChat) return { status: 'rejected', reason: 'unknown_session' };
    if (turn.ignoredAt) return SET_ASIDE;
    // Every targeted row must exist and fit the phone's card: it never confirms a text it did not see.
    const rows = proposalRows(turn);
    const targets = msg.rows ?? [...rows.keys()];
    if (targets.length === 0) return { status: 'rejected', reason: 'invalid' };
    // The projection is all or nothing: a card with any row too long is not shown at all, so no row of it is acted on.
    if (rows.some(p => (p.prompt?.length ?? 0) > TOOL_TEXT_MAX)) return { status: 'rejected', reason: 'invalid' };
    for (const r of targets) if (!rows[r]) return { status: 'rejected', reason: 'invalid' };
    if (deps.credential(deviceId) === null) return { status: 'rejected', reason: 'confirm_required' };
    // Nothing left to start: answered before the assertion is spent.
    if (targets.every(r => rows[r]!.launchedId)) return { status: 'failed' };
    const refused = launchAssertionOutcome(deviceId, msg.qid, msg.assertion);
    if (refused) return refused;
    const done = await deps.launchChat(`device:${deviceId}`, msg.qid, targets);
    return done.launched.length > 0 ? { status: 'applied' } : { status: 'failed' };
  };

  const chatClose = async (deviceId: string, msg: Extract<PhoneOperation, { type: 'chat.close' }>): Promise<Outcome> => {
    const turn = ownTurn(deviceId, msg.qid);
    if (!turn || !deps.closeChat) return { status: 'rejected', reason: 'unknown_session' };
    if (turn.ignoredAt) return SET_ASIDE;
    const closes = turn.closes;
    const targets = msg.rows ?? (closes ? [...closes.keys()] : []);
    if (!closes || targets.length === 0) return { status: 'rejected', reason: 'invalid' };
    for (const r of targets) if (!closes[r]) return { status: 'rejected', reason: 'invalid' };
    if (deps.credential(deviceId) === null) return { status: 'rejected', reason: 'confirm_required' };
    // Nothing left to close: answered before the assertion is spent.
    if (targets.every(r => closes[r]!.closedAt)) return { status: 'failed' };
    const refused = checkAssertion(deviceId, msg.assertion, 'close', msg.qid);
    if (refused) return refused;
    try {
      const done = await deps.closeChat(`device:${deviceId}`, msg.qid, targets);
      return done.closed.length > 0 ? { status: 'applied' } : { status: 'failed' };
    } catch (e) {
      // A row still being closed (the phone reloaded mid-close and asked again) is that close's: under way, not failed.
      if (e instanceof CloseRefused) return { status: e.underWay ? 'applied' : 'failed' };
      throw e;
    }
  };

  /**
   * A generic card (spec 2026-10-26 action registry §9.1-9.2): a destructive row needs the phone's confirmation, and it or any row
   * the registry gives a device check (`phone`) one assertion for the turn; the rows then apply in order, stopping at the first failure.
   */
  const chatAct = async (deviceId: string, msg: Extract<PhoneOperation, { type: 'chat.act' }>): Promise<Outcome> => {
    const turn = ownTurn(deviceId, msg.qid);
    if (!turn || !deps.actChat) return { status: 'rejected', reason: 'unknown_session' };
    if (turn.ignoredAt) return SET_ASIDE;
    const actions = turn.actions;
    const targets = msg.rows ?? (actions ? [...actions.keys()] : []);
    if (!actions || targets.length === 0) return { status: 'rejected', reason: 'invalid' };
    for (const r of targets) if (!actions[r]) return { status: 'rejected', reason: 'invalid' };
    // Nothing left to apply: answered before the assertion is spent. The checks below read the rows still open, as act.ts does.
    const settled = (r: number) => actions[r]!.state === 'done' || actions[r]!.state === 'denied';
    if (targets.every(settled)) return { status: 'failed' };
    const todo = targets.filter(r => !settled(r));
    // « Refuser » answers a session's request only.
    if (msg.deny && todo.some(r => actions[r]!.action !== 'session.decide')) return { status: 'rejected', reason: 'invalid' };
    // A request the phone could only show cut is refused from there, never accepted: the rest is read on the PC.
    if (!msg.deny && todo.some(r => phoneCut(actions[r]!) && actions[r]!.args.decision !== 'deny')) return { status: 'rejected', reason: 'not_offered' };
    // A deny is never confirmed nor checked on the device, as the phone's own deny of a request is not.
    if (!msg.deny && !msg.confirmed && todo.some(r => actions[r]!.risk === 'destructive')) return { status: 'rejected', reason: 'confirm_required' };
    // A row destructive, or one the registry marks for a device check, needs the passkey (§5.3).
    if (!msg.deny && todo.some(r => actions[r]!.risk === 'destructive' || actionById(actions[r]!.action)?.phone)) {
      if (deps.credential(deviceId) === null) return { status: 'rejected', reason: 'confirm_required' };
      const refused = checkAssertion(deviceId, msg.assertion, 'act', msg.qid);
      if (refused) return refused;
    }
    try {
      const done = await deps.actChat(`device:${deviceId}`, msg.qid, `phone:${msg.op}`, todo, msg.confirmed, msg.deny);
      return done.failed.length === 0 && done.done.length > 0 ? { status: 'applied' } : { status: 'failed' };
    } catch (e) {
      if (e instanceof ActRefused) return e.code ? { status: 'rejected', reason: e.code } : { status: 'failed' };
      throw e;
    }
  };

  /** What a challenge over a session is bound to (`session.close`, `session.resume`): never a turn's qid, whatever the session's id. */
  const sessionSubject = (id: string) => `session:${id}`;

  /**
   * « Fermer » and « Reprendre » on a session's page: what the phone was shown is checked before the challenge is spent, then the
   * device's check over the session. The close is the cards' own (`closeSession`), the resume the local `session.resume`.
   */
  const sessionEnd = async (deviceId: string, msg: Extract<PhoneOperation, { type: 'session.close' | 'session.resume' }>): Promise<Outcome> => {
    const close = deps.closeSession;
    if (!close) return { status: 'rejected', reason: 'unavailable' };
    const closing = msg.type === 'session.close';
    const s = live(msg.id);
    if (!s) return { status: 'rejected', reason: 'unknown_session' };
    if (s.source === 'hook_only') return { status: 'rejected', reason: 'read_only' };
    if (closing && s.state === 'exited') return { status: 'rejected', reason: 'ended' };
    if (!closing && s.state !== 'exited') return { status: 'rejected', reason: 'busy' };
    if (deps.credential(deviceId) === null) return { status: 'rejected', reason: 'confirm_required' };
    const refused = checkAssertion(deviceId, msg.assertion, closing ? 'close' : 'act', sessionSubject(msg.id));
    if (refused) return refused;
    if (!closing) {
      let error: { code?: string } | undefined;
      await deps.dispatch({ type: 'session.resume', id: msg.id }, m => { if (m.type === 'error' && m.request === 'session.resume') error ??= { code: m.code }; });
      if (!error) return { status: 'applied' };
      return error.code === 'no_conversation' ? { status: 'rejected', reason: 'no_conversation' } : outcomeOf(error.code);
    }
    try {
      const { how } = await close(msg.id);
      log(`phone: device ${deviceId} closed ${msg.id} (${how})`);
      return { status: 'applied', how };
    } catch (e) {
      // Ended meanwhile, by the PC or by the agent itself: what the phone asked for is done.
      if (live(msg.id)?.state === 'exited') return { status: 'rejected', reason: 'ended' };
      const code = RefusalCodeSchema.safeParse(e instanceof Error ? (e as Error & { code?: unknown }).code : undefined);
      if (code.success) return { status: 'rejected', reason: code.data };
      log(`phone session.close failed (${e instanceof Error ? e.name : 'error'})`);
      return { status: 'failed' };
    }
  };

  /**
   * Dispatches a local message and reads its answer: `ok` says which answers mean applied (true), failed (false) or what else
   * (an outcome). An `error` is a refusal by its code (`opts.error` when the caller says what it always means); no answer at all is
   * applied, or `opts.silent`.
   */
  const ask = async (out: ClientMessage, ok: (m: ServerMessage) => boolean | Outcome | undefined, opts: { silent?: Outcome; error?: Outcome } = {}): Promise<Outcome> => {
    let outcome: Outcome | undefined;
    await deps.dispatch(out, m => {
      if (outcome) return;
      if (m.type === 'error') { outcome = opts.error ?? outcomeOf(m.code); return; }
      const verdict = ok(m);
      if (verdict !== undefined) outcome = typeof verdict === 'object' ? verdict : verdict ? { status: 'applied' } : { status: 'failed' };
    });
    return outcome ?? opts.silent ?? { status: 'applied' };
  };

  /**
   * A model change (#58), by its correlated answer: accepted is applied (`turn`: scheduled for the session's next free moment),
   * an `error` of the request a refusal by its model code or its refusal code; anything else failed. An accept wins over an
   * error that came with it: a failure once applied reaches the phone apart, as `session.model.failed` (`forward`).
   */
  const modelChange = async (out: Extract<ClientMessage, { type: 'session.model' }>): Promise<Outcome> => {
    let when: 'now' | 'turn' | 'none' | undefined;
    let refusal: { code?: string } | undefined;
    await deps.dispatch(out, m => {
      if (m.type === 'session.model.accepted' && m.id === out.id) when ??= m.when;
      if (m.type === 'error' && m.request === 'session.model' && (m.id === undefined || m.id === out.id)) refusal ??= { code: m.code };
    });
    // A new change accepted answers the last failure.
    if (when) modelFailures.delete(out.id);
    if (when) return when === 'turn' ? { status: 'applied', reason: 'scheduled' } : { status: 'applied' };
    const model = ModelRefusalSchema.safeParse(refusal?.code);
    if (model.success) return { status: 'rejected', reason: model.data };
    const known = RefusalCodeSchema.safeParse(refusal?.code);
    return known.success ? { status: 'rejected', reason: known.data } : { status: 'failed' };
  };

  /** An agent's models, asked of the local daemon (never another machine's); none, in error, when it could not answer in time. */
  const modelsList = async (deviceId: string, tool: Tool) => {
    const requestId = randomUUID();
    let listing: Extract<ServerMessage, { type: 'models.listing' }> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        deps.dispatch({ type: 'models.list', requestId, tool }, m => { if (m.type === 'models.listing' && m.requestId === requestId) listing ??= m; }),
        new Promise<void>(r => { timer = setTimeout(r, MODELS_WAIT_MS); })
      ]);
    } catch (e) { log(`phone models.list failed (${e instanceof Error ? e.name : 'error'})`); }
    finally { clearTimeout(timer); }
    // The agent could not be asked: what Ledge knows without it, said in error; never the daemon's text, which may hold a path.
    if (!listing) return push(deviceId, { type: 'models.listing', tool, models: [], error: true });
    push(deviceId, { type: 'models.listing', tool, models: toPhoneModels(listing.models), ...(listing.error !== undefined ? { error: true as const } : {}) });
  };

  /** « Ignorer » the device's own turn, or `undo` (« Revoir »). */
  const chatIgnore = (deviceId: string, msg: Extract<PhoneOperation, { type: 'chat.ignore' }>): Outcome => {
    if (!ownTurn(deviceId, msg.qid) || !deps.chats) return { status: 'rejected', reason: 'unknown_session' };
    const why = deps.chats.device(deviceId).ignore(msg.qid, msg.undo === true, emitterOf(deviceId));
    return why === null ? { status: 'applied' } : { status: 'rejected', reason: 'invalid' };
  };

  /**
   * Updating or restarting the PC's daemon. Accepted once the passkey holds, before npm runs: `applied` means started, not done.
   * The updater's progress and refusals then reach every phone through `forward`; a busy refusal reaches this one alone.
   */
  const pcOperation = (deviceId: string, msg: Extract<PhoneOperation, { type: 'daemon.update' | 'daemon.restart' }>): Outcome => {
    const pc = deps.pc;
    const update = msg.type === 'daemon.update';
    if (!pc || !(update ? pc.canUpdate : pc.canRestart)) return { status: 'rejected', reason: 'unavailable' };
    // Never back, and nothing to do for the running version: refused before the challenge is spent.
    if (update && (!SEMVER.test(deps.version) || compareVersions(msg.version, deps.version) <= 0)) return { status: 'rejected', reason: 'invalid' };
    const refused = checkAssertion(deviceId, msg.assertion, 'pc', update ? pcSubject('update', msg.version) : pcSubject('restart'));
    if (refused) return refused;
    const reply = (m: ServerMessage) => { if (m.type === 'update.failed') push(deviceId, { type: 'daemon.failed', version: m.version, reason: m.reason }); };
    log(`phone: device ${deviceId} asked the daemon to ${update ? `update to ${msg.version}` : 'restart'}`);
    if (update) pc.update(msg.version, reply); else pc.restart(reply);
    return { status: 'applied' };
  };

  type OpenRigOperation = Extract<PhoneOperation, { type: 'rig.act' | 'rig.launch' | 'rig.prepare' | 'ledge.say' | 'escalation.answer' | 'decision.revisit' }>;
  /** Wait for the daemon's actual result; remote routing may reply after dispatch has returned. */
  const rigRequest = (message: ClientMessage): Promise<ServerMessage | undefined> => new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => finish(undefined), 20_000);
    const finish = (m: ServerMessage | undefined) => { if (settled) return; settled = true; clearTimeout(timer); resolve(m); };
    void deps.dispatch(message, m => { if (m.type === 'rig.result' || m.type === 'rig.plan' || m.type === 'error') finish(m); }).catch(() => finish(undefined));
  });
  const openrigOperation = async (deviceId: string, msg: OpenRigOperation): Promise<Outcome> => {
    const view = deps.openrig;
    if (!view) return { status: 'rejected', reason: 'unsupported' };
    if (msg.type === 'rig.act') {
      const target = keys().get(msg.key); const rig = target && view.rigs().find(r => r.machine === target.machine && r.id === target.rigId);
      if (!rig || (msg.verb === 'down' && msg.seatRef) || (msg.verb === 'restart' && (!msg.seatRef || !rig.seats.some(s => s.ref === msg.seatRef)))) return { status: 'rejected', reason: 'invalid' };
      const refused = checkAssertion(deviceId, msg.assertion, 'rig', rigSubject(msg)); if (refused) return refused;
    }
    if (msg.type === 'rig.launch') { const refused = checkAssertion(deviceId, msg.assertion, 'rig', rigSubject(msg)); if (refused) return refused; }
    let out: ClientMessage | { refused: import('@ledge/protocol').RigResultCode };
    if (msg.type === 'rig.prepare') {
      const spec = msg.spec?.trim() || 'starter';
      if (msg.project === null) out = { type: 'rig.prepare', rid: msg.op, machine: 'local', spec, goal: msg.goal, where: { kind: 'off-project', name: slugOfGoal(msg.goal) } };
      else {
        const candidates = view.projects().projects.filter(p => p.id === msg.project || p.name === msg.project);
        if (candidates.length !== 1) return { status: 'rejected', reason: 'invalid' };
        const project = candidates[0]!; const repo = project.repos.find(r => r.machine === 'local');
        if (!repo) return { status: 'rejected', reason: 'invalid' };
        const info = (await inspectRepos([repo.path]))[0]; if (!info?.exists || !info.branch) return { status: 'rejected', reason: 'invalid' };
        out = { type: 'rig.prepare', rid: msg.op, machine: 'local', spec, goal: msg.goal, where: { kind: 'project', projectId: project.id, repo: repo.path, branch: info.branch, copy: true } };
      }
    } else out = fromPhone(msg, keys());
    if ('refused' in out) return { status: 'rejected', reason: out.refused };
    const result = await rigRequest(out);
    if (!result) return { status: 'failed' };
    if (result.type === 'error') return { status: 'rejected', reason: 'failed' };
    if (result.type === 'rig.plan') {
      const plan = toPhonePlan(result.plan, projectName);
      push(deviceId, { type: 'rig.plan', plan });
      push(deviceId, { type: 'ledge.thread.item', item: { kind: 'plan', id: `plan-${plan.id}`, at: new Date(deps.now ? deps.now() : Date.now()).toISOString(), plan } });
      return { status: 'applied' };
    }
    if (result.type !== 'rig.result') return { status: 'failed' };
    if (!result.ok) return { status: 'rejected', reason: result.code ?? 'failed' };
    // The remote daemon can acknowledge a queued answer before delivery; it is not an applied decision.
    if (msg.type === 'escalation.answer' && view.escalation(msg.id)?.answer?.delivery) return { status: 'received' };
    return { status: 'applied' };
  };

  const run = async (deviceId: string, msg: PhoneOperation): Promise<Outcome> => {
    if (msg.type === 'daemon.update' || msg.type === 'daemon.restart') return pcOperation(deviceId, msg);
    if (msg.type === 'chat.ignore') return chatIgnore(deviceId, msg);
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
    if (msg.type === 'chat.relay') return chatRelay(deviceId, msg);
    if (msg.type === 'chat.launch') return chatLaunch(deviceId, msg);
    if (msg.type === 'chat.close') return chatClose(deviceId, msg);
    if (msg.type === 'chat.act') return chatAct(deviceId, msg);
    if (msg.type === 'session.close' || msg.type === 'session.resume') return sessionEnd(deviceId, msg);
    if (msg.type === 'rig.act' || msg.type === 'rig.launch' || msg.type === 'rig.prepare' || msg.type === 'ledge.say' || msg.type === 'escalation.answer' || msg.type === 'decision.revisit') return openrigOperation(deviceId, msg);
    const refused = precheck(deviceId, msg);
    if (refused) return refused;
    const out = local(msg);
    if (out.type === 'session.model') return modelChange(out);
    let error: { code?: string } | undefined;
    await deps.dispatch(out, m => {
      if (m.type === 'error' && (m.request === undefined || m.request === out.type)) error ??= { code: m.code };
    });
    return error ? outcomeOf(error.code) : { status: 'applied' };
  };

  const write = async (deviceId: string, msg: PhoneOperation) => {
    const begun = registry.begin(deviceId, msg.op, fingerprint(msg));
    if (begun.kind === 'conflict') return result(deviceId, msg.op, 'rejected', 'conflict');
    if (begun.kind === 'replay') return result(deviceId, msg.op, begun.record.status, begun.record.reason, begun.record.how);
    let outcome: Outcome;
    try {
      result(deviceId, msg.op, 'received');
      outcome = await run(deviceId, msg);
    }
    catch (e) {
      log(`phone ${msg.type} failed (${e instanceof Error ? e.name : 'error'})`);
      outcome = { status: 'failed' };
    }
    registry.finish(msg.op, outcome.status, outcome.reason, outcome.how);
    result(deviceId, msg.op, outcome.status, outcome.reason, outcome.how);
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

  /** The phone's own chat. A thread that cannot be reached (an id off the pattern, a thread being dropped) is refused, never thrown. */
  const chatRead = async (deviceId: string, msg: Extract<PhoneClientMessage, { type: 'chat.ask' | 'chat.cancel' | 'chat.reset' | 'chat.history' }>) => {
    const chats = deps.chats;
    if (!chats || !approved(deviceId)) return;
    known.add(deviceId);
    try {
      switch (msg.type) {
        case 'chat.ask': {
          const thread = chats.device(deviceId);
          const emit = emitterOf(deviceId);
          // The images were put first; an id the store does not know fails the question rather than sending it without.
          const refs: AttachmentRef[] = [];
          for (const id of msg.attachments ?? []) {
            const ref = deps.attachments.ref(id);
            if (!ref) return push(deviceId, { type: 'chat.error', qid: msg.qid, code: 'failed' });
            refs.push(ref);
          }
          if (msg.text === '' && refs.length === 0) return push(deviceId, { type: 'chat.error', qid: msg.qid, code: 'failed' });
          return await thread.ask(msg.qid, msg.text, emit, await chats.deviceTool(), refs);
        }
        case 'chat.cancel':
          // Only the device's own turn: another thread's qid is nothing here.
          if (chats.owner(msg.qid) === `device:${deviceId}`) chats.device(deviceId).cancel(msg.qid);
          return;
        case 'chat.reset': return await chats.device(deviceId).reset(emitterOf(deviceId));
        case 'chat.history': return push(deviceId, { type: 'chat.history', turns: toPhoneHistory(chats.device(deviceId).history()) }, 'chat.history');
      }
    } catch (e) {
      log(`phone ${msg.type} failed (${e instanceof Error ? e.name : 'error'})`);
      if (msg.type === 'chat.ask') push(deviceId, { type: 'chat.error', qid: msg.qid, code: 'failed' });
      else push(deviceId, { type: 'error', code: 'invalid', request: msg.type });
    }
  };

  /** A phone's image upload or download; the answer is the request's, matched by `requestId`. */
  const attachment = async (deviceId: string, msg: Extract<PhoneClientMessage, { type: 'attachment.put' | 'attachment.get' }>) => {
    if (!approved(deviceId)) return;
    const fail = (reason: AttachmentError['reason']) => push(deviceId, { type: 'attachment.error', requestId: msg.requestId, reason });
    try {
      if (msg.type === 'attachment.get') {
        const found = await deps.attachments.read(msg.attachment, msg.preview === true);
        if (!found) return fail('not_found');
        return push(deviceId, { type: 'attachment.data', requestId: msg.requestId, attachment: msg.attachment, mime: found.mime, data: found.data.toString('base64') });
      }
      const decode = (data: string): Buffer => {
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 === 1) throw new AttachmentError('unreadable');
        return Buffer.from(data, 'base64');
      };
      const { image } = msg;
      const ref = await deps.attachments.put(decode(image.data), image.preview ? decode(image.preview.data) : undefined, ATTACHMENT_MAX);
      push(deviceId, { type: 'attachment.stored', requestId: msg.requestId, ref });
    } catch (e) {
      if (e instanceof AttachmentError) return fail(e.reason);
      log(`phone ${msg.type} failed (${e instanceof Error ? e.name : 'error'})`);
      fail('unreadable');
    }
  };

  const read = (deviceId: string, msg: Exclude<PhoneClientMessage, PhoneOperation>) => {
    switch (msg.type) {
      case 'ledge.thread.request': {
        if (!deps.openrig) return push(deviceId, { type: 'error', code: 'invalid', request: msg.type });
        const page = deps.openrig.thread(msg.before); const ctx = threadContext();
        const items = page.items.slice(-THREAD_PAGE).flatMap(item => { try { const projected = toPhoneThreadItem(item, ctx); return projected ? [projected] : []; } catch { return []; } });
        return push(deviceId, { type: 'ledge.thread.history', items, ...(page.before ? { before: page.before } : {}) });
      }
      case 'rig.exchanges.request': {
        const target = keys().get(msg.key);
        if (!target || !deps.openrig) return push(deviceId, { type: 'error', code: 'invalid', request: msg.type });
        const all = deps.openrig.exchanges(target.machine, target.rigId);
        if (!all) return push(deviceId, { type: 'error', code: 'invalid', request: msg.type });
        const items = all.slice(-EXCHANGES_MAX).flatMap(item => { try { return [toPhoneExchange(item)]; } catch { return []; } });
        return push(deviceId, { type: 'rig.exchanges', key: msg.key, items, ...(all.length > EXCHANGES_MAX ? { cut: true as const } : {}) });
      }
      case 'attachment.put': case 'attachment.get':
        void attachment(deviceId, msg);
        return;
      case 'chat.ask': case 'chat.cancel': case 'chat.reset': case 'chat.history':
        if (!deps.chats) return push(deviceId, { type: 'error', code: 'invalid', request: msg.type });
        void chatRead(deviceId, msg);
        return;
      case 'presence':
        follower(deviceId).visible = msg.visible;
        return;
      case 'models.list':
        // Ignored by a gateway that does not say `models`: the phone never offers the switch there.
        if (!deps.models) return;
        void modelsList(deviceId, msg.tool).catch((e: unknown) => log(`phone models.list failed (${e instanceof Error ? e.name : 'error'})`));
        return;
      case 'snapshot.request':
        follower(deviceId).subscribed = true;
        push(deviceId, snapshot(deviceId), 'snapshot');
        return replayModelFailures(deviceId);
      case 'session.thread': {
        if (!live(msg.id)) return push(deviceId, { type: 'error', code: 'unknown_session', request: msg.type });
        push(deviceId, { type: 'session.thread', id: msg.id, ...toPhoneThread(deps.thread(msg.id) ?? []) });
        return push(deviceId, { type: 'session.checklist', id: msg.id, checklist: checklistOf(msg.id).list }, `session.checklist:${msg.id}`);
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
        if (msg.purpose === 'launch') {
          if (msg.qid === undefined || !ownTurn(deviceId, msg.qid)) return invalid();
          const cred = deps.credential(deviceId);
          if (!cred || cred.rpId !== rp.rpId) return invalid();
          const challenge = deps.challenges.issue({ deviceId, purpose: 'launch', subject: msg.qid });
          return push(deviceId, { type: 'confirm.challenge', purpose: 'launch', challenge, rpId: rp.rpId, credentialId: cred.id, expiresInMs: CHALLENGE_TTL_MS });
        }
        // A session's own « Fermer » or « Reprendre »: bound to the session, for a daemon that takes them.
        if ((msg.purpose === 'close' || msg.purpose === 'act') && msg.qid === undefined && msg.id !== undefined) {
          if (!deps.closeSession) return invalid();
          if (!live(msg.id)) return push(deviceId, { type: 'error', code: 'unknown_session', request: msg.type });
          const cred = deps.credential(deviceId);
          if (!cred || cred.rpId !== rp.rpId) return invalid();
          const challenge = deps.challenges.issue({ deviceId, purpose: msg.purpose, subject: sessionSubject(msg.id) });
          return push(deviceId, { type: 'confirm.challenge', purpose: msg.purpose, challenge, rpId: rp.rpId, credentialId: cred.id, expiresInMs: CHALLENGE_TTL_MS });
        }
        if (msg.purpose === 'close') {
          if (msg.qid === undefined || !ownTurn(deviceId, msg.qid)) return invalid();
          const cred = deps.credential(deviceId);
          if (!cred || cred.rpId !== rp.rpId) return invalid();
          const challenge = deps.challenges.issue({ deviceId, purpose: 'close', subject: msg.qid });
          return push(deviceId, { type: 'confirm.challenge', purpose: 'close', challenge, rpId: rp.rpId, credentialId: cred.id, expiresInMs: CHALLENGE_TTL_MS });
        }
        if (msg.purpose === 'act') {
          if (msg.qid === undefined || !ownTurn(deviceId, msg.qid)) return invalid();
          const cred = deps.credential(deviceId);
          if (!cred || cred.rpId !== rp.rpId) return invalid();
          const challenge = deps.challenges.issue({ deviceId, purpose: 'act', subject: msg.qid });
          return push(deviceId, { type: 'confirm.challenge', purpose: 'act', challenge, rpId: rp.rpId, credentialId: cred.id, expiresInMs: CHALLENGE_TTL_MS });
        }
        if (msg.purpose === 'register') {
          const challenge = deps.challenges.issue({ deviceId, purpose: 'register', subject: '' });
          return push(deviceId, { type: 'confirm.challenge', purpose: 'register', challenge, rpId: rp.rpId, expiresInMs: CHALLENGE_TTL_MS });
        }
        if (msg.purpose === 'pc') {
          // Bound to the action, and for an update to its version: a challenge covers neither another version nor a restart.
          const pc = deps.pc;
          if (!pc || !msg.action || (msg.action === 'update') !== (msg.version !== undefined)) return invalid();
          if (!(msg.action === 'update' ? pc.canUpdate : pc.canRestart)) return invalid();
          const cred = deps.credential(deviceId);
          if (!cred || cred.rpId !== rp.rpId) return invalid();
          const challenge = deps.challenges.issue({ deviceId, purpose: 'pc', subject: pcSubject(msg.action, msg.version) });
          return push(deviceId, { type: 'confirm.challenge', purpose: 'pc', challenge, rpId: rp.rpId, credentialId: cred.id, expiresInMs: CHALLENGE_TTL_MS });
        }
        if (msg.purpose === 'rig') {
          if (!deps.openrig || !msg.rig || msg.rig.assertion) return invalid();
          if (msg.rig.type === 'rig.act' && !keys().has(msg.rig.key)) return invalid();
          const cred = deps.credential(deviceId); if (!cred || cred.rpId !== rp.rpId) return invalid();
          const challenge = deps.challenges.issue({ deviceId, purpose: 'rig', subject: rigSubject(msg.rig) });
          return push(deviceId, { type: 'confirm.challenge', purpose: 'rig', challenge, rpId: rp.rpId, credentialId: cred.id, expiresInMs: CHALLENGE_TTL_MS });
        }
        // A purpose added to the enum without a branch above fails to compile here.
        const unhandled: never = msg.purpose;
        void unhandled;
        return invalid();
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
    if (stopped || !approved(deviceId)) return;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { raw = undefined; }
    const parsed = raw === undefined ? undefined : PhoneClientMessageSchema.safeParse(raw);
    if (!parsed?.success) {
      const type = (raw as { type?: unknown } | null | undefined)?.type;
      const request = typeof type === 'string' && REQUEST_NAME.test(type) ? type : undefined;
      log(`phone message refused: ${request ?? '?'}`);
      // A subscription to an endpoint off the list, or a launch the schema refuses (a row twice), is an operation the phone waits an answer for.
      const op = OperationIdSchema.safeParse((raw as { op?: unknown } | null | undefined)?.op);
      // A model change the schema refuses (#58) is answered the same way.
      if (request === 'session.model' && op.success && approved(deviceId)) return push(deviceId, { type: 'operation.result', op: op.data, status: 'rejected', reason: 'invalid' });
      if ((request === 'push.subscribe' || request === 'chat.launch' || request === 'chat.close' || request === 'chat.act' || request === 'chat.ignore' || request === 'session.close' || request === 'session.resume') && op.success && approved(deviceId)) return push(deviceId, { type: 'operation.result', op: op.data, status: 'rejected', reason: 'invalid' });
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
    const devices = new Map(mobile.state().devices.map(d => [d.id, d]));
    // A device that left the list loses its thread whether or not it is connected.
    for (const id of [...known]) {
      if (devices.has(id)) continue;
      known.delete(id);
      if (!followers.has(id)) dropThread(id);
    }
    for (const id of devices.keys()) known.add(id);
    for (const [deviceId, f] of [...followers]) {
      const d = devices.get(deviceId);
      if (!d) { forget(deviceId); continue; }
      if (!d.online) f.visible = false;
      if (f.subscribed && f.pushStatus !== undefined && f.pushStatus !== pushStatus(deviceId)) push(deviceId, snapshot(deviceId), 'snapshot');
    }
  };

  /** A session gone for the phone (removed or archived): its read mark and watch go with it. */
  const removed = (id: string) => {
    checklists.delete(id);
    for (const [deviceId, f] of followers) {
      f.reads.delete(id);
      if (f.watching === id) f.watching = null;
      if (f.subscribed) push(deviceId, { type: 'session.removed', id });
    }
  };

  /** A main-thread checklist update, already in the thread: its watchers get the new list, the followers the session when its summary moved. */
  const checklistChanged = (id: string, item: ThreadItem) => {
    if (item.kind !== 'tool' || item.helperId !== undefined || !TODO_TOOLS.has(item.tool) || !checklists.has(id)) return;
    const before = checklists.get(id)!;
    const now = computeChecklist(id);
    checklists.set(id, now);
    if (JSON.stringify(now.list) !== JSON.stringify(before.list)) {
      for (const [deviceId, f] of followers) if (f.watching === id) push(deviceId, { type: 'session.checklist', id, checklist: now.list }, `session.checklist:${id}`);
    }
    const s = live(id);
    if (s && JSON.stringify(now.summary) !== JSON.stringify(before.summary)) {
      for (const [deviceId, f] of followers) if (f.subscribed) push(deviceId, { type: 'session.updated', session: projected(deviceId, s) }, `session.updated:${id}`);
    }
  };

  const unsubscribeMessage = mobile.onMessage(receive);
  const unsubscribeChange = mobile.onChange(pruneRevoked);

  return {
    forward(m) {
      if (!stopped) try { keepModelFailure(m); } catch (e) { log(`phone model failure of ${m.type} failed (${e instanceof Error ? e.name : 'error'})`); }
      if (stopped) return;
      // Nothing is kept for nobody: a device that comes back gets the checklists computed afresh.
      if (followers.size === 0) { checklists.clear(); return; }
      try {
        switch (m.type) {
          case 'rig.snapshot': case 'rig.updated': case 'rig.removed': case 'escalation.updated': case 'escalation.removed':
            if (!deps.openrig) return;
            for (const [deviceId, f] of followers) if (f.subscribed) push(deviceId, snapshot(deviceId), 'snapshot');
            return;
          case 'ledge.thread.item': {
            if (!deps.openrig) return;
            const item = toPhoneThreadItem(m.item, threadContext()); if (!item) return;
            for (const [deviceId, f] of followers) if (f.subscribed) push(deviceId, { type: 'ledge.thread.item', item });
            return;
          }
          case 'session.updated':
            if (isArchived(m.session)) return removed(m.session.id);
            for (const [deviceId, f] of followers) {
              if (f.subscribed) push(deviceId, { type: 'session.updated', session: projected(deviceId, m.session) }, `session.updated:${m.session.id}`);
            }
            return;
          case 'session.removed':
            return removed(m.id);
          case 'error': {
            // A model change accepted, then failed once applied (#58): its code, never the daemon's text, to whoever follows the sessions.
            const reason = ModelRefusalSchema.safeParse(m.code);
            if (m.request !== 'session.model' || m.id === undefined || !reason.success || !live(m.id)) return;
            for (const [deviceId, f] of followers) if (f.subscribed) push(deviceId, { type: 'session.model.failed', id: m.id, reason: reason.data });
            return;
          }
          case 'context.prefs':
            // The threshold rides on the snapshot's device: a change sends each following device a fresh one.
            for (const [deviceId, f] of followers) if (f.subscribed) push(deviceId, snapshot(deviceId), 'snapshot');
            return;
          // The daemon updating or restarting itself, whoever asked. Never npm's output nor a command: both hold the PC's paths.
          case 'update.progress':
            for (const [deviceId, f] of followers) if (f.subscribed) push(deviceId, { type: 'daemon.progress', version: m.version, step: m.step });
            return;
          case 'update.failed':
            for (const [deviceId, f] of followers) if (f.subscribed) push(deviceId, { type: 'daemon.failed', version: m.version, reason: m.reason });
            return;
          case 'session.preview':
            for (const [deviceId, f] of followers) {
              if (f.watching === m.id) push(deviceId, { type: 'session.preview', id: m.id, lines: [...m.lines] }, `session.preview:${m.id}`);
            }
            return;
          case 'session.thread.item': {
            checklistChanged(m.id, m.item);
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
