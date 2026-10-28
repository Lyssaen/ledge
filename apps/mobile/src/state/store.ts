// The phone's state: what the PC said about its sessions, kept up to date from the link, and what this phone asked
// of it. Every write is an operation named by a uuid, sent again with that same uuid after a lost connection.
import { useSyncExternalStore } from 'react';
import {
  PhoneClientMessageSchema, teamsDigest, teamsPurpose, type Assertion, type AttachmentRef, type CapabilitiesByTool, type Credential, type ImageUpload, type PhoneClientMessage, type PhonePending, type PhoneServerMessage,
  type PhoneCatalog, type PhoneRole, type PhoneSession, type PhoneTask, type PhoneTeam, type PushSubscription, type TeamsOperation, type ThreadItem
} from '@ledge/protocol';
import type { PhoneLink } from '../link/link';
import { getAssertion } from '../link/webauthn';
import { createImages } from './images';
import { asked, emptyChat, reduceChat, type ChatAction, type ChatState } from './chat';
import { clearOps, expectKey, isLive, isNew, loadOps, newOperationId, pruneOps, resendable, saveOps, UNCERTAIN_MS, type Op, type OpMessage } from './operations';
import { clearLastState, loadLastState, loadReads, saveLastState, saveReads } from './persist';

/** `loading`: asked, not answered yet. `gone`: the PC no longer knows the session. */
export interface ThreadState {
  status: 'loading' | 'ready' | 'gone';
  items: ThreadItem[];
  /** The ids of the items the PC shortened. */
  cut: string[];
  /** Older items were left out. */
  more: boolean;
}

export interface MobileState {
  /** In the PC's order. */
  sessions: Map<string, PhoneSession>;
  threads: Map<string, ThreadState>;
  /** The last lines of each session's terminal. */
  previews: Map<string, string[]>;
  /** Null until the first snapshot of this run: they are not kept on the phone. */
  capabilities: CapabilitiesByTool | null;
  /** What the PC offers for confirming on the device; null until a snapshot, and from a PC that says nothing (lot 5). */
  device: { confirm: boolean; push?: 'on' | 'off' | 'stale' | 'unavailable'; chat?: true; contextNear?: number } | null;
  daemon: { version: string; name: string } | null;
  /** True from a snapshot until the channel is lost: what is shown is the PC's state now, not the last known one. */
  fresh: boolean;
  /** When the PC last said something about its sessions. */
  syncedAt: string | null;
  ops: Record<string, Op>;
  /** The PC's live teams with the progress of Ledge's tasks; null from a PC that sends none (ledge home spec §2.4). */
  teams: PhoneTeam[] | null;
  /** The tasks Ledge gave, by id: the open ones and those closed lately, not put away. Never cached. */
  tasks: Map<string, PhoneTask>;
  /** The roles and team definitions the PC offers, with the repositories a project can name; null until asked and answered. Never cached across reloads. */
  catalog: PhoneCatalog | null;
}

/** The request a challenge is asked for, as `session.decide` names it. */
export type PhoneExpect = Extract<PhoneClientMessage, { type: 'session.decide' }>['expect'];
export type ConfirmChallenge = Extract<PhoneServerMessage, { type: 'confirm.challenge' }>;
export type ConfirmRequest = { purpose: 'register' } | { purpose: 'decide'; id: string; expect: PhoneExpect } | { purpose: 'launch'; qid: string } | { purpose: 'close'; qid: string }
  | { purpose: 'define' | 'team'; digest: string };

type WithoutAuth<M> = M extends unknown ? Omit<M, 'op' | 'assertion'> : never;
/** A role or team-definition write, as `role.write` and the others name it, before the phone gives it an `op` and the passkey's `assertion`. */
export type DefineRequest = WithoutAuth<Extract<TeamsOperation, { type: 'role.write' | 'role.delete' | 'template.write' | 'template.delete' }>>;
/** A live-team change (launch, composition, seat, dissolve), before its `op` and `assertion`. */
export type TeamRequest = WithoutAuth<Extract<TeamsOperation, { type: 'team.launch' | 'team.compose' | 'team.seat' | 'team.dissolve' }>>;
/** The role a `teams.role` read names. */
export interface RoleRef { scope: 'home' | 'repo'; project?: string; id: string }

/** How long `prepareConfirm` waits for the PC's challenge. */
export const PREPARE_MS = 10_000;
/** How long « Se déconnecter » waits for the PC to confirm that it removed this phone. */
export const FORGET_MS = 5_000;

export type Answer = Extract<PhoneClientMessage, { type: 'session.answer' }>['answers'][number];

/** The request a challenge was prepared for: what the confirmed operation carries as its `expect`, never rebuilt from the current state. */
export interface ConfirmedExpect { key: string; kind: PhonePending['kind']; text: string }

export type Decision = Extract<PhoneClientMessage, { type: 'session.decide' }>['decision'];

export interface MobileStore {
  getState(): MobileState;
  subscribe(fn: () => void): () => void;
  /** Answers the session's request. The op's id, or null when nothing was sent (no request, not ready, already answered). */
  decide(id: string, decision: Decision, opts?: { note?: string; assertion?: Assertion; expect?: ConfirmedExpect }): string | null;
  /** An answer to the session's request when there is one, else an instruction. The op's id, or null when nothing was sent. */
  reply(id: string, text: string, opts?: { assertion?: Assertion; expect?: ConfirmedExpect; attachments?: string[] }): string | null;
  /** Stores an image on the PC, one at a time (the next goes once the previous is answered). Rejects with the server's `reason`, `timeout` or `offline`. */
  putImage(image: ImageUpload): Promise<AttachmentRef>;
  /** An object URL for a stored image (its preview when `preview`); one request in flight across all calls, cached per (id, preview), a failure not cached. */
  imageUrl(id: string, preview: boolean): Promise<string>;
  /** The ref of an image this device stored. */
  knownImage(id: string): AttachmentRef | undefined;
  /**
   * Asks the PC for a challenge; resolves on the next `confirm.challenge` of that purpose. Rejects (Error message
   * `error`, `timeout` after `PREPARE_MS`, `not_ready`, `superseded`, `lost`). One is pending at a time: a new call supersedes the old one.
   */
  prepareConfirm(req: ConfirmRequest): Promise<ConfirmChallenge>;
  /** Asks the PC for the catalog; it comes back as `teams.catalog` and lands in `getState().catalog`. */
  requestCatalog(): void;
  /**
   * The whole role, when the catalog cut its prompt. Resolves on the PC's next `teams.role` of that role; rejects
   * (Error message `error` when the PC has no such role, `timeout` after `PREPARE_MS`, `not_ready`, `lost`).
   */
  readRole(r: RoleRef): Promise<PhoneRole>;
  /**
   * Writes or deletes a role or a team definition, after the device's confirmation: the challenge is for the digest of `req` as it
   * is when this is called, so a challenge prepared for other content never carries this one. Asks for the catalog again once applied.
   */
  define(req: DefineRequest): Promise<ChatAction>;
  /** Launches, recomposes, starts a seat of, or dissolves a live team, after the device's confirmation (same as `define`). */
  teamOp(req: TeamRequest): Promise<ChatAction>;
  /** Answers the questions of OMP's dialog `requestId` together, or declines it (`cancel`). The op's id, or null when nothing was sent. */
  answer(id: string, requestId: string, answers: Answer[], opts: { expect: PhoneExpect; cancel?: boolean }): string | null;
  /** Registers the passkey with the PC. The op's id, or null when nothing was sent. */
  registerCredential(c: Credential): string | null;
  interrupt(id: string): string | null;
  /** Gives the PC this phone's push subscription and the VAPID key it was made with. The op's id, or null when nothing was sent. */
  pushSubscribe(subscription: PushSubscription, key: string): string | null;
  /** Asks the PC to stop notifying this phone. The op's id, or null when nothing was sent. */
  pushUnsubscribe(): string | null;
  /** Says whether the app is in front (a read, not an operation); said again after every ready. */
  presence(visible: boolean): void;
  /** Marks the session read up to `at` (now by default); the latest mark is sent again after every ready. */
  read(id: string, at?: string): void;
  /** Asks the session's thread; its items then come as the PC pushes them, while the session is watched. */
  openThread(id: string): void;
  /** The session whose thread or terminal the phone shows, or null. */
  watch(id: string | null): void;
  /** Asks the session's request with its whole body. */
  loadPending(id: string): void;
  /**
   * Tells the PC to remove this phone (`device.forget`, not kept as an operation: the state it would belong to is
   * about to be erased) and resolves true on its `applied`. False at once when the link is not ready, and after
   * `FORGET_MS` without an answer, or when the link drops first.
   */
  forgetDevice(): Promise<boolean>;
  /** The phone's chat with Ledge; the same object until it changes. */
  chat(): ChatState;
  /**
   * Asks Ledge a question: the turn shows at once. Returns its qid. Offline, nothing is sent and `chat().error` is
   * `offline` with the text; if the PC is busy the turn goes again and `error` is `busy` with the text.
   */
  ask(text: string, attachments?: string[]): string;
  /** Stops the question being answered. */
  cancelAsk(): void;
  /** Starts the thread over. */
  resetChat(): void;
  clearChatError(): void;
  /** Sends the turn's instruction to its session; resolves when the operation is final. */
  relay(qid: string): Promise<ChatAction>;
  /** Launches the turn's proposals (`rows`, or all of them), after the device's confirmation. */
  launch(qid: string, rows?: number[]): Promise<ChatAction>;
  /** Closes the turn's sessions (`rows`, or all of them), after the device's confirmation. (Not `close`: that stops the store.) */
  closeSessions(qid: string, rows?: number[]): Promise<ChatAction>;
  /** Launches the turn's team (roles spec §3.8), after the device's confirmation like a launch card. */
  launchTeam(qid: string): Promise<ChatAction>;
  /** Gives the turn's task `row` to its seat, in Ledge's name. */
  giveTask(qid: string, row: number): Promise<ChatAction>;
  /** Wakes a resting team. */
  resumeTeam(team: string): Promise<ChatAction>;
  /** Puts away a closed task Ledge gave: it leaves « À toi » and « À traiter ». */
  seeTask(task: string): Promise<ChatAction>;
  /** Stops listening to the link and every timer. */
  close(): void;
}

/** The full body of a request stays when a shortened copy of the same request comes later. */
function keepBody(prev: PhonePending | undefined, next: PhoneSession): PhoneSession {
  const p = next.pending;
  if (!p?.cut || !prev?.body || prev.key === '' || prev.key !== p.key) return next;
  return (prev.body.length > (p.body?.length ?? 0)) ? { ...next, pending: prev } : next;
}

export function createStore(link: PhoneLink, storage?: Storage): MobileStore {
  const last = loadLastState(storage);
  let state: MobileState = {
    sessions: new Map((last?.sessions ?? []).map(s => [s.id, s])),
    threads: new Map(),
    previews: new Map(Object.entries(last?.previews ?? {})),
    capabilities: null,
    device: null,
    daemon: last?.daemon ?? null,
    fresh: false,
    syncedAt: last?.syncedAt ?? null,
    ops: loadOps(storage),
    teams: null,
    tasks: new Map(),
    catalog: null
  };
  let reads = loadReads(storage);
  /** The PC's boot id of this run, from its snapshot; null until one, and when the PC sends none. Never cached. */
  let boot: string | null = null;
  /** What the phone last said about its app being in front; said again after every ready. */
  let visible: boolean | null = null;
  /** The last thread opened: asked again after every ready. */
  let lastThread: string | null = null;
  /**
   * The `session.thread` requests not answered yet, oldest first. The PC answers in order, and its `unknown_session`
   * error names no session: it is about the oldest one.
   */
  let threadAsks: string[] = [];
  /** A preview changed since the cache was last written. */
  let previewsDirty = false;
  let closed = false;
  let chatState: ChatState = emptyChat();
  /** `chat.history` was asked since the last ready; the snapshot of a first connection asks it when the ready could not. */
  let historyAsked = false;
  /** The questions asked since the last ready: only these may be newer than a history reply. */
  const askedSinceReady = new Set<string>();
  const expirers = new Set<() => void>();
  /** The relay or launch of a turn that is under way, shared by a second tap. */
  const chatActions = new Map<string, Promise<ChatAction>>();
  /** The `prepareConfirm` waiting for its challenge. */
  let preparing: { purpose: ConfirmChallenge['purpose']; resolve: (c: ConfirmChallenge) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  const settle = (outcome: ConfirmChallenge | Error) => {
    const p = preparing;
    if (!p) return;
    preparing = null;
    clearTimeout(p.timer);
    if (outcome instanceof Error) p.reject(outcome); else p.resolve(outcome);
  };
  /** The `readRole`s waiting for their role, oldest first: the PC answers in order, and its `invalid` error names no role. */
  let roleReads: { ref: RoleRef; resolve: (r: PhoneRole) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  const endRead = (read: (typeof roleReads)[number], outcome: PhoneRole | Error) => {
    roleReads = roleReads.filter(r => r !== read);
    clearTimeout(read.timer);
    if (outcome instanceof Error) read.reject(outcome); else read.resolve(outcome);
  };
  const endReads = (e: Error) => { for (const r of [...roleReads]) endRead(r, e); };
  /** The `forgetDevice` waiting for its result. */
  type Forgetting = { op: string; resolve: (applied: boolean) => void; timer: ReturnType<typeof setTimeout>; promise: Promise<boolean> };
  let forgetting: Forgetting | null = null;
  const settleForget = (applied: boolean) => {
    const f = forgetting;
    if (!f) return;
    forgetting = null;
    clearTimeout(f.timer);
    f.resolve(applied);
  };
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();

  const ready = () => link.state() === 'ready';
  const send = (m: PhoneClientMessage) => { void link.send(m).catch(() => undefined); };

  const images = createImages(m => { if (closed || !ready()) return false; send(m); return true; });

  const notify = () => { for (const fn of [...listeners]) fn(); };
  const setChat = (c: ChatState) => { chatState = c; notify(); };
  const askHistory = () => { historyAsked = true; send({ type: 'chat.history' }); };
  const set = (patch: Partial<MobileState>) => { state = { ...state, ...patch }; notify(); };
  const persist = () => {
    previewsDirty = false;
    saveLastState({
      sessions: [...state.sessions.values()], previews: Object.fromEntries(state.previews), daemon: state.daemon, syncedAt: state.syncedAt
    }, storage);
  };
  const setOps = (ops: Record<string, Op>) => {
    const kept = pruneOps(ops);
    saveOps(kept, storage);
    set({ ops: kept });
  };
  const patchOp = (id: string, f: (o: Op) => Op) => {
    const o = state.ops[id];
    if (o) setOps({ ...state.ops, [id]: f(o) });
  };

  const stopTimer = (id: string) => { clearTimeout(timers.get(id)); timers.delete(id); };
  const arm = (id: string) => {
    stopTimer(id);
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      if (state.ops[id]?.phase === 'sending') patchOp(id, o => ({ ...o, phase: 'uncertain' }));
    }, UNCERTAIN_MS));
  };

  const askThread = (id: string) => { threadAsks.push(id); send({ type: 'session.thread', id }); };
  const setThread = (id: string, t: ThreadState) => set({ threads: new Map(state.threads).set(id, t) });
  const gone = (threads: Map<string, ThreadState>, id: string) => {
    const t = threads.get(id);
    if (t) threads.set(id, { ...t, status: 'gone' });
  };

  /** Sends again the uncertain operations `pick` keeps and `resendable` allows, oldest first, each as itself. */
  function resend(pick: (o: Op) => boolean) {
    const now = Date.now();
    const live = Object.values(state.ops).filter(o => pick(o) && resendable(o, boot, now)).sort((a, b) => a.at.localeCompare(b.at));
    if (!live.length) return;
    const ops = { ...state.ops };
    for (const o of live) ops[o.op] = { ...o, phase: 'sending' };
    setOps(ops);
    for (const o of live) { send(o.message); arm(o.op); }
  }

  function onReady() {
    // Every operation whose outcome is unknown goes again with its own op: the PC applies it once, and answers it again.
    // An instruction or interrupt too old to be sent again stays uncertain (see RESEND_MAX_MS). Only the answers to a
    // request go now; the others wait for the snapshot, which tells whether the PC restarted (`resendUnnamed`).
    resend(o => expectKey(o.message) !== undefined);
    for (const [id, at] of Object.entries(reads)) send({ type: 'session.read', id, at });
    if (visible !== null) send({ type: 'presence', visible });
    if (lastThread && state.threads.get(lastThread)?.status !== 'gone') askThread(lastThread);
    historyAsked = false;
    askedSinceReady.clear();
    if (state.device?.chat) askHistory();
  }

  function onLost() {
    historyAsked = false;
    askedSinceReady.clear();
    settleForget(false);
    // Requests sent on the lost channel get no answer.
    threadAsks = [];
    settle(new Error('lost'));
    endReads(new Error('lost'));
    images.lost();
    for (const id of [...timers.keys()]) stopTimer(id);
    const ops = Object.values(state.ops).filter(o => o.phase === 'sending');
    if (ops.length) setOps({ ...state.ops, ...Object.fromEntries(ops.map(o => [o.op, { ...o, phase: 'uncertain' as const }])) });
    if (state.fresh) set({ fresh: false });
  }

  function onMessage(m: PhoneServerMessage) {
    const now = new Date().toISOString();
    switch (m.type) {
      case 'snapshot': {
        const sessions = new Map(m.sessions.map(s => [s.id, keepBody(state.sessions.get(s.id)?.pending, s)]));
        const previews = new Map([...state.previews].filter(([id]) => sessions.has(id)));
        const threads = new Map(state.threads);
        for (const id of threads.keys()) if (!sessions.has(id)) gone(threads, id);
        reads = Object.fromEntries(Object.entries(reads).filter(([id]) => sessions.has(id)));
        saveReads(reads, storage);
        boot = m.daemon.boot ?? null;
        set({ sessions, previews, threads, capabilities: m.capabilities, device: m.device ?? null, daemon: m.daemon, fresh: true, syncedAt: now });
        persist();
        // The instructions and interrupts left uncertain (those in flight on this link are `sending`) go again if this PC may not have applied them.
        if (ready()) resend(o => o.phase === 'uncertain' && expectKey(o.message) === undefined);
        if (m.device?.chat && !historyAsked && ready()) askHistory();
        return;
      }
      case 'attachment.stored': case 'attachment.data': case 'attachment.error':
        images.handle(m);
        return;
      case 'teams':
        set({ teams: m.teams });
        return;
      case 'teams.catalog':
        set({ catalog: m.catalog });
        return;
      case 'teams.role': {
        const read = roleReads.find(r => r.ref.id === m.role.id && r.ref.scope === m.role.scope && (r.ref.project ?? null) === m.role.project);
        if (read) endRead(read, m.role);
        return;
      }
      case 'tasks':
        set({ tasks: new Map(m.tasks.map(x => [x.id, x])) });
        return;
      case 'task.updated':
        set({ tasks: new Map(state.tasks).set(m.task.id, m.task) });
        return;
      case 'session.updated': {
        const sessions = new Map(state.sessions).set(m.session.id, keepBody(state.sessions.get(m.session.id)?.pending, m.session));
        set({ sessions, syncedAt: now });
        persist();
        return;
      }
      case 'session.removed': {
        const sessions = new Map(state.sessions);
        sessions.delete(m.id);
        const previews = new Map(state.previews);
        previews.delete(m.id);
        const threads = new Map(state.threads);
        gone(threads, m.id);
        if (m.id in reads) { const { [m.id]: _drop, ...rest } = reads; reads = rest; saveReads(reads, storage); }
        set({ sessions, previews, threads, syncedAt: now });
        persist();
        return;
      }
      case 'session.pending': {
        const s = state.sessions.get(m.id);
        if (!s) return;
        set({ sessions: new Map(state.sessions).set(m.id, { ...s, pending: m.pending }) });
        persist();
        return;
      }
      case 'session.preview':
        // A watched terminal sends these often: the cache takes them with its next write, or at close.
        set({ previews: new Map(state.previews).set(m.id, m.lines) });
        previewsDirty = true;
        return;
      case 'session.thread': {
        const at = threadAsks.indexOf(m.id);
        if (at >= 0) threadAsks.splice(at, 1);
        setThread(m.id, { status: 'ready', items: m.items, cut: m.cut, more: m.more });
        return;
      }
      case 'session.thread.item': {
        const t = state.threads.get(m.id);
        if (!t || t.status === 'gone') return;
        const at = t.items.findIndex(i => i.id === m.item.id);
        const items = at < 0 ? [...t.items, m.item] : t.items.map((i, n) => n === at ? m.item : i);
        const cut = t.cut.filter(id => id !== m.item.id).concat(m.cut ? [m.item.id] : []);
        setThread(m.id, { ...t, items, cut });
        return;
      }
      case 'operation.result': {
        if (forgetting?.op === m.op) {
          if (m.status !== 'received') settleForget(m.status === 'applied');
          return;
        }
        const o = state.ops[m.op];
        if (!o || !isLive(o.phase)) return;
        if (m.status === 'received') {
          // The PC has it and always sends its outcome after. Should that never come while the link holds, the op
          // stays `sending` until the link drops (then uncertain); an instruction or interrupt stops blocking the
          // next one once older than RESEND_MAX_MS (isNew), an answer once its request is gone.
          stopTimer(m.op);
          patchOp(m.op, x => ({ ...x, phase: 'sending', received: true, ...(boot ? { boot } : {}) }));
          return;
        }
        stopTimer(m.op);
        const { reason: _old, ...rest } = o;
        patchOp(m.op, () => ({ ...rest, received: true, ...(boot ? { boot } : {}), phase: m.status as Op['phase'], ...(m.status !== 'applied' && m.reason ? { reason: m.reason } : {}) }));
        // The request changed under this answer: ask for the one there now, with its body.
        if (m.status === 'rejected' && m.reason === 'stale' && ready() && o.message.type.startsWith('session.') && 'id' in o.message && typeof o.message.id === 'string') send({ type: 'session.pending', id: o.message.id });
        return;
      }
      case 'chat.history': case 'chat.step': case 'chat.delta': case 'chat.done': case 'chat.error':
        setChat(reduceChat(chatState, m, askedSinceReady));
        return;
      case 'confirm.challenge':
        if (preparing?.purpose === m.purpose) settle(m);
        return;
      case 'error':
        if (m.request === 'teams.role') { const read = roleReads[0]; if (read) endRead(read, new Error('error')); return; }
        // A refused catalog read is not about the challenge being prepared.
        if (m.request === 'teams.catalog') return;
        settle(new Error('error'));
        if (m.code === 'unknown_session' && m.request === 'session.thread') {
          const id = threadAsks.shift();
          if (id !== undefined) setThread(id, { items: [], cut: [], more: false, ...state.threads.get(id), status: 'gone' });
        }
        return;
    }
  }

  function write(build: (op: string) => OpMessage): string | null {
    if (closed || !ready()) return null;
    const parsed = PhoneClientMessageSchema.safeParse(build(newOperationId()));
    // A message the PC would refuse as invalid gets an error, not an operation result: it is never sent.
    if (!parsed.success || !('op' in parsed.data)) return null;
    const message = parsed.data as OpMessage;
    if (!isNew(state.ops, message, boot)) return null;
    setOps({ ...state.ops, [message.op]: { op: message.op, message, phase: 'sending', at: new Date().toISOString() } });
    send(message);
    arm(message.op);
    return message.op;
  }

  /** Resolves when the operation is final; an op that was dropped, or stays uncertain for good, is `expired`. */
  function finalOf(op: string): Promise<ChatAction> {
    return new Promise<ChatAction>(resolve => {
      const check = (): boolean => {
        const o = state.ops[op];
        let out: ChatAction | null = null;
        if (!o) out = { status: 'expired' };
        else if (o.phase === 'applied' || o.phase === 'failed') out = { status: o.phase };
        else if (o.phase === 'rejected') out = { status: 'rejected', reason: o.reason ?? 'invalid' };
        else if (o.phase === 'uncertain' && !resendable(o, boot)) out = { status: 'expired' };
        if (!out) return false;
        off();
        resolve(out);
        return true;
      };
      const expire = () => { off(); resolve({ status: 'expired' }); };
      const off = () => { listeners.delete(check); expirers.delete(expire); };
      listeners.add(check);
      expirers.add(expire);
      check();
    });
  }

  /**
   * A role, template or live-team operation behind the passkey. `req` is copied and hashed now, at the call: the challenge is
   * prepared for that digest, and the operation written after the passkey is that same copy. A later call for other content
   * supersedes this one's challenge (`prepareConfirm`), and a challenge never stands for content it was not prepared for.
   */
  async function confirmedOperation(req: DefineRequest | TeamRequest): Promise<ChatAction> {
    // A phone without a passkey cannot confirm: the PC would refuse, and no prompt is worth showing.
    if (!state.device?.confirm) return { status: 'rejected', reason: 'confirm_required' };
    const frozen = structuredClone(req);
    let digest: string;
    // `teamsDigest` refuses what the PC would refuse: nothing is asked, nothing is sent.
    try { digest = await teamsDigest(frozen); }
    catch { return { status: 'rejected', reason: 'invalid' }; }
    let challenge: ConfirmChallenge;
    try { challenge = await store.prepareConfirm({ purpose: teamsPurpose(frozen.type), digest }); }
    catch (e) { return { status: e instanceof Error && e.message === 'timeout' ? 'expired' : 'failed' }; }
    if (!challenge.credentialId) return { status: 'rejected', reason: 'confirm_required' };
    const at = Date.now();
    const signed = await getAssertion({ challenge: challenge.challenge, rpId: challenge.rpId, credentialId: challenge.credentialId }).catch(() => 'failed' as const);
    if (signed === 'cancelled') return { status: 'cancelled' };
    if (signed === 'failed') return { status: 'failed' };
    if (Date.now() - at >= challenge.expiresInMs) return { status: 'expired' };
    const op = write(o => ({ ...frozen, op: o, assertion: signed }));
    // The link dropped after the passkey: the PC never got it, so the screen stays as it was and can be tapped again.
    return op === null ? { status: 'expired' } : finalOf(op);
  }

  /** One relay or launch per turn at a time: a second tap shares the first. */
  function chatAction(key: string, run: () => Promise<ChatAction>): Promise<ChatAction> {
    const held = chatActions.get(key);
    if (held) return held;
    const p = run().finally(() => { chatActions.delete(key); });
    chatActions.set(key, p);
    return p;
  }

  const expectOf = (p: PhonePending) => ({ key: p.key, kind: p.kind, text: p.text });

  /** The link has no PC any more (forgotten, or pairing a new one): nothing of the old PC is kept or sent again. */
  function forget() {
    const held = chatState.turns.length || chatState.live || chatState.error || state.sessions.size || state.threads.size || state.previews.size || state.daemon || state.capabilities
      || state.device || state.syncedAt || state.teams || state.catalog || state.tasks.size || Object.keys(state.ops).length || Object.keys(reads).length || lastThread !== null;
    if (!held) return;
    for (const id of [...timers.keys()]) stopTimer(id);
    reads = {};
    boot = null;
    lastThread = null;
    threadAsks = [];
    historyAsked = false;
    chatState = emptyChat();
    settle(new Error('lost'));
    endReads(new Error('lost'));
    previewsDirty = false;
    clearLastState(storage);
    clearOps(storage);
    set({ sessions: new Map(), threads: new Map(), previews: new Map(), capabilities: null, device: null, daemon: null, fresh: false, syncedAt: null, ops: {}, teams: null, tasks: new Map(), catalog: null });
  }

  let wasReady = ready();
  const offState = link.subscribe(() => {
    const at = link.state();
    if (at === 'unpaired' || at === 'pairing') forget();
    const now = ready();
    if (now && !wasReady) { wasReady = true; onReady(); }
    else if (!now && wasReady) { wasReady = false; onLost(); }
  });
  const offMessage = link.onMessage(onMessage);
  // Operations left uncertain by the last page are sent again as soon as they can be.
  if (wasReady) onReady();

  const store: MobileStore = {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },

    decide(id, decision, opts = {}) {
      // An explicit expect is the request the user confirmed: used as is, the PC says whether it is still the one pending.
      const p = state.sessions.get(id)?.pending;
      const expect = opts.expect ?? (p?.key ? expectOf(p) : null);
      if (!expect) return null;
      return write(op => ({ type: 'session.decide', op, id, decision, ...(opts.note !== undefined ? { note: opts.note } : {}), expect, ...(opts.assertion ? { assertion: opts.assertion } : {}) }));
    },

    reply(id, text, opts = {}) {
      const s = state.sessions.get(id);
      if (!s) return null;
      // The PC refuses an empty instruction: only images make one without text.
      if (!text && !opts.attachments?.length) return null;
      // A request without a key cannot be named: the PC would refuse the reply either way.
      if (!opts.expect && s.pending && !s.pending.key) return null;
      const expect = opts.expect ?? (s.pending ? expectOf(s.pending) : null);
      return write(op => ({ type: 'session.reply', op, id, text, ...(opts.attachments?.length ? { attachments: opts.attachments } : {}), expect, ...(opts.assertion ? { assertion: opts.assertion } : {}) }));
    },

    answer(id, requestId, answers, opts) {
      if (!state.sessions.has(id)) return null;
      return write(op => ({ type: 'session.answer', op, id, requestId, answers, ...(opts.cancel ? { cancel: true as const } : {}), expect: opts.expect }));
    },

    prepareConfirm(req) {
      return new Promise<ConfirmChallenge>((resolve, reject) => {
        if (closed || !ready()) { reject(new Error('not_ready')); return; }
        const m = PhoneClientMessageSchema.safeParse({ type: 'confirm.prepare', ...req });
        if (!m.success) { reject(new Error('invalid')); return; }
        settle(new Error('superseded'));
        preparing = { purpose: req.purpose, resolve, reject, timer: setTimeout(() => settle(new Error('timeout')), PREPARE_MS) };
        send(m.data);
      });
    },

    requestCatalog() { if (!closed && ready()) send({ type: 'teams.catalog' }); },

    readRole(ref) {
      return new Promise<PhoneRole>((resolve, reject) => {
        if (closed || !ready()) { reject(new Error('not_ready')); return; }
        const m = PhoneClientMessageSchema.safeParse({ type: 'teams.role', scope: ref.scope, ...(ref.project !== undefined ? { project: ref.project } : {}), id: ref.id });
        if (!m.success) { reject(new Error('invalid')); return; }
        const read = { ref, resolve, reject, timer: setTimeout(() => endRead(read, new Error('timeout')), PREPARE_MS) };
        roleReads.push(read);
        send(m.data);
      });
    },

    define: req => confirmedOperation(req).then(done => { if (done.status === 'applied') store.requestCatalog(); return done; }),

    teamOp: req => confirmedOperation(req),

    registerCredential(c) {
      return write(op => ({ type: 'credential.register', op, credential: c }));
    },

    forgetDevice() {
      if (closed || !ready()) return Promise.resolve(false);
      // A second call while one waits shares it: one device.forget, one answer.
      if (forgetting) return forgetting.promise;
      let entry!: Forgetting;
      const promise = new Promise<boolean>(resolve => {
        const op = newOperationId();
        entry = { op, resolve, timer: setTimeout(() => settleForget(false), FORGET_MS), promise: null as unknown as Promise<boolean> };
        send({ type: 'device.forget', op });
      });
      entry.promise = promise;
      forgetting = entry;
      return promise;
    },

    interrupt(id) {
      if (!state.sessions.has(id)) return null;
      return write(op => ({ type: 'session.interrupt', op, id }));
    },

    pushSubscribe(subscription, key) {
      return write(op => ({ type: 'push.subscribe', op, subscription, key }));
    },

    pushUnsubscribe() {
      return write(op => ({ type: 'push.unsubscribe', op }));
    },

    presence(v) {
      if (closed) return;
      visible = v;
      if (ready()) send({ type: 'presence', visible: v });
    },

    read(id, at = new Date().toISOString()) {
      if (closed) return;
      const m = PhoneClientMessageSchema.safeParse({ type: 'session.read', id, at });
      if (!m.success) return;
      const prev = reads[id];
      if (prev && Date.parse(prev) >= Date.parse(at)) return;
      reads = { ...reads, [id]: at };
      saveReads(reads, storage);
      const s = state.sessions.get(id);
      if (s?.unread) {
        set({ sessions: new Map(state.sessions).set(id, { ...s, unread: false }) });
        persist();
      }
      if (ready()) send(m.data);
    },

    openThread(id) {
      if (closed) return;
      lastThread = id;
      const t = state.threads.get(id);
      setThread(id, { items: t?.items ?? [], cut: t?.cut ?? [], more: t?.more ?? false, status: 'loading' });
      if (ready()) askThread(id);
    },

    watch(id) { if (!closed) send({ type: 'session.watch', id }); },

    loadPending(id) { if (!closed && ready()) send({ type: 'session.pending', id }); },

    chat: () => chatState,

    putImage: image => images.putImage(image),
    imageUrl: (id, preview) => images.imageUrl(id, preview),
    knownImage: id => images.knownImage(id),

    ask(text, attachments = []) {
      const qid = newOperationId();
      const m = PhoneClientMessageSchema.safeParse({ type: 'chat.ask', qid, text, ...(attachments.length ? { attachments } : {}) });
      if (!m.success || m.data.type !== 'chat.ask') { setChat({ ...chatState, error: { code: 'failed', qid, text } }); return qid; }
      if (closed || !ready()) { setChat({ ...chatState, error: { code: 'offline', text: m.data.text } }); return qid; }
      askedSinceReady.add(qid);
      const refs = attachments.flatMap(id => images.knownImage(id) ?? []);
      setChat(asked(chatState, { qid, question: m.data.text, askedAt: new Date().toISOString(), steps: [], ...(refs.length ? { attachments: refs } : {}) }));
      send(m.data);
      return qid;
    },

    cancelAsk() {
      const qid = chatState.live?.qid;
      if (qid && !closed) send({ type: 'chat.cancel', qid });
    },

    resetChat() {
      if (closed) return;
      setChat(emptyChat());
      if (ready()) { send({ type: 'chat.reset' }); send({ type: 'chat.history' }); }
    },

    clearChatError() { if (chatState.error) setChat({ ...chatState, error: null }); },

    relay(qid) {
      return chatAction(`relay:${qid}`, async () => {
        const op = write(o => ({ type: 'chat.relay', op: o, qid }));
        return op === null ? { status: 'failed' } : finalOf(op);
      });
    },

    launch(qid, rows) {
      return chatAction(`launch:${qid}:${rows?.join(',') ?? '*'}`, async () => {
        // A phone without a passkey cannot confirm: the PC would refuse, and no prompt is worth showing.
        if (!state.device?.confirm) return { status: 'rejected', reason: 'confirm_required' };
        let challenge: ConfirmChallenge;
        try { challenge = await store.prepareConfirm({ purpose: 'launch', qid }); }
        catch (e) { return { status: e instanceof Error && e.message === 'timeout' ? 'expired' : 'failed' }; }
        if (!challenge.credentialId) return { status: 'rejected', reason: 'confirm_required' };
        const at = Date.now();
        const signed = await getAssertion({ challenge: challenge.challenge, rpId: challenge.rpId, credentialId: challenge.credentialId }).catch(() => 'failed' as const);
        if (signed === 'cancelled') return { status: 'cancelled' };
        if (signed === 'failed') return { status: 'failed' };
        // Good for a minute: after that the PC would only refuse it.
        if (Date.now() - at >= challenge.expiresInMs) return { status: 'expired' };
        const op = write(o => ({ type: 'chat.launch', op: o, qid, ...(rows ? { rows } : {}), assertion: signed }));
        // The link dropped after the passkey: the PC never got it, so the card stays as it was and can be tapped again.
        return op === null ? { status: 'expired' } : finalOf(op);
      });
    },

    closeSessions(qid, rows) {
      return chatAction(`close:${qid}:${rows?.join(',') ?? '*'}`, async () => {
        // A phone without a passkey cannot confirm: the PC would refuse, and no prompt is worth showing.
        if (!state.device?.confirm) return { status: 'rejected', reason: 'confirm_required' };
        let challenge: ConfirmChallenge;
        try { challenge = await store.prepareConfirm({ purpose: 'close', qid }); }
        catch (e) { return { status: e instanceof Error && e.message === 'timeout' ? 'expired' : 'failed' }; }
        if (!challenge.credentialId) return { status: 'rejected', reason: 'confirm_required' };
        const at = Date.now();
        const signed = await getAssertion({ challenge: challenge.challenge, rpId: challenge.rpId, credentialId: challenge.credentialId }).catch(() => 'failed' as const);
        if (signed === 'cancelled') return { status: 'cancelled' };
        if (signed === 'failed') return { status: 'failed' };
        // Good for a minute: after that the PC would only refuse it.
        if (Date.now() - at >= challenge.expiresInMs) return { status: 'expired' };
        const op = write(o => ({ type: 'chat.close', op: o, qid, ...(rows ? { rows } : {}), assertion: signed }));
        // The link dropped after the passkey: the PC never got it, so the card stays as it was and can be tapped again.
        return op === null ? { status: 'expired' } : finalOf(op);
      });
    },

    launchTeam(qid) {
      return chatAction(`team:${qid}`, async () => {
        // Like a launch card: a phone without a passkey cannot confirm, the PC would refuse.
        if (!state.device?.confirm) return { status: 'rejected', reason: 'confirm_required' };
        let challenge: ConfirmChallenge;
        try { challenge = await store.prepareConfirm({ purpose: 'launch', qid }); }
        catch (e) { return { status: e instanceof Error && e.message === 'timeout' ? 'expired' : 'failed' }; }
        if (!challenge.credentialId) return { status: 'rejected', reason: 'confirm_required' };
        const at = Date.now();
        const signed = await getAssertion({ challenge: challenge.challenge, rpId: challenge.rpId, credentialId: challenge.credentialId }).catch(() => 'failed' as const);
        if (signed === 'cancelled') return { status: 'cancelled' };
        if (signed === 'failed') return { status: 'failed' };
        if (Date.now() - at >= challenge.expiresInMs) return { status: 'expired' };
        const op = write(o => ({ type: 'chat.team', op: o, qid, assertion: signed }));
        return op === null ? { status: 'expired' } : finalOf(op);
      });
    },

    giveTask(qid, row) {
      return chatAction(`task:${qid}:${row}`, async () => {
        const op = write(o => ({ type: 'chat.task', op: o, qid, row }));
        return op === null ? { status: 'failed' } : finalOf(op);
      });
    },

    resumeTeam(team) {
      return chatAction(`resume:${team}`, async () => {
        const op = write(o => ({ type: 'team.resume', op: o, team }));
        return op === null ? { status: 'failed' } : finalOf(op);
      });
    },

    seeTask(task) {
      return chatAction(`seen:${task}`, async () => {
        const op = write(o => ({ type: 'task.seen', op: o, task }));
        return op === null ? { status: 'failed' } : finalOf(op);
      });
    },

    close() {
      if (closed) return;
      closed = true;
      for (const expire of [...expirers]) expire();
      settleForget(false);
      settle(new Error('lost'));
      endReads(new Error('lost'));
      images.close();
      if (previewsDirty) persist();
      offState();
      offMessage();
      for (const id of [...timers.keys()]) stopTimer(id);
      listeners.clear();
    }
  };
  return store;
}

/** The chat in a component, re-rendered when it changes. */
export function useChat(store: MobileStore): ChatState {
  return useSyncExternalStore(store.subscribe, store.chat);
}

/** The store's state in a component, re-rendered on every change. */
export function useMobile(store: MobileStore): MobileState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
