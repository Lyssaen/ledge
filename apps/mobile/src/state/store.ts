// The phone's state: what the PC said about its sessions, kept up to date from the link, and what this phone asked
// of it. Every write is an operation named by a uuid, sent again with that same uuid after a lost connection.
import { useSyncExternalStore } from 'react';
import {
  PhoneClientMessageSchema, type Assertion, type DeviceKind, type DevicePrefs, type PcAction, type PhoneFolder, type PhoneLaunch, type OperationReason, type ProjectColor, type AttachmentRef, type CapabilitiesByTool, type Credential, type ImageUpload, type PhoneClientMessage, type PhonePending, type PhoneServerMessage,
  type ModelRefusal, type PhoneChecklist, type PhoneModelChoice, type PhoneProject, type PhoneRigRow, type PhoneSlashCommand, type PhoneSession, type PhoneTask, type PushSubscription, type ThreadItem, type BrainChoice, type PhoneHarnessUsage, type HumanAsk, type HumanAnswer, type HumanChannel, type OpenRigAction
} from '@ledge/protocol';
import type { PhoneLink } from '../link/link';
import { getAssertion } from '../link/webauthn';
import { actionChecked } from '../model/actionCard';
import { adoptRuns } from '../model/sessionEnd';
import { createImages } from './images';
import { asked, emptyChat, reduceChat, type ChatAction, type ChatState } from './chat';
import { PC_STALL_MS, pcFailed, pcProgress, pcRunning, pcSnapshot, type PcRun } from './pc';
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
  /** `id`, `kind`, `name`: this device as the PC knows it (absent from an older PC; `name` absent: none given yet). */
  device: { confirm: boolean; /** Its passkey can bring it back after a reinstall: without it, « Mettre à jour la passkey ». */ recover?: true; push?: 'on' | 'off' | 'stale' | 'unavailable'; chat?: true; contextNear?: number; id?: string; kind?: DeviceKind; name?: string; /** This device's own settings (`daemon.settings`). */ prefs?: DevicePrefs } | null;
  /** `update`: the PC can install a version and restart; `restart`: it can restart (both absent from daemons before 0.27.0). */
  daemon: { version: string; name: string; boot?: string; models?: true; update?: true; restart?: true; checklist?: true; sessionClose?: true; terminal?: true; terminalInput?: true; commands?: true; /** Takes `session.broadcast` (« Écrire au groupe »). */ broadcast?: true; /** Answers `openrig.row`. */ rigRows?: true; /** Sends `projects` and places sessions in them: the iPad's Atelier. */ atelier?: true; /** Takes `device.prefs` and `context.set` (Réglages). */ settings?: true; /** Takes `project.*` (Réglages › Projets). */ projectEdit?: true; /** Browses its folders and adds them to projects. */ projectFolders?: true; /** Sends `usage.state`. */ usage?: true; /** Answers `openrig.asks` (« À toi »). */ openrig?: true; /** Answers the `rigs.*` reads and takes their actions (M4, the Rigs tab). */ rigs?: true; /** Takes `session.launch` (« Nouvelle session »). */ launch?: true } | null;
  /** The user's projects, in their order (`daemon.atelier`): the Atelier's rooms. Kept for an offline start; empty from an older PC. */
  projects: PhoneProject[];
  /** The models each agent offers on the PC, by tool, as `models.listing` said; kept for the link's life, reset when the PC boots again. `error`: the agent could not be asked. */
  models: Record<string, { models: PhoneModelChoice[]; error?: true }>;
  /** The slash commands of each session's agent, by session id, as `session.commands.listing` said; `at` when they came. `error`: they could not be read. */
  commands: Record<string, { commands: PhoneSlashCommand[]; error?: true; at: number }>;
  /** OpenRig's queue rows, by id, as `openrig.rowState` said (a task card's live state); `at` when it came. No `row`: not read. */
  rigRows: Record<string, { row?: PhoneRigRow; error?: string; at: number }>;
  /** The last folder of this PC the phone browsed (`folder.list`), as the PC answered; null until one is asked. Never cached. */
  folderListing: Extract<PhoneServerMessage, { type: 'folder.listing' }> | null;
  /** The folders of this PC its agents worked in lately (`folder.recents`); null until asked. Never cached. */
  recentFolders: string[] | null;
  /** Each project's folders as `project.folders` said, by project id (`gone`: the PC no longer has it). Never cached. */
  projectFolders: Record<string, PhoneFolder[] | 'gone'>;
  /** Why the last model change of a session failed after the PC accepted it, by session id. Kept until a new change is sent or the session's model or effort changes. */
  modelFailures: Record<string, ModelRefusal>;
  /** True from a snapshot until the channel is lost: what is shown is the PC's state now, not the last known one. */
  fresh: boolean;
  /** When the PC last said something about its sessions. */
  syncedAt: string | null;
  ops: Record<string, Op>;
  /** The tasks Ledge gave, by id: the open ones and those closed lately, not put away. Never cached. */
  tasks: Map<string, PhoneTask>;
  /** Each session's full checklist, as `session.checklist` sent it (null: it has none now). Never cached. */
  checklists: Map<string, PhoneChecklist | null>;
  /** The PC's daemon updating or restarting, as this phone follows it; null when nothing runs nor just ended. Never cached. */
  pc: PcRun | null;
  /** This PC's harness limits (`usage.state`, `daemon.usage`): null until it sends them. Never cached. */
  usage: PhoneHarnessUsage[] | null;
  /** The usage alert threshold the PC keeps (`usage.state`'s `prefs.alert`): past it a window is amber and in « À toi ». */
  usageAlert: number | null;
  /** What OpenRig on this PC asks the person (`openrig.asks`, `daemon.openrig`): null until it sends them. Never cached. */
  asks: HumanAsk[] | null;
  /** Whether OpenRig can reach the person through Ledge, as the last `openrig.asks` said; null until then. `partial`: a read failed, the
   *  list may miss some; `truncated`: the PC left the least pressing out to fit the phone's message. Never cached. */
  asksChannel: { channel: HumanChannel; partial: boolean; truncated: boolean } | null;
}

/** The request a challenge is asked for, as `session.decide` names it. */
export type PhoneExpect = Extract<PhoneClientMessage, { type: 'session.decide' }>['expect'];
/**
 * How a « Nouvelle session » got on (m2-sessions.html §9): `sent` once the PC has it, its outcome then in `ops[op]`; or why
 * nothing left: the check cancelled, refused (`assertion_invalid`) or too slow (`assertion_expired`), no passkey here
 * (`confirm_required`), no challenge in time (`noAnswer`), or anything else (`failed`).
 */
export type LaunchStart = { status: 'sent'; op: string } | { status: 'cancelled' } | { status: 'noAnswer' } | { status: 'failed' } | { status: 'rejected'; reason: OperationReason };
export type ConfirmChallenge = Extract<PhoneServerMessage, { type: 'confirm.challenge' }>;
export type ConfirmRequest = { purpose: 'register' } | { purpose: 'decide'; id: string; expect: PhoneExpect } | { purpose: 'launch'; qid: string } | { purpose: 'launch'; launch: PhoneLaunch } | { purpose: 'close'; qid: string }
  /** A turn's generic card (`chat.act`). */
  | { purpose: 'act'; qid: string }
  /** A session's own close (`session.close`) or resume (`session.resume`). */
  | { purpose: 'close' | 'act'; id: string }
  /** Taking the hand on a session's terminal (`term.hold`). */
  | { purpose: 'terminal'; id: string }
  | { purpose: 'pc'; action: 'update'; version: string } | { purpose: 'pc'; action: 'restart' }
  /** A « yes » to a proposal about the notes (`brain.answer`), bound to that exact choice. */
  | { purpose: 'note'; task: string; choice: BrainChoice }
  /** Deleting a project (`project.delete`), bound to it and to where its agents go. */
  | { purpose: 'project'; project: string; moveTo: string | null }
  /** Adding a folder of this PC to a project (`project.folder.add`), bound to both. */
  | { purpose: 'folder'; project: string; path: string }
  /** An answer to an OpenRig ask (`openrig.answer`), bound to that row and that exact answer. */
  | { purpose: 'rig'; qitem: string; answer: HumanAnswer }
  /** An OpenRig action that stops something or drops the prompts (`rigs.act`), or a change of seats that removes one (`rigs.seats`), bound to it. */
  | { purpose: 'rigs'; rigAct: OpenRigAction } | { purpose: 'rigs'; rigSeats: { rig: string; seats: Record<string, number> } };

/** How long `prepareConfirm` waits for the PC's challenge. */
export const PREPARE_MS = 10_000;
/** How long « Se déconnecter » waits for the PC to confirm that it removed this phone. */
export const FORGET_MS = 5_000;
/** How long a session's slash commands are shown again without asking (the PC keeps its own, and sees a commands folder change). */
export const COMMANDS_KEEP_MS = 2 * 60_000;

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
  /** Asks the PC for the models of an agent, once per tool per link (again after an `error` listing); they land in `getState().models`. */
  requestModels(tool: string): void;
  /** Asks the PC for a session's slash commands; again after an `error` listing, or once `COMMANDS_KEEP_MS` has passed. They land in `getState().commands`. */
  requestCommands(id: string): void;
  /** Asks the PC for a queue row's state (`daemon.rigRows`), once at a time per row; it lands in `getState().rigRows`. */
  requestRigRow(qitem: string): void;
  /** Changes a live session's model and effort (`null`: the agent's own default). Resolves when the PC answers; a late failure lands in `getState().modelFailures`. */
  changeModel(id: string, model: string | null, effort: string | null): Promise<ChatAction>;
  /** Writes one message to several sessions at once (at most 32). Resolves when the PC answers, with who got it (`sent`, names) and who did not. */
  broadcast(sessions: string[], text: string): Promise<ChatAction & { sent?: string[]; refused?: { name: string; reason: string }[] }>;
  /**
   * Installs `version` on the PC then restarts its daemon (`update`), or restarts it alone (`restart`), after the device's
   * confirmation. Once applied, `getState().pc` follows it until the PC comes back with it, refuses, or `PC_STALL_MS` passes.
   */
  pcAction(action: PcAction, version?: string): Promise<ChatAction>;
  /** Forgets an update or a restart that ended (done or failed). */
  dismissPc(): void;
  /** Answers the questions of OMP's dialog `requestId` together, or declines it (`cancel`). The op's id, or null when nothing was sent. */
  answer(id: string, requestId: string, answers: Answer[], opts: { expect: PhoneExpect; cancel?: boolean }): string | null;
  /**
   * Answers an OpenRig ask (`openrig.answer`): a choice, words, « Vu », or the words that settle a row parked on the person. Every answer
   * but « Vu » carries the device's assertion over that exact answer. The op's id, or null when nothing was sent (not ready, a PC without
   * `daemon.openrig`, an answer to that ask still on its way). Its end lands on the op (`rig`).
   */
  answerAsk(qitemId: string, answer: HumanAnswer, opts?: { assertion?: Assertion }): string | null;
  /** Sends again, as itself, this phone's answer to the ask `qitemId` whose outcome is unknown: the PC applies it once. False when there is none. */
  resendAsk(qitemId: string): boolean;
  /** Registers the passkey with the PC. The op's id, or null when nothing was sent. */
  /** `userId`: the passkey's `user.id`, base64url (« L1 » ‖ the PC key's digest ‖ random), so the PC marks it `recover`. */
  registerCredential(c: Credential, userId?: string): string | null;
  /** The pinned PC's public key, the one a passkey made now names; null when unpaired. */
  pcKey(): string | null;
  /** The pinned PC's name, as its snapshots gave it; null when unknown. */
  pcName(): string | null;
  /** Names this device on the PC (`device.rename`); its next snapshot carries the name. The op's id, or null when nothing was sent. */
  renameDevice(name: string): string | null;
  /** Stores this device's own settings on the PC, whole (`device.prefs`); its next snapshot carries them. Resolves when the PC answers. */
  setDevicePrefs(prefs: DevicePrefs): Promise<ChatAction>;
  /** Sets the PC's « Contexte max », shared with every front (`context.set`). Resolves when the PC answers. */
  setContextNear(near: number): Promise<ChatAction>;
  /** Renames or recolours a project (`project.edit`); its folders stay as the PC has them. Resolves when the PC answers. */
  editProject(id: string, change: { name?: string; color?: ProjectColor }): Promise<ChatAction>;
  /** Puts the projects in this order, every one of them once (`project.order`). Resolves when the PC answers. */
  orderProjects(ids: string[]): Promise<ChatAction>;
  /** Creates an empty project, named by the PC (`project.create`). Resolves when the PC answers. */
  createProject(name: string, color: ProjectColor): Promise<ChatAction>;
  /** Deletes a project after the device's check; its agents, folders and rules go to `moveTo`, or nowhere (null). */
  deleteProject(id: string, moveTo: string | null): Promise<ChatAction>;
  /** Asks the PC for the subfolders of `path` (its home without one); the answer lands in `getState().folderListing`. */
  listFolder(path?: string): void;
  /** Asks the PC for its recent folders; they land in `getState().recentFolders`. */
  requestRecentFolders(): void;
  /** Asks the PC for a project's folders; they land in `getState().projectFolders`. */
  requestProjectFolders(id: string): void;
  /** Adds a folder of this PC to a project after the device's check. Resolves when the PC answers. */
  addFolder(id: string, path: string): Promise<ChatAction>;
  /** Removes a folder (of any machine) from a project. Resolves when the PC answers. */
  removeFolder(id: string, machine: string, path: string): Promise<ChatAction>;
  interrupt(id: string): string | null;
  /** Closes the session (`session.close`) with the device's assertion over it. The op's id, or null when nothing was sent (not ready, a close already on its way). */
  sessionClose(id: string, assertion: Assertion): string | null;
  /** Starts the ended session again on its conversation (`session.resume`), as `sessionClose`. */
  sessionResume(id: string, assertion: Assertion): string | null;
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
  /** Takes the turn's queued instruction back (the PC's « Annuler »); resolves when the operation is final. */
  cancelRelay(qid: string): Promise<ChatAction>;
  /** Launches the turn's proposals (`rows`, or all of them), after the device's confirmation. */
  launch(qid: string, rows?: number[]): Promise<ChatAction>;
  /** « Nouvelle session » (§9): the device's check over this very launch, then `session.launch`. */
  launchSession(launch: PhoneLaunch): Promise<LaunchStart>;
  /** « Réessayer » after no answer: the same launch again, same op and assertion, so the PC never starts two (contract §6). False when it cannot go. */
  launchAgain(op: string): boolean;
  /**
   * Whether `launchAgain` may send this launch now: the PC's current boot is known (a snapshot since the link came back), it is
   * the boot the launch was first sent to, and `resendable` allows it. A launch sent before the PC restarted (received or
   * not), or one past the replay window, may have started a session that nothing reports now: sent again, the new process
   * would refuse it as if the first had been refused.
   */
  canLaunchAgain(op: string): boolean;
  /** Closes the turn's sessions (`rows`, or all of them), after the device's confirmation. (Not `close`: that stops the store.) */
  closeSessions(qid: string, rows?: number[]): Promise<ChatAction>;
  /** Applies rows of the turn's generic card (action registry spec §9.2), in order; the device's check first when one of them
   *  asks for it. `deny`: « Refuser » a session's request instead, with no check. */
  act(qid: string, rows: number[], o?: { deny?: true }): Promise<ChatAction>;
  /** « Ignorer » the turn's cards on every device, or `undo` (« Revoir »). */
  ignoreTurn(qid: string, undo?: true): Promise<ChatAction>;
  /** Gives the turn's task `row` to its session, in Ledge's name. */
  giveTask(qid: string, row: number): Promise<ChatAction>;
  /** Puts away a closed task Ledge gave: it leaves « À toi » and « À traiter ». */
  seeTask(task: string): Promise<ChatAction>;
  /** Answers a proposal about the notes from « Le point »: a « yes » asks for the device's check over that exact choice. */
  answerNote(task: string, choice: BrainChoice): Promise<ChatAction>;
  /** Stops listening to the link and every timer. */
  close(): void;
}

/** The full body of a request stays when a shortened copy of the same request comes later. */
function keepBody(prev: PhonePending | undefined, next: PhoneSession): PhoneSession {
  const p = next.pending;
  if (!p?.cut || !prev?.body || prev.key === '' || prev.key !== p.key) return next;
  return (prev.body.length > (p.body?.length ?? 0)) ? { ...next, pending: prev } : next;
}

/** The failures that stand: those of a session whose model or effort did not change, and that is still there. `modelNext` changing does not clear one. */
function failuresKept(failures: Record<string, ModelRefusal>, before: Map<string, PhoneSession>, after: Map<string, PhoneSession>): Record<string, ModelRefusal> {
  const kept = Object.entries(failures).filter(([id]) => {
    const a = after.get(id), b = before.get(id);
    return a !== undefined && (b === undefined || (a.model === b.model && a.effort === b.effort));
  });
  return kept.length === Object.keys(failures).length ? failures : Object.fromEntries(kept);
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
    projects: last?.projects ?? [],
    models: {},
    commands: {},
    rigRows: {},
    modelFailures: {},
    folderListing: null,
    recentFolders: null,
    projectFolders: {},
    fresh: false,
    syncedAt: last?.syncedAt ?? null,
    ops: loadOps(storage),
    tasks: new Map(),
    usage: null,
    usageAlert: null,
    asks: null,
    asksChannel: null,
    checklists: new Map(),
    pc: null
  };
  let reads = loadReads(storage);
  /** The tools whose model list was asked on this link and boot; an `error` listing is asked again. */
  const modelAsks = new Set<string>();
  /** The sessions whose commands were asked on this link and not answered yet. */
  const commandAsks = new Set<string>();
  /** The rows asked on this link and not answered yet: one read in flight per row. */
  const rigAsks = new Set<string>();
  /** The PC's boot id of this run, from its snapshot; null until one, and when the PC sends none. Never cached. */
  let boot: string | null = null;
  /** Ends a followed update or restart the PC never came back from: armed by the first step, cleared at the end. */
  let pcTimer: ReturnType<typeof setTimeout> | null = null;
  function watchPc() {
    if (pcTimer !== null || !pcRunning(state.pc)) return;
    pcTimer = setTimeout(() => {
      pcTimer = null;
      if (pcRunning(state.pc)) set({ pc: { ...state.pc, step: 'failed', reason: 'timeout' } });
    }, PC_STALL_MS);
  }
  function stopPcWatch() {
    if (pcTimer !== null) clearTimeout(pcTimer);
    pcTimer = null;
  }
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
  let asksAsked = false;
  const askHistory = () => { historyAsked = true; send({ type: 'chat.history' }); };
  const set = (patch: Partial<MobileState>) => { state = { ...state, ...patch }; notify(); };
  const persist = () => {
    previewsDirty = false;
    saveLastState({
      sessions: [...state.sessions.values()], previews: Object.fromEntries(state.previews), daemon: state.daemon, syncedAt: state.syncedAt, projects: state.projects
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

  /** A close sent while its session started takes the run that start gave, as soon as the PC tells of it. */
  const adoptRunsOf = (sessions: PhoneSession[]) => {
    const ops = adoptRuns(state.ops, sessions);
    if (ops !== state.ops) setOps(ops);
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
    asksAsked = false;
    askedSinceReady.clear();
    if (state.device?.chat) askHistory();
  }

  function onLost() {
    historyAsked = false;
    asksAsked = false;
    askedSinceReady.clear();
    // A list asked on the lost channel never comes: it is asked again. Those already answered stay.
    for (const tool of [...modelAsks]) if (!state.models[tool]) modelAsks.delete(tool);
    commandAsks.clear();
    rigAsks.clear();
    settleForget(false);
    // Requests sent on the lost channel get no answer.
    threadAsks = [];
    settle(new Error('lost'));
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
        // A new boot is a new PC process: what it offered may differ.
        const bootChanged = (m.daemon.boot ?? null) !== boot;
        boot = m.daemon.boot ?? null;
        if (bootChanged) { modelAsks.clear(); commandAsks.clear(); rigAsks.clear(); }
        const pc = pcSnapshot(state.pc, m.daemon);
        if (!pcRunning(pc)) stopPcWatch();
        const checklists = new Map([...state.checklists].filter(([id]) => sessions.has(id)));
        set({ sessions, previews, threads, checklists, capabilities: m.capabilities, device: m.device ?? null, daemon: m.daemon, projects: m.projects ?? [], fresh: true, syncedAt: now, pc, modelFailures: failuresKept(state.modelFailures, state.sessions, sessions), ...(bootChanged ? { models: {}, commands: {} } : {}) });
        persist();
        // OpenRig's asks, once per link: the PC then pushes them whole at each change (the amber badge of « À toi »).
        if (m.daemon.openrig && !asksAsked && ready()) { asksAsked = true; send({ type: 'openrig.asks' }); }
        adoptRunsOf(m.sessions);
        // The instructions and interrupts left uncertain (those in flight on this link are `sending`) go again if this PC may not have applied them.
        if (ready()) resend(o => o.phase === 'uncertain' && expectKey(o.message) === undefined);
        if (m.device?.chat && !historyAsked && ready()) askHistory();
        return;
      }
      case 'attachment.stored': case 'attachment.data': case 'attachment.error':
        images.handle(m);
        return;
      case 'openrig.rowState':
        rigAsks.delete(m.qitem);
        set({ rigRows: { ...state.rigRows, [m.qitem]: { ...(m.row ? { row: m.row } : {}), ...(m.error ? { error: m.error } : {}), at: Date.now() } } });
        return;
      case 'folder.listing':
        set({ folderListing: m });
        return;
      case 'folder.recents':
        set({ recentFolders: m.paths });
        return;
      case 'project.folders':
        set({ projectFolders: { ...state.projectFolders, [m.id]: m.gone ? 'gone' : m.folders } });
        return;
      case 'session.commands.listing':
        commandAsks.delete(m.id);
        set({ commands: { ...state.commands, [m.id]: { commands: m.commands, ...(m.error ? { error: true as const } : {}), at: Date.now() } } });
        return;
      case 'models.listing':
        set({ models: { ...state.models, [m.tool]: { models: m.models, ...(m.error ? { error: true as const } : {}) } } });
        return;
      case 'session.model.failed':
        if (!state.sessions.has(m.id)) return;
        set({ modelFailures: { ...state.modelFailures, [m.id]: m.reason } });
        return;
      case 'daemon.progress':
        set({ pc: pcProgress(state.pc, m, boot) });
        watchPc();
        return;
      case 'daemon.failed': {
        const pc = pcFailed(state.pc, m);
        if (!pcRunning(pc)) stopPcWatch();
        set({ pc });
        return;
      }
      case 'projects':
        set({ projects: m.projects });
        persist();
        return;
      case 'tasks':
        set({ tasks: new Map(m.tasks.map(x => [x.id, x])) });
        return;
      case 'openrig.asks':
        set({ asks: m.asks, asksChannel: { channel: m.channel, partial: m.partial === true, truncated: m.truncated === true } });
        break;
      case 'openrig.answered': {
        // The answer's end comes before (or with) its operation's result: kept on the op, whatever its phase.
        const { type: _t, op: _o, qitemId: _q, ...end } = m;
        patchOp(m.op, o => ({ ...o, rig: end }));
        return;
      }
      case 'usage.state':
        set({ usage: m.harnesses, usageAlert: m.prefs.alert });
        return;
      case 'task.updated':
        set({ tasks: new Map(state.tasks).set(m.task.id, m.task) });
        return;
      case 'session.updated': {
        const sessions = new Map(state.sessions).set(m.session.id, keepBody(state.sessions.get(m.session.id)?.pending, m.session));
        set({ sessions, syncedAt: now, modelFailures: failuresKept(state.modelFailures, state.sessions, sessions) });
        persist();
        adoptRunsOf([m.session]);
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
        const checklists = new Map(state.checklists);
        checklists.delete(m.id);
        set({ sessions, previews, threads, checklists, syncedAt: now });
        persist();
        return;
      }
      case 'session.checklist':
        set({ checklists: new Map(state.checklists).set(m.id, m.checklist) });
        return;
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
        patchOp(m.op, () => ({ ...rest, received: true, ...(boot ? { boot } : {}), phase: m.status as Op['phase'], ...(m.reason ? { reason: m.reason } : {}), ...(m.how ? { how: m.how } : {}), ...(m.sent ? { sent: m.sent } : {}), ...(m.refused ? { refused: m.refused } : {}), ...(m.id ? { id: m.id } : {}) }));
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
        settle(new Error('error'));
        if (m.code === 'unknown_session' && m.request === 'session.thread') {
          const id = threadAsks.shift();
          if (id !== undefined) setThread(id, { items: [], cut: [], more: false, ...state.threads.get(id), status: 'gone' });
        }
        return;
    }
  }

  /** Sends an operation and keeps it; `keep` adds what the phone notes of it at the send. */
  function write(build: (op: string) => OpMessage, keep: Pick<Op, 'startedAt' | 'starting'> = {}): string | null {
    if (closed || !ready()) return null;
    const parsed = PhoneClientMessageSchema.safeParse(build(newOperationId()));
    // A message the PC would refuse as invalid gets an error, not an operation result: it is never sent.
    if (!parsed.success || !('op' in parsed.data)) return null;
    const message = parsed.data as OpMessage;
    if (!isNew(state.ops, message, boot)) return null;
    setOps({ ...state.ops, [message.op]: { op: message.op, message, phase: 'sending', at: new Date().toISOString(), ...(boot ? { sentBoot: boot } : {}), ...keep } });
    send(message);
    arm(message.op);
    return message.op;
  }

  /** A read of this PC's folders or of a project's, for a PC that offers them and a link that is ready. */
  function folderRead(msg: unknown): void {
    if (closed || !ready() || !state.daemon?.projectFolders) return;
    const m = PhoneClientMessageSchema.safeParse(msg);
    if (m.success) send(m.data);
  }

  /** A change of the projects (Réglages › Projets), for a PC that takes them; resolved with its outcome. */
  function projectOp(build: (op: string) => OpMessage): Promise<ChatAction> {
    if (!state.daemon?.projectEdit) return Promise.resolve({ status: 'rejected', reason: 'unavailable' });
    const op = write(build);
    return op === null ? Promise.resolve({ status: 'failed' }) : finalOf(op);
  }

  /** Resolves when the operation is final; an op that was dropped, or stays uncertain for good, is `expired`. */
  function finalOf(op: string): Promise<ChatAction> {
    return new Promise<ChatAction>(resolve => {
      const check = (): boolean => {
        const o = state.ops[op];
        let out: ChatAction | null = null;
        if (!o) out = { status: 'expired' };
        else if (o.phase === 'applied') out = { status: 'applied', ...(o.reason === 'scheduled' ? { scheduled: true as const } : {}) };
        else if (o.phase === 'failed') out = { status: 'failed' };
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

  /** Asks the challenge of `prep`, has the passkey sign it, then writes the operation `build` makes with that assertion. */
  async function signedOperation(prep: ConfirmRequest, build: (op: string, assertion: Assertion) => OpMessage): Promise<ChatAction> {
    let challenge: ConfirmChallenge;
    try { challenge = await store.prepareConfirm(prep); }
    catch (e) { return { status: e instanceof Error && e.message === 'timeout' ? 'expired' : 'failed' }; }
    if (!challenge.credentialId) return { status: 'rejected', reason: 'confirm_required' };
    const at = Date.now();
    const signed = await getAssertion({ challenge: challenge.challenge, rpId: challenge.rpId, credentialId: challenge.credentialId }).catch(() => 'failed' as const);
    if (signed === 'cancelled') return { status: 'cancelled' };
    if (signed === 'failed') return { status: 'failed' };
    if (Date.now() - at >= challenge.expiresInMs) return { status: 'expired' };
    const op = write(o => build(o, signed));
    // The link dropped after the passkey: the PC never got it, so the screen stays as it was and can be tapped again.
    // Nothing was sent (the link dropped after the passkey, or the message no longer parses): not an expired passkey, a failed attempt.
    return op === null ? { status: 'failed' } : finalOf(op);
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
      || state.device || state.syncedAt || Object.keys(state.models).length || Object.keys(state.modelFailures).length || state.tasks.size || Object.keys(state.ops).length || Object.keys(reads).length || lastThread !== null;
    if (!held) return;
    for (const id of [...timers.keys()]) stopTimer(id);
    reads = {};
    boot = null;
    lastThread = null;
    threadAsks = [];
    historyAsked = false;
    asksAsked = false;
    chatState = emptyChat();
    settle(new Error('lost'));
    previewsDirty = false;
    clearLastState(storage);
    clearOps(storage);
    set({ sessions: new Map(), threads: new Map(), previews: new Map(), capabilities: null, device: null, daemon: null, projects: [], fresh: false, syncedAt: null, ops: {}, tasks: new Map(), checklists: new Map(), pc: null, models: {}, commands: {}, rigRows: {}, modelFailures: {}, folderListing: null, recentFolders: null, projectFolders: {}, usage: null, usageAlert: null, asks: null, asksChannel: null });
    modelAsks.clear(); commandAsks.clear(); rigAsks.clear();
    stopPcWatch();
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

    answerAsk(qitemId, answer, opts = {}) {
      if (!state.daemon?.openrig) return null;
      // One answer to an ask at a time: a second tap while the first goes (or may have gone) sends nothing.
      if (Object.values(state.ops).some(o => o.message.type === 'openrig.answer' && o.message.qitemId === qitemId && isLive(o.phase))) return null;
      return write(op => ({ type: 'openrig.answer', op, qitemId, answer, ...(opts.assertion ? { assertion: opts.assertion } : {}) }));
    },

    resendAsk(qitemId) {
      const mine = (o: Op) => o.phase === 'uncertain' && o.message.type === 'openrig.answer' && o.message.qitemId === qitemId;
      if (!ready() || !Object.values(state.ops).some(mine)) return false;
      resend(mine);
      return true;
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

    requestCommands(id) {
      if (closed || !ready() || !state.daemon?.commands || commandAsks.has(id)) return;
      const kept = state.commands[id];
      if (kept && !kept.error && Date.now() - kept.at < COMMANDS_KEEP_MS) return;
      const m = PhoneClientMessageSchema.safeParse({ type: 'session.commands', id });
      if (!m.success) return;
      commandAsks.add(id);
      send(m.data);
    },

    requestRigRow(qitem) {
      if (closed || !ready() || !state.daemon?.rigRows || rigAsks.has(qitem)) return;
      const m = PhoneClientMessageSchema.safeParse({ type: 'openrig.row', qitem });
      if (!m.success) return;
      rigAsks.add(qitem);
      send(m.data);
    },

    requestModels(tool) {
      if (closed || !ready() || modelAsks.has(tool) && !state.models[tool]?.error) return;
      const m = PhoneClientMessageSchema.safeParse({ type: 'models.list', tool });
      if (!m.success) return;
      modelAsks.add(tool);
      send(m.data);
    },

    changeModel(id, model, effort) {
      const op = write(o => ({ type: 'session.model', op: o, id, model, effort }));
      if (op === null) return Promise.resolve({ status: 'failed' });
      // A new change answers the last failure: it is not shown against the one being tried.
      if (id in state.modelFailures) { const { [id]: _drop, ...rest } = state.modelFailures; set({ modelFailures: rest }); }
      return finalOf(op);
    },

    async broadcast(sessions, text) {
      const op = write(o => ({ type: 'session.broadcast', op: o, sessions, text }));
      if (op === null) return { status: 'failed' };
      const done = await finalOf(op);
      const o = state.ops[op];
      // Nobody reached is `failed` with the refusals still told.
      return o?.sent ? { ...done, sent: o.sent, refused: o.refused ?? [] } : done;
    },

    async pcAction(action, version) {
      if (!state.device?.confirm) return { status: 'rejected', reason: 'confirm_required' };
      const target = action === 'update' ? version : state.daemon?.version ?? '';
      if (target === undefined) return { status: 'rejected', reason: 'invalid' };
      const bootAsked = boot;
      const done = await signedOperation(
        action === 'update' ? { purpose: 'pc', action, version: target } : { purpose: 'pc', action },
        (o, assertion) => (action === 'update' ? { type: 'daemon.update', op: o, version: target, assertion } : { type: 'daemon.restart', op: o, assertion }));
      // The daemon's first step may have come before the answer: it is kept.
      if (done.status === 'applied' && !pcRunning(state.pc)) set({ pc: { action, version: target, boot: bootAsked, step: 'asked' } });
      if (done.status === 'applied') watchPc();
      return done;
    },

    dismissPc() {
      if (state.pc && !pcRunning(state.pc)) set({ pc: null });
    },

    renameDevice(name) {
      return write(op => ({ type: 'device.rename', op, name }));
    },

    setDevicePrefs(prefs) {
      if (!state.daemon?.settings) return Promise.resolve({ status: 'rejected', reason: 'unavailable' });
      const op = write(o => ({ type: 'device.prefs', op: o, prefs }));
      return op === null ? Promise.resolve({ status: 'failed' }) : finalOf(op);
    },

    editProject(id, change) {
      return projectOp(o => ({ type: 'project.edit', op: o, id, ...change }));
    },

    orderProjects(ids) {
      return projectOp(o => ({ type: 'project.order', op: o, ids }));
    },

    createProject(name, color) {
      return projectOp(o => ({ type: 'project.create', op: o, name, color }));
    },

    listFolder(path) {
      folderRead({ type: 'folder.list', ...(path !== undefined ? { path } : {}) });
    },

    requestRecentFolders() {
      folderRead({ type: 'folder.recents' });
    },

    requestProjectFolders(id) {
      folderRead({ type: 'project.folders', id });
    },

    async addFolder(id, path) {
      if (!state.daemon?.projectFolders) return { status: 'rejected', reason: 'unavailable' };
      if (!state.device?.confirm) return { status: 'rejected', reason: 'confirm_required' };
      return signedOperation({ purpose: 'folder', project: id, path }, (o, assertion) => ({ type: 'project.folder.add', op: o, id, path, assertion }));
    },

    removeFolder(id, machine, path) {
      if (!state.daemon?.projectFolders) return Promise.resolve({ status: 'rejected', reason: 'unavailable' });
      const op = write(o => ({ type: 'project.folder.remove', op: o, id, machine, path }));
      return op === null ? Promise.resolve({ status: 'failed' }) : finalOf(op);
    },

    async deleteProject(id, moveTo) {
      if (!state.daemon?.projectEdit) return { status: 'rejected', reason: 'unavailable' };
      if (!state.device?.confirm) return { status: 'rejected', reason: 'confirm_required' };
      return signedOperation({ purpose: 'project', project: id, moveTo }, (o, assertion) => ({ type: 'project.delete', op: o, id, moveTo, assertion }));
    },

    setContextNear(near) {
      if (!state.daemon?.settings) return Promise.resolve({ status: 'rejected', reason: 'unavailable' });
      const op = write(o => ({ type: 'context.set', op: o, near }));
      return op === null ? Promise.resolve({ status: 'failed' }) : finalOf(op);
    },

    registerCredential(c, userId) {
      return write(op => ({ type: 'credential.register', op, credential: c, ...(userId ? { userId } : {}) }));
    },

    pcKey: () => link.pinned()?.publicKey ?? null,
    pcName: () => link.pinned()?.name ?? state.daemon?.name ?? null,

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

    // Each keeps the session's `startedAt` as the PC gave it: a new one later says the session was started again since. A close
    // sent while the session starts is about the run that start gives: it takes that run's `startedAt` once seen (`adoptRuns`).
    sessionClose(id, assertion) {
      const s = state.sessions.get(id);
      if (!s) return null;
      return write(op => ({ type: 'session.close', op, id, assertion }), { startedAt: s.startedAt, ...(s.state === 'starting' ? { starting: true as const } : {}) });
    },

    sessionResume(id, assertion) {
      const s = state.sessions.get(id);
      if (!s) return null;
      return write(op => ({ type: 'session.resume', op, id, assertion }), { startedAt: s.startedAt });
    },

    pushSubscribe(subscription, key) {
      // `resolved`: this app's service worker shows the push that replaces a request's notification once it is answered elsewhere.
      return write(op => ({ type: 'push.subscribe', op, subscription, key, resolved: true }));
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

    cancelRelay(qid) {
      return chatAction(`relay-cancel:${qid}`, async () => {
        const op = write(o => ({ type: 'chat.relay.cancel', op: o, qid }));
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

    async launchSession(launch) {
      // A phone without a passkey cannot confirm: the PC would refuse, and no prompt is worth showing.
      if (!state.device?.confirm) return { status: 'rejected', reason: 'confirm_required' };
      let challenge: ConfirmChallenge;
      try { challenge = await store.prepareConfirm({ purpose: 'launch', launch }); }
      catch (e) { return { status: e instanceof Error && e.message === 'timeout' ? 'noAnswer' : 'failed' }; }
      if (!challenge.credentialId) return { status: 'rejected', reason: 'confirm_required' };
      const at = Date.now();
      const signed = await getAssertion({ challenge: challenge.challenge, rpId: challenge.rpId, credentialId: challenge.credentialId }).catch(() => 'failed' as const);
      if (signed === 'cancelled') return { status: 'cancelled' };
      if (signed === 'failed') return { status: 'rejected', reason: 'assertion_invalid' };
      if (Date.now() - at >= challenge.expiresInMs) return { status: 'rejected', reason: 'assertion_expired' };
      const op = write(o => ({ type: 'session.launch', op: o, launch, assertion: signed }));
      return op === null ? { status: 'failed' } : { status: 'sent', op };
    },

    canLaunchAgain(op) {
      const o = state.ops[op];
      return !closed && ready() && state.fresh && !!o && o.message.type === 'session.launch' && resendable(o, boot);
    },

    launchAgain(op) {
      const o = state.ops[op];
      if (!o || !store.canLaunchAgain(op)) return false;
      patchOp(op, x => ({ ...x, phase: 'sending' }));
      send(o.message);
      arm(op);
      return true;
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

    act(qid, rows, o) {
      return chatAction(`act:${qid}:${rows.join(',')}${o?.deny ? ':deny' : ''}`, async () => {
        const actions = chatState.turns.find(t => t.qid === qid)?.actions;
        if (!actions || rows.some(r => !actions[r])) return { status: 'rejected', reason: 'invalid' };
        if (o?.deny) {
          const op = write(w => ({ type: 'chat.act', op: w, qid, rows, deny: true }));
          return op === null ? { status: 'failed' } : finalOf(op);
        }
        const todo = rows.map(r => actions[r]!);
        const confirmed = todo.some(a => a.risk === 'destructive') ? { confirmed: true as const } : {};
        if (!todo.some(actionChecked)) {
          const op = write(w => ({ type: 'chat.act', op: w, qid, rows, ...confirmed }));
          return op === null ? { status: 'failed' } : finalOf(op);
        }
        // A phone without a passkey cannot confirm: the PC would refuse, and no prompt is worth showing.
        if (!state.device?.confirm) return { status: 'rejected', reason: 'confirm_required' };
        return signedOperation({ purpose: 'act', qid }, (w, assertion) => ({ type: 'chat.act', op: w, qid, rows, ...confirmed, assertion }));
      });
    },

    ignoreTurn(qid, undo) {
      return chatAction(`ignore:${qid}`, async () => {
        const op = write(w => ({ type: 'chat.ignore', op: w, qid, ...(undo ? { undo } : {}) }));
        return op === null ? { status: 'failed' } : finalOf(op);
      });
    },

    giveTask(qid, row) {
      return chatAction(`task:${qid}:${row}`, async () => {
        const op = write(o => ({ type: 'chat.task', op: o, qid, row }));
        return op === null ? { status: 'failed' } : finalOf(op);
      });
    },

    answerNote(task, choice) {
      return chatAction(`note:${task}`, async () => {
        if (!choice.yes) {
          const op = write(o => ({ type: 'brain.answer', op: o, task, choice }));
          return op === null ? { status: 'failed' } : finalOf(op);
        }
        if (!state.device?.confirm) return { status: 'rejected', reason: 'confirm_required' };
        return signedOperation({ purpose: 'note', task, choice }, (w, assertion) => ({ type: 'brain.answer', op: w, task, choice, assertion }));
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
      images.close();
      if (previewsDirty) persist();
      offState();
      offMessage();
      for (const id of [...timers.keys()]) stopTimer(id);
      stopPcWatch();
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
