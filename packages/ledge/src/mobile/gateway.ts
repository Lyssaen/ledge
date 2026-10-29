// The phone gateway: texts from approved devices are read against the whitelist, reads are answered here, writes go
// through the operation registry and then the local fronts' own `dispatch`. What the daemon broadcasts is projected for
// the devices that follow it. Logs carry a type, a code or an error's name, never a message's content.
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  ATTACHMENT_MAX, TEAMS_OPERATION_TYPES, isTeamsOperation, OperationIdSchema, PHONE_PROTOCOL, actionById, TOOL_TEXT_MAX, proposalRows, PhoneClientMessageSchema, pushEndpointAllowed, RefusalCodeSchema, UNTYPABLE, backendOf, isArchived, pendingKey,
  LEDGE_GIVER, SEMVER, pcSubject, type AttachmentRef, type ChatErrorCode, type ChatTurn, type CloseHow, type ClientMessage, type PhoneTask, type Task, type Team, type OperationReason, type OperationStatus, type PhoneClientMessage, type PhoneServerMessage, type ServerMessage, type Session, type ThreadItem
} from '@ledge/protocol';
import { ModelRefusalSchema, type ModelRefusal, type PhoneSeatModel, type Tool } from '@ledge/protocol';
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
import { createTeamsOps } from './teamsOps.js';
import { capabilities, clip, phoneTasks, toPhoneFullRequest, toPhoneItem, toPhoneSession, toPhoneTask, toPhoneTeam, toPhoneThread } from './project.js';
import { canSwitch, toPhoneModels } from './project.js';
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
  /** The live teams and the tasks (ledge home spec §2.4): the phone's « Le point », « À traiter » and agents by table. */
  teams?: () => Team[];
  tasks?: () => Task[];
  /** A project's name, by id. */
  projectName?: (id: string | null) => string | null;
  /** The id of the project of this name, or null: the phone names its projects, never a folder. */
  projectByName?: (name: string) => string | null;
  /** The daemon answers `definitions.list` and the role and team operations: without it the phone's catalog and writes are unavailable. */
  teamCatalog?: true;
  /**
   * The daemon's own update and restart, for the phone only (spec 2026-10-28 mobile daemon update): never a `ClientMessage`.
   * Each runs on its own; its progress and refusals are broadcast, and `reply` gets a refusal meant for the asker alone (busy).
   */
  pc?: { canUpdate: boolean; canRestart: boolean; update: (version: string, reply: (m: ServerMessage) => void) => void; restart: (reply: (m: ServerMessage) => void) => void };
  /** The context threshold the user chose (context handover spec §3.2). */
  contextNear?: () => number;
  /** The daemon takes `session.model` with coded answers and lists an agent's models (#58): the phone offers the switch. */
  models?: true;
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
    const message: Extract<PhoneServerMessage, { type: 'snapshot' }> = {
    type: 'snapshot', protocol: PHONE_PROTOCOL, sessions: deps.sessions().filter(s => !isArchived(s)).map(s => projected(deviceId, s)), capabilities: capabilities(), daemon: { version: deps.version, boot: deps.boot, name: clip(hostname(), 40).text, ...(teamsOps ? { teams: true as const } : {}), ...(deps.pc?.canUpdate ? { update: true as const } : {}), ...(deps.pc?.canRestart ? { restart: true as const } : {}) },
    device: { confirm: deps.credential(deviceId) !== null, push, ...(deps.chats ? { chat: true as const } : {}), ...(deps.contextNear ? { contextNear: deps.contextNear() } : {}) }
    };
    // The daemon takes `session.model` and lists an agent's models (#58).
    return deps.models ? { ...message, daemon: { ...message.daemon, models: true } } : message;
  };

  const phoneTeams = () => (deps.teams?.() ?? []).flatMap(t => { const x = toPhoneTeam(t, deps.tasks?.() ?? [], deps.projectName ?? (() => null)); return x ? [x] : []; });
  const phoneTask = (x: Task): PhoneTask => toPhoneTask(x, deps.session(x.owner), x.team ? deps.teams?.().find(t => t.id === x.team)?.name : undefined);
  /** After a snapshot: the teams and Ledge's tasks, for a daemon that has them. */
  const teamsAndTasks = (deviceId: string) => {
    if (!deps.teams || !deps.tasks) return;
    push(deviceId, { type: 'teams', teams: phoneTeams() }, 'teams');
    push(deviceId, { type: 'tasks', tasks: phoneTasks(deps.tasks(), Date.now()).map(phoneTask) }, 'tasks');
  };

  const outbox = createOutbox({
    send: (deviceId, text) => mobile.send(deviceId, text),
    onGone: deviceId => {
      log(`phone: device ${deviceId} gone`);
      followers.delete(deviceId);
    },
    onOverflow: deviceId => {
      if (followers.get(deviceId)?.subscribed) { outbox.push(deviceId, snapshot(deviceId), 'snapshot'); teamsAndTasks(deviceId); }
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
  const result = (deviceId: string, op: string, status: OperationStatus, reason?: OperationReason, models?: PhoneSeatModel[]) => {
    // A device revoked while its operation ran hears nothing more.
    if (stopped || !approved(deviceId)) return;
    push(deviceId, { type: 'operation.result', op, status, ...(reason ? { reason } : {}), ...(models ? { models } : {}) });
  };

  /** The operations that act on a tracked session: the registry's own, the credential's, the device's and the chat's are handled before it. */
  type SessionOperation = Exclude<PhoneOperation, { type: 'credential.register' | 'device.forget' | 'push.subscribe' | 'push.unsubscribe' | 'chat.relay' | 'chat.launch' | 'chat.close' | 'chat.act' | 'chat.ignore' | 'chat.team' | 'chat.task' | 'team.resume' | 'task.seen' | 'daemon.update' | 'daemon.restart' | (typeof TEAMS_OPERATION_TYPES)[number] }>;
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
  const checkAssertion = (deviceId: string, assertion: NonNullable<Extract<PhoneOperation, { type: 'session.decide' }>['assertion']> | undefined, purpose: 'decide' | 'launch' | 'close' | 'act' | 'define' | 'team' | 'pc', subject: string | undefined): Outcome | undefined => {
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
    // A row destructive by its args (`team.save` over an existing template) is checked as one the registry marks (§5.3).
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

  /** The turn's team card (roles spec §3.8): like a launch card, the device's check over the turn first. */
  const chatTeam = async (deviceId: string, msg: Extract<PhoneOperation, { type: 'chat.team' }>): Promise<Outcome> => {
    const turn = ownTurn(deviceId, msg.qid);
    if (!turn?.team || !deps.teams) return { status: 'rejected', reason: 'unknown_session' };
    if (turn.ignoredAt) return SET_ASIDE;
    if (turn.team.teamId) return { status: 'failed' };
    if (deps.credential(deviceId) === null) return { status: 'rejected', reason: 'confirm_required' };
    const refused = launchAssertionOutcome(deviceId, msg.qid, msg.assertion);
    if (refused) return refused;
    const rid = msg.op;
    return ask({ type: 'team.launch', rid, qid: msg.qid }, m => (m.type === 'team.launched' && m.rid === rid ? true : m.type === 'team.failed' && m.rid === rid ? false : undefined));
  };
  const chatTask = async (deviceId: string, msg: Extract<PhoneOperation, { type: 'chat.task' }>): Promise<Outcome> => {
    const turn = ownTurn(deviceId, msg.qid);
    const card = turn?.tasks?.[msg.row];
    if (!card || !deps.tasks) return { status: 'rejected', reason: 'unknown_session' };
    if (turn!.ignoredAt) return SET_ASIDE;
    if ((card.text?.length ?? 0) > TOOL_TEXT_MAX) return { status: 'rejected', reason: 'invalid' };
    if (card.taskId) return { status: 'failed' };
    const rid = msg.op;
    return ask({ type: 'task.cmd', rid, by: LEDGE_GIVER, op: 'give', qid: msg.qid, row: msg.row }, m => (m.type === 'task.result' && m.rid === rid ? m.task !== undefined : undefined));
  };

  /** « Ignorer » the device's own turn, or `undo` (« Revoir »). */
  const chatIgnore = (deviceId: string, msg: Extract<PhoneOperation, { type: 'chat.ignore' }>): Outcome => {
    if (!ownTurn(deviceId, msg.qid) || !deps.chats) return { status: 'rejected', reason: 'unknown_session' };
    const why = deps.chats.device(deviceId).ignore(msg.qid, msg.undo === true, emitterOf(deviceId));
    return why === null ? { status: 'applied' } : { status: 'rejected', reason: 'invalid' };
  };

  /** The phone's roles and teams: only for a daemon that serves them (`teamCatalog`) and names its projects. */
  const teamsOps = deps.teamCatalog && deps.projectByName ? createTeamsOps({
    dispatch: deps.dispatch, projectByName: deps.projectByName, projectName: deps.projectName ?? (() => null), checkAssertion, ask, push: (deviceId, m) => push(deviceId, m), log
  }) : undefined;

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

  const run = async (deviceId: string, msg: PhoneOperation): Promise<Outcome> => {
    if (msg.type === 'daemon.update' || msg.type === 'daemon.restart') return pcOperation(deviceId, msg);
    if (isTeamsOperation(msg)) return teamsOps ? teamsOps.run(deviceId, msg) : { status: 'rejected', reason: 'unavailable' };
    if (msg.type === 'chat.ignore') return chatIgnore(deviceId, msg);
    if (msg.type === 'chat.team') return chatTeam(deviceId, msg);
    if (msg.type === 'chat.task') return chatTask(deviceId, msg);
    if (msg.type === 'team.resume') return deps.teams ? ask({ type: 'team.resume', team: msg.team }, () => undefined) : { status: 'rejected', reason: 'unavailable' };
    if (msg.type === 'task.seen') {
      if (!deps.tasks) return { status: 'rejected', reason: 'unavailable' };
      const rid = msg.op;
      return ask({ type: 'task.cmd', rid, by: LEDGE_GIVER, op: 'seen', task: msg.task }, m => (m.type === 'task.result' && m.rid === rid ? m.task !== undefined : undefined));
    }
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
    if (begun.kind === 'replay') return result(deviceId, msg.op, begun.record.status, begun.record.reason, begun.record.models);
    let outcome: Outcome;
    try {
      result(deviceId, msg.op, 'received');
      outcome = await run(deviceId, msg);
    }
    catch (e) {
      log(`phone ${msg.type} failed (${e instanceof Error ? e.name : 'error'})`);
      outcome = { status: 'failed' };
    }
    registry.finish(msg.op, outcome.status, outcome.reason, outcome.models);
    result(deviceId, msg.op, outcome.status, outcome.reason, outcome.models);
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
      case 'attachment.put': case 'attachment.get':
        void attachment(deviceId, msg);
        return;
      case 'chat.ask': case 'chat.cancel': case 'chat.reset': case 'chat.history':
        if (!deps.chats) return push(deviceId, { type: 'error', code: 'invalid', request: msg.type });
        void chatRead(deviceId, msg);
        return;
      case 'teams.catalog':
        if (!teamsOps) return push(deviceId, { type: 'error', code: 'invalid', request: msg.type });
        return teamsOps.catalog(deviceId);
      case 'teams.role':
        if (!teamsOps) return push(deviceId, { type: 'error', code: 'invalid', request: msg.type });
        return teamsOps.role(deviceId, msg);
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
        replayModelFailures(deviceId);
        return teamsAndTasks(deviceId);
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
        if (msg.purpose === 'launch') {
          if (msg.qid === undefined || !ownTurn(deviceId, msg.qid)) return invalid();
          const cred = deps.credential(deviceId);
          if (!cred || cred.rpId !== rp.rpId) return invalid();
          const challenge = deps.challenges.issue({ deviceId, purpose: 'launch', subject: msg.qid });
          return push(deviceId, { type: 'confirm.challenge', purpose: 'launch', challenge, rpId: rp.rpId, credentialId: cred.id, expiresInMs: CHALLENGE_TTL_MS });
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
        if (msg.purpose === 'define' || msg.purpose === 'team') {
          // Bound to the operation's digest: the phone computes it over what it will send, and a challenge covers nothing else.
          if (!teamsOps || msg.digest === undefined) return invalid();
          const cred = deps.credential(deviceId);
          if (!cred || cred.rpId !== rp.rpId) return invalid();
          const challenge = deps.challenges.issue({ deviceId, purpose: msg.purpose, subject: msg.digest });
          // The digest is echoed: a phone that superseded a call finds this challenge's own among the late ones.
          return push(deviceId, { type: 'confirm.challenge', purpose: msg.purpose, challenge, rpId: rp.rpId, credentialId: cred.id, expiresInMs: CHALLENGE_TTL_MS, digest: msg.digest });
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
    if (stopped) return;
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
      if (((request !== undefined && (TEAMS_OPERATION_TYPES as readonly string[]).includes(request)) || request === 'push.subscribe' || request === 'chat.launch' || request === 'chat.close' || request === 'chat.act' || request === 'chat.ignore' || request === 'chat.team' || request === 'chat.task' || request === 'team.resume' || request === 'task.seen') && op.success && approved(deviceId)) return push(deviceId, { type: 'operation.result', op: op.data, status: 'rejected', reason: 'invalid' });
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
      if (!stopped) try { keepModelFailure(m); } catch (e) { log(`phone model failure of ${m.type} failed (${e instanceof Error ? e.name : 'error'})`); }
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
          case 'team.updated': {
            const teams = phoneTeams();
            for (const [deviceId, f] of followers) if (f.subscribed) push(deviceId, { type: 'teams', teams }, 'teams');
            return;
          }
          case 'task.updated': {
            if (m.task.giver !== LEDGE_GIVER) return;
            const task = phoneTask(m.task);
            for (const [deviceId, f] of followers) if (f.subscribed) push(deviceId, { type: 'task.updated', task });
            // Ledge's progress on its team moves with it.
            if (m.task.team) { const teams = phoneTeams(); for (const [deviceId, f] of followers) if (f.subscribed) push(deviceId, { type: 'teams', teams }, 'teams'); }
            return;
          }
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
