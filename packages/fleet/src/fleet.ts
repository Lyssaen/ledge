import { broadcastLabel, broadcastRecipient, BROADCAST_LABEL_MAX, BROADCAST_SESSIONS_MAX, ClientMessageSchema, MESSAGE_MAX, ChatTurnSchema, ContextPrefsSchema, isArchived, projectOf, IslandPrefsSchema, UsagePrefsSchema, type UsagePrefs, type UsageStateMessage, LEDGE_GIVER, ProjectsSchema, type Task, type IslandPrefs, type MobileState, type ChatTurn, type ChatProposal, type Projects, type ClientMessage, type Machine, type RoutingContext, type ServerMessage, type Session, type Tool, type ImageUpload, type BrowserLive } from '@ledge/protocol';
import { createDaemonClient, type DaemonClient, type DaemonStatus } from './client';
import { LOCAL_MACHINE, loadMachines, machineUrl, parseMachines, probeMachine, qualify, shellCommand, splitId, terminalCommand, type BroadcastResult, type MachineConfig, type MobileError, type MachineState } from './machines';
import type { TokenSource } from './token';

type Snapshot = Extract<ServerMessage, { type: 'snapshot' }>;
type Peer = { config: MachineConfig; client: DaemonClient; status: DaemonStatus; fresh: boolean; snapshot: Snapshot | null; previews: Map<string, string[]>;
  /** Its sessions' browser (browser.live), the ones not `none`: sent again after each snapshot the fleet publishes. */
  browsers: Map<string, BrowserLive>; off: (() => void)[]; error?: string; restarting?: boolean };
const toWire = (list: MachineConfig[]): Machine[] => list.map(({ id, label, ssh, disabled }) => ({ id, label, ...(ssh ? { ssh } : {}), ...(disabled ? { disabled: true } : {}) }));
type Binding = { machine: string; raw: string };
/** The commands tracked as a machine's operation in flight (`operations`, set in `send`): their answer, their refusal or the machine's drop ends it. */
const OPERATIONS: ReadonlySet<string> = new Set(['session.launch', 'session.relay', 'session.relay.cancel', 'session.close']);
type PendingRoute = { qid: string; text: string; tool?: Tool; images?: ImageUpload[]; coordinator: string };
/** How long a machine's answer to a broadcast is waited for; past it, that machine is a refusal (« pas de réponse »). When
 *  every machine asked was silent, the result's `reason` is BROADCAST_SILENT: sent, its outcome unknown (a resend with the same
 *  rid is answered once by each daemon). */
export const BROADCAST_TIMEOUT_MS = 8000;
export const BROADCAST_SILENT = 'silent';
/** A silent machine's refusal ends with it (`<machine> : pas de réponse`): the request may have gone, a resend keeps its rid. */
export const BROADCAST_NO_ANSWER = 'pas de réponse';
let broadcastSeq = 0;
type Refusal = { name: string; reason: string };
/** One broadcast in flight across machines: each asked machine with its own rid (`parts`, `partRid`) and its timer, until
 *  every one has answered, refused or timed out; then the merged result goes out under `rid`. */
type PendingBroadcast = { rid: string; waiting: Map<string, ReturnType<typeof setTimeout>>; parts: Map<string, string>; sent: { id: string; name: string }[]; refused: Refusal[]; reasons: string[]; silent: number; asked: number; empty?: string };
type BroadcastMessage = Extract<ClientMessage, { type: 'session.broadcast' }>;
/** The longest rid a `session.broadcast` takes (its schema). */
const RID_MAX = 100;
/** FNV-1a, 64 bits, as 16 hex characters: a long part rid made short, the same each time (so a resend is deduped). */
function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) h = BigInt.asUintN(64, (h ^ BigInt(byte)) * 0x100000001b3n);
  return h.toString(16).padStart(16, '0');
}
/** A machine's part rid: `${rid}:${machine}`, or its hash when that is longer than the schema takes. Never cut. */
const partRid = (rid: string, machine: string) => { const r = `${rid}:${machine}`; return r.length > RID_MAX ? fnv1a64(r) : r; };
/** Why the protocol refuses a part, in words: what the daemon would have refused, said before anything is sent. */
function partRefusal(part: BroadcastMessage): { why: string; whole: boolean } | null {
  const r = ClientMessageSchema.safeParse(part);
  if (r.success) return null;
  const issue = r.error.issues[0]!;
  if (issue.path[0] === 'text') {
    const n = part.text.length;
    return { why: n > MESSAGE_MAX ? `message trop long (${n} caractères, ${MESSAGE_MAX} au plus)` : 'message vide', whole: true };
  }
  if (issue.path[0] === 'to' && issue.code === 'too_big') return { why: `plus de ${BROADCAST_SESSIONS_MAX} sessions à la fois`, whole: false };
  return { why: 'requête invalide', whole: issue.path[0] !== 'to' };
}

export interface FleetOptions {
  /** Storage key prefix: `ledge` (island) or `desktop` (spec §7). */
  prefix?: string;
  /** Keep the last snapshot of a fallen peer (local or remote) published, sessions flagged `offline` (spec §6). Off: today's behaviour. */
  keepStale?: boolean;
  /** Trust the local daemon's `machines` list once it sends one (spec §5.3). Off: localStorage only. */
  machinesFromDaemon?: boolean;
  /** The daemon token every connection and probe presents (Ledge Desktop, the notch). Absent: no token, today's behaviour. */
  token?: TokenSource;
}

/** An app-owned connection per host. No command is broadcast; a missing owner fails closed. */
export function createFleetClient(config: MachineConfig[], makeClient = createDaemonClient, opts: FleetOptions = {}): DaemonClient {
  const prefix = opts.prefix ?? 'ledge';
  const HISTORY_KEY = `${prefix}.fleet.history`, MACHINES_KEY = `${prefix}.machines`;
  let configs = parseMachines(config), selected = configs[0]!.id, connected = false, configuring = false, state: MachineState[] = [];
  const peers = new Map<string, Peer>();
  /** The machines the fleet connects to: a disabled one stays in `configs` (Settings lists it) but has no peer and no state. */
  const active = (): MachineConfig[] => configs.filter(c => !c.disabled);
  const machineMessages = new Set<(machine: string, m: ServerMessage) => void>();
  const messages = new Set<(m: ServerMessage) => void>(), statuses = new Set<(s: DaemonStatus) => void>(), listeners = new Set<() => void>();
  const turns = new Map<string, ChatTurn>(), bindings = new Map<string, Binding>();
  const documents = new Map<string, string>();
  /** `repos.inspect` requestId -> the machine asked, so only its `repos.info` answers it. */
  const inspections = new Map<string, string>();
  /** `folder.list` / `folder.create` requestId -> the machine asked and the path (the parent of a creation), so only its `folder.listing` answers it
   *  (and a drop or a refusal answers « offline » or « not found »). `created`: where a creation lands, which an older daemon's untagged answer is matched by. */
  const listings = new Map<string, { machine: string; path: string; created?: string }>();
  /** `repos.scan` requestId -> the machine asked, so only its `repos.found` answers it (and a drop or a refusal answers « offline » or « outdated »). */
  const scans = new Map<string, string>();
  /** `attachment.put` / `attachment.get` requestId -> the machine asked, so only its answer is emitted (a drop answers « offline »). */
  const attachmentAsks = new Map<string, string>();
  /** The broadcasts in flight, by the rid the front gave, in the order sent (an `error`, which names no rid, settles a machine's oldest). */
  const broadcasts = new Map<string, PendingBroadcast>();
  /** `models.list` requestId -> the machine asked and the agent, so only its `models.listing` answers it (and a drop or a refusal answers « offline » or « outdated »). */
  const modelLists = new Map<string, { machine: string; tool: Tool }>();
  /** `session.commands` requestId -> the machine asked and the session's qualified id, so only its listing answers it (a drop or a refusal answers « offline » or « outdated »). */
  const commandLists = new Map<string, { machine: string; id: string }>();
  type RigKind = 'status' | 'act' | 'specs' | 'launch' | 'seats' | 'roles' | 'role' | 'roleFile' | 'roleDuplicate' | 'asks' | 'answer' | 'goals' | 'goalSend' | 'goalReply' | 'row' | 'graph' | 'snapshots' | 'permissions' | 'queue' | 'ping';
  type RigAsk = { machine: string; kind: RigKind; roleId?: string; path?: string; qitemId?: string; goalId?: string; replyId?: string; qitem?: string; rig?: string };
  const rigFailure = (a: RigAsk, requestId: string, machineId: string, error: 'offline' | 'outdated'): ServerMessage =>
    a.kind === 'ping' ? { type: 'pong', requestId, machineId, error }
    : a.kind === 'act' ? { type: 'openrig.done', requestId, machineId, ok: false, commands: [], error }
    : a.kind === 'specs' ? { type: 'openrig.specList', requestId, machineId, specs: [], error }
    : a.kind === 'launch' ? { type: 'openrig.launched', requestId, machineId, ok: false, plan: false, commands: [], error }
    : a.kind === 'seats' ? { type: 'openrig.reseated', requestId, machineId, ok: false, commands: [], added: [], removed: [], error }
    : a.kind === 'roles' ? { type: 'openrig.roleList', requestId, machineId, roles: [], error }
    : a.kind === 'role' ? { type: 'openrig.roleDetail', requestId, machineId, roleId: a.roleId ?? '', error }
    : a.kind === 'roleFile' ? { type: 'openrig.roleFileContent', requestId, machineId, roleId: a.roleId ?? '', path: a.path ?? '', error }
    : a.kind === 'roleDuplicate' ? { type: 'openrig.roleDuplicated', requestId, machineId, ok: false, error }
    : a.kind === 'asks' ? { type: 'openrig.asksChanged', requestId, machineId, asks: [], error }
    : a.kind === 'answer' ? { type: 'openrig.answered', requestId, machineId, qitemId: a.qitemId ?? '', ok: false, error }
    : a.kind === 'goals' ? { type: 'openrig.goalsChanged', requestId, machineId, goals: [], error }
    : a.kind === 'goalSend' ? { type: 'openrig.goal.sent', requestId, machineId, goalId: a.goalId ?? '', ok: false, error }
    : a.kind === 'goalReply' ? { type: 'openrig.goal.replied', requestId, machineId, goalId: a.goalId ?? '', replyId: a.replyId ?? '', ok: false, error }
    : a.kind === 'graph' ? { type: 'openrig.graphState', requestId, machineId, rig: a.rig ?? '', error }
    : a.kind === 'permissions' ? { type: 'openrig.permissionList', requestId, machineId, rig: a.rig ?? '', seats: [], error }
    : a.kind === 'queue' ? { type: 'openrig.queueState', requestId, machineId, rig: a.rig ?? '', rows: [], truncated: false, error }
    : a.kind === 'snapshots' ? { type: 'openrig.snapshotList', requestId, machineId, rig: a.rig ?? '', snapshots: [], error }
    : a.kind === 'row' ? { type: 'openrig.rowState', requestId, machineId, qitem: a.qitem ?? '', error }
    : { type: 'openrig.state', requestId, machineId, error };
  /** The OpenRig writes whose end is told `uncertain` when their machine drops after they were sent (a refusal before sending stays `offline`). */
  const SENT_WRITES: ReadonlySet<RigKind> = new Set(['answer', 'goalSend', 'goalReply', 'roleDuplicate']);
  const rigUncertain = (a: RigAsk, requestId: string, machineId: string): ServerMessage =>
    a.kind === 'answer' ? { type: 'openrig.answered', requestId, machineId, qitemId: a.qitemId ?? '', ok: false, error: 'uncertain', message: 'the machine dropped before the answer came back' }
    : a.kind === 'roleDuplicate' ? { type: 'openrig.roleDuplicated', requestId, machineId, ok: false, error: 'uncertain' }
    : a.kind === 'goalSend' ? { type: 'openrig.goal.sent', requestId, machineId, goalId: a.goalId ?? '', ok: false, error: 'uncertain', message: 'the machine dropped before the answer came back' }
    : { type: 'openrig.goal.replied', requestId, machineId, goalId: a.goalId ?? '', replyId: a.replyId ?? '', ok: false, error: 'uncertain', message: 'the machine dropped before the answer came back' };
  /** `openrig.status` / `openrig.act` requestId -> the machine asked, so only its answer is emitted (a drop or a refusal answers « offline » or « outdated »). */
  const rigAsks = new Map<string, RigAsk>();
  /** Each pending OpenRig ask of `machine` (of `kinds` only, when given) is answered with `error`: 'offline' when it dropped,
   *  'outdated' when its daemon does not know OpenRig, or its roles. */
  const answerFailedRigs = (machine: string, error: 'offline' | 'outdated', kinds?: readonly RigKind[]) => {
    for (const [requestId, a] of rigAsks) if (a.machine === machine && (!kinds || kinds.includes(a.kind))) {
      rigAsks.delete(requestId);
      // A write already handed to the machine (a goal, a word to Max, an answer) that drops before its end may have been done there:
      // `uncertain`, never `offline`, which says nothing left (sending it again with the same id is safe).
      emit(error === 'offline' && SENT_WRITES.has(a.kind) ? rigUncertain(a, requestId, machine) : rigFailure(a, requestId, machine, error));
    }
  };
  const operations = new Map<string, string>();
  /** A machine's close in flight: its raw qid, the rows asked for and each row's `error` at the send (a refusal is a new one, not the old). */
  const closeRows = new Map<string, { qid: string; rows: number[]; errors: Array<string | undefined> }>();
  const endOperation = (machine: string) => { closeRows.delete(machine); return operations.delete(machine); };
  /** The paths of a pending inspection, to answer « not found » for each if its machine drops. */
  const unfound = new Map<string, { path: string; exists: false; branch: null }[]>();
  /** Each pending inspection of `machine` is answered « not found » for every path (the machine dropped, or does not know repos.inspect). */
  const answerUnfoundInspections = (machine: string) => {
    for (const [requestId, owner] of inspections) if (owner === machine) { inspections.delete(requestId); const repos = unfound.get(requestId) ?? []; unfound.delete(requestId); emit({ type: 'repos.info', requestId, repos }); }
  };
  /** Each pending listing of `machine` is answered with `error` (offline when it dropped, the daemon's text or « not found » when it refused). */
  const answerUnfoundListings = (machine: string, error: string) => {
    for (const [requestId, l] of listings) if (l.machine === machine) { listings.delete(requestId); emit({ type: 'folder.listing', requestId, path: l.path, parent: null, entries: [], error }); }
  };
  /** Each pending scan of `machine` is answered empty with `error`: 'offline' when it dropped, 'outdated' when its daemon does not know repos.scan. */
  const answerFailedScans = (machine: string, error: 'offline' | 'outdated') => {
    for (const [requestId, owner] of scans) if (owner === machine) { scans.delete(requestId); emit({ type: 'repos.found', requestId, repos: [], truncated: false, error }); }
  };
  /** Each pending models.list of `machine` is answered empty with `error` (#58): 'offline' when it dropped, 'outdated' when its daemon does not know models.list. */
  const answerFailedModels = (machine: string, error: 'offline' | 'outdated') => {
    for (const [requestId, l] of modelLists) if (l.machine === machine) { modelLists.delete(requestId); emit({ type: 'models.listing', requestId, tool: l.tool, models: [], error }); }
  };
  /** Each pending session.commands of `machine` is answered empty with `error`: 'offline' when it dropped, 'outdated' when its daemon does not know session.commands. */
  const answerFailedCommands = (machine: string, error: 'offline' | 'outdated') => {
    for (const [requestId, l] of commandLists) if (l.machine === machine) { commandLists.delete(requestId); emit({ type: 'session.commands.listing', requestId, id: l.id, commands: [], error }); }
  };
  let source: 'daemon' | 'local' = 'local';
  /** The local daemon's projects (build spec §5); the last ones stay while it is down. */
  let projects: Projects | null = null;
  /** The local daemon's island settings: undefined until it sends them, null while none was set. */
  let island: IslandPrefs | null | undefined;
  /** The local daemon's context threshold: undefined until it sends it. */
  let contextNear: number | undefined;
  /** Each machine's last `usage.state` (harness limits, alerts, threshold), by machine id; a machine that goes away takes its own. */
  let usage: ReadonlyMap<string, UsageStateMessage> = new Map();
  /** What a machine missed while it was away: the threshold set and the « Compris » given then, sent once it speaks again. */
  // Kept across the front's restarts (review of 975e508b): a threshold a machine has not received yet, by machine; and every
  // « Compris » given (an alert's id carries its window's reset, so an id never comes back after it): any machine that shows
  // one of them is told, an absent one when it comes back, one that raises it later when it does.
  const USAGE_KEY = `${prefix}.usage.owed`;
  /** A threshold owed to a machine: the value, when it was set, and what the machine had then (null: never heard from it).
   *  On its return a machine whose threshold is no longer `was` was set elsewhere since: the newer wins, this one is dropped. */
  type Owed = { prefs: UsagePrefs; at: number; was: number | null };
  const OWED_MAX_MS = 24 * 3600_000;
  const owedPrefs = new Map<string, Owed>();
  const acked: string[] = [];
  try {
    const saved = JSON.parse(localStorage.getItem(USAGE_KEY) ?? 'null') as { prefs?: Record<string, Owed>; acked?: string[] } | null;
    for (const [m, x] of Object.entries(saved?.prefs ?? {})) {
      const ok = UsagePrefsSchema.safeParse(x?.prefs);
      if (ok.success && typeof x.at === 'number') owedPrefs.set(m, { prefs: ok.data, at: x.at, was: typeof x.was === 'number' ? x.was : null });
    }
    for (const id of saved?.acked ?? []) if (typeof id === 'string') acked.push(id);
  } catch { /* none kept */ }
  const ACKED_MAX = 200;
  const keepOwed = () => { try { localStorage.setItem(USAGE_KEY, JSON.stringify({ prefs: Object.fromEntries(owedPrefs), acked })); } catch { /* memory still holds it */ } };
  /** The « Compris » already sent to a machine this run, so a state that crosses it is not answered twice. */
  const ackSent = new Set<string>();
  /** The local daemon's mobile access state: undefined until it sends it. */
  let mobile: MobileState | undefined;
  /** The local daemon's last refused mobile.* command: cleared by the next command and by every mobile broadcast. */
  let mobileError: MobileError | undefined;
  /** The local sessions a phone types into, qualified, by the device's label: a new map on each change. */
  let holders: ReadonlyMap<string, string> = new Map();
  /** The tasks known to the local daemon, by id, sessions qualified. */
  let tasks = new Map<string, Task>(); let taskList: Task[] = [];
  /** The `task.cmd list` this fleet sent after a local snapshot: their answers fill `tasks`. */
  const taskLists = new Set<string>(); let listSeq = 0;
  const local = (id: string) => (id === LEDGE_GIVER ? id : qualify('local', id));
  const taskOut = (t: Task): Task => ({ ...t, giver: local(t.giver), owner: local(t.owner),
    log: t.log.map(e => ({ ...e, ...(e.from ? { from: local(e.from) } : {}), ...(e.to ? { to: local(e.to) } : {}) })) });
  const putTasks = (list: Task[]) => { for (const t of list) tasks.set(t.id, taskOut(t)); taskList = [...tasks.values()].sort((a, b) => a.at.localeCompare(b.at)); listeners.forEach(fn => fn()); };
  /** Ledge's own tasks, asked again at each local snapshot (an `all` list: the ones closed this week too); a daemon before
   *  0.17.0 does not know them. */
  const knowsTasks = (version: string | undefined) => { const [major = 0, minor = 0] = (version ?? '').split('.').map(Number); return major > 0 || minor >= 17; };
  const askTasks = (p: Peer) => { if (!knowsTasks(p.snapshot?.daemon?.version)) return; const rid = `fleet-tasks-${++listSeq}`; taskLists.add(rid); p.client.send({ type: 'task.cmd', rid, by: LEDGE_GIVER, op: 'list', all: true }); };
  let routing: PendingRoute | null = null, resetAt = '', lastStatus: DaemonStatus = 'connecting';
  const emit = (m: ServerMessage) => messages.forEach(fn => fn(m));
  const day = () => new Date().toISOString().slice(0, 10);
  let historyDay = day();
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? 'null');
    if (saved?.day === day()) {
      for (const raw of (saved.turns ?? []).slice(-50)) {
        const t = ChatTurnSchema.parse(raw);
        if (!t.answeredAt && !t.error) t.error = 'Connection interrupted';
        turns.set(t.qid, t);
      }
      for (const [qid, b] of saved.bindings ?? []) if (turns.has(qid) && (opts.machinesFromDaemon || configs.some(c => c.id === b.machine)) && typeof b.raw === 'string') bindings.set(qid, b);
      resetAt = typeof saved.resetAt === 'string' ? saved.resetAt : '';
    }
  } catch { /* No usable previous conversation. */ }
  function history() {
    const list = [...turns.values()].sort((a, b) => a.askedAt.localeCompare(b.askedAt)).slice(-50);
    const kept = new Set(list.map(t => t.qid));
    for (const id of turns.keys()) if (!kept.has(id)) { turns.delete(id); bindings.delete(id); }
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify({ day: historyDay, turns: list, bindings: [...bindings], resetAt })); } catch { /* Memory still works when storage is full. */ }
    emit({ type: 'chat.history', turns: list });
  }
  const available = (p: Peer | undefined): boolean => !!p && p.status === 'open' && p.fresh && !!p.snapshot;
  const status = (): DaemonStatus => [...peers.values()].some(available) ? 'open' : [...peers.values()].some(p => p.status === 'connecting') ? 'connecting' : 'unreachable';
  /** keepStale: a fallen peer, the local one included, keeps its last snapshot, flagged offline (spec §6). */
  const stale = (p: Peer | undefined): boolean => !!opts.keepStale && !!p && !available(p) && !!p.snapshot;
  const session = (p: Peer, s: Session): Session => ({ ...s, id: qualify(p.config.id, s.id), machineId: p.config.id, machineName: p.config.label, ...(stale(p) ? { offline: true } : {}),
    // A relief and the one it relieves are on the same machine (context handover spec §3.3).
    ...(s.handover?.to ? { handover: { ...s.handover, to: qualify(p.config.id, s.handover.to) } } : {}),
    ...(s.relieves ? { relieves: { ...s.relieves, id: qualify(p.config.id, s.relieves.id) } } : {}) });
  /** What the overlay shows of a peer: its live sessions, its frozen ones, or none. */
  const shows = (p: Peer): 'live' | 'stale' | 'none' => (available(p) ? 'live' : stale(p) ? 'stale' : 'none');
  const stateSessions = (p: Peer): Session[] => (stale(p) ? p.snapshot!.sessions.map(s => ({ ...s, offline: true })) : p.snapshot?.sessions ?? []).filter(s => !isArchived(s));
  /** The fleet's own inventory and status follow every change. Only `publish` tells the overlay the whole picture again:
   *  a (re)connection, a host joining or leaving, another host selected. A session's own update is relayed as itself
   *  (see `receive`): to the overlay a snapshot is a reconnection, which empties the threads and rebuilds the open view. */
  function refresh() {
    // Mid-`apply` a closing client may speak (« connecting », at once) while `configs` and the peers disagree: the final
    // `publish` tells it all.
    if (configuring) return;
    state = active().map(c => { const p = peers.get(c.id)!; return { ...c, status: p.status, ready: available(p), recents: p.snapshot?.recents ?? [], sessions: stateSessions(p), launcher: p.snapshot?.launcher ?? null, version: p.snapshot?.daemon?.version, daemon: p.snapshot?.daemon, error: p.error }; });
    const next = status(); if (next !== lastStatus) { lastStatus = next; statuses.forEach(fn => fn(next)); }
    listeners.forEach(fn => fn());
  }
  function publish() {
    if (configuring) return;
    state = active().map(c => { const p = peers.get(c.id)!; return { ...c, status: p.status, ready: available(p), recents: p.snapshot?.recents ?? [], sessions: stateSessions(p), launcher: p.snapshot?.launcher ?? null, version: p.snapshot?.daemon?.version, daemon: p.snapshot?.daemon, error: p.error }; });
    const primary = peers.get('local')?.snapshot;
    emit({ type: 'snapshot', sessions: [...peers.values()].filter(p => available(p) || stale(p)).flatMap(p => p.snapshot!.sessions.map(s => session(p, s))), recents: available(peers.get(selected)) ? peers.get(selected)!.snapshot!.recents : [], launcher: primary?.launcher, daemon: primary?.daemon });
    for (const p of peers.values()) if (available(p) || stale(p)) for (const [id, lines] of p.previews) emit({ type: 'session.preview', id: qualify(p.config.id, id), lines });
    for (const p of peers.values()) if (available(p)) for (const b of p.browsers.values()) emit({ ...b, id: qualify(p.config.id, b.id) });
    const next = status(); if (next !== lastStatus) { lastStatus = next; statuses.forEach(fn => fn(next)); }
    listeners.forEach(fn => fn());
  }
  function fail(qid: string, message: string) {
    const t = turns.get(qid); if (t) turns.set(qid, { ...t, error: message });
    history(); emit({ type: 'chat.error', qid, message });
  }
  function globalQid(machine: string, raw: string): string {
    return [...bindings].find(([, b]) => b.machine === machine && b.raw === raw)?.[0] ?? qualify(machine, raw);
  }
  /** A card row as the overlay knows it: its launched session's id qualified by the machine. */
  const launchedOn = (p: Peer, x: ChatProposal): ChatProposal => ({ ...x, ...(x.launchedId ? { launchedId: qualify(p.config.id, x.launchedId) } : {}) });
  function mappedTurn(p: Peer, raw: ChatTurn): ChatTurn {
    const qid = globalQid(p.config.id, raw.qid), old = turns.get(qid);
    bindings.set(qid, { machine: p.config.id, raw: raw.qid });
    return { ...raw, qid, question: old?.question ?? raw.question, machineId: p.config.id, machineName: p.config.label,
      steps: raw.steps.map(s => ({ ...s, ...(s.id ? { id: qualify(p.config.id, s.id) } : {}) })),
      ...(raw.proposal ? { proposal: launchedOn(p, raw.proposal) } : {}), ...(raw.proposals ? { proposals: raw.proposals.map(x => launchedOn(p, x)) } : {}),
      ...(raw.relay ? { relay: { ...raw.relay, id: qualify(p.config.id, raw.relay.id) } } : {}),
      ...(raw.closes ? { closes: raw.closes.map(c => ({ ...c, id: qualify(p.config.id, c.id) })) } : {}),
      ...(raw.actions ? { actions: raw.actions.map(a => ({ ...a, ...(a.session ? { session: qualify(p.config.id, a.session) } : {}) })) } : {}) };
  }
  /** Applies a confirmed list to the peers: no storage write, nothing for the overlay until `publish`. */
  function apply(next: MachineConfig[]) {
    configuring = true;
    for (const [id, p] of peers) if (!next.some(c => !c.disabled && c.id === id && c.url === p.config.url && c.ssh === p.config.ssh)) { p.client.close(); p.off.forEach(off => off()); peers.delete(id); if (usage.has(id)) { const next = new Map(usage); next.delete(id); usage = next; } if (owedPrefs.delete(id)) keepOwed(); }
    configs = next;
    for (const c of active()) { const p = peers.get(c.id); if (p) p.config = c; else add(c); }
    if (!peers.has(selected)) selected = 'local';
    // Daemon-sourced bindings are kept through the restore (the list is unknown until the daemon speaks), then pruned against the confirmed list.
    const gone = source === 'daemon' ? [...bindings].filter(([, b]) => !configs.some(c => c.id === b.machine)) : [];
    for (const [qid] of gone) bindings.delete(qid);
    configuring = false; publish(); if (gone.length) history();
  }
  function receive(p: Peer, m: ServerMessage) {
    const machine = p.config.id;
    // The daemon's machine list is consumed here, never relayed; from anyone else (or with the option off) it is ignored.
    if (m.type === 'machines') {
      if (machine !== 'local' || !opts.machinesFromDaemon) return;
      let next: MachineConfig[]; try { next = parseMachines(m.machines); } catch { return; }
      const mine = next.length === 1 ? loadMachines(prefix) : [];
      source = 'daemon';
      // First front connected wins: only a daemon list reduced to `local` takes the richer local one. Nothing is applied and the
      // stored list is kept until the daemon broadcasts the confirmed list, so peers and bindings stay put and a failed write is retried on reconnect.
      if (next.length === 1 && mine.length > 1) { p.client.send({ type: 'machines.set', machines: toWire(mine) }); return; }
      try { localStorage.removeItem(MACHINES_KEY); } catch { /* ignore */ }
      apply(next);
      return;
    }
    // The local daemon's projects are consumed here, never relayed; from a remote machine they are ignored (private to their host).
    if (m.type === 'projects') {
      if (machine !== 'local') return;
      projects = m.projects; listeners.forEach(fn => fn());
      return;
    }
    // So is the context threshold (context handover spec §3.2).
    if (m.type === 'context.prefs') {
      if (machine !== 'local') return;
      contextNear = m.prefs.near; listeners.forEach(fn => fn());
      return;
    }
    // So are the island's settings: one copy per host, set from Desktop and applied by the island.
    if (m.type === 'island') {
      if (machine !== 'local') return;
      island = m.prefs; listeners.forEach(fn => fn());
      return;
    }
    // Tasks are the local daemon's: a remote machine's are ignored.
    if (m.type === 'task.updated') { if (machine === 'local') putTasks([m.task]); return; }
    if (m.type === 'task.result' && taskLists.has(m.rid)) { taskLists.delete(m.rid); if (machine === 'local' && m.tasks) putTasks(m.tasks); return; }
    // Mobile access is the local daemon's alone (its relay session and approved devices): a remote machine's is ignored.
    if (m.type === 'terminal.holders') {
      if (machine !== 'local') return;
      holders = new Map(m.holds.map(h => [qualify('local', h.id), h.device]));
      listeners.forEach(fn => fn());
      return;
    }
    if (m.type === 'mobile') {
      if (machine !== 'local') return;
      mobile = m.state; mobileError = undefined; listeners.forEach(fn => fn());
      return;
    }
    machineMessages.forEach(fn => fn(machine, m));
    // A daemon restarting for an update closes its SSH bridge: that error is the restart, not a failure to show.
    if (m.type === 'update.progress') p.restarting = m.step === 'restarting';
    if (m.type === 'update.failed') p.restarting = false;
    if (m.type === 'snapshot') {
      if (p.config.ssh && m.sshAlias !== p.config.ssh) { p.error = 'Update the local Ledge daemon: SSH transport is unavailable'; p.client.close(); publish(); return; }
      p.snapshot = m; p.fresh = true; p.error = undefined; p.restarting = false; p.previews.clear(); p.browsers.clear(); publish();
      if (machine === 'local') askTasks(p);
      return;
    }
    // A session's traffic is relayed as it came, qualified; a peer without a snapshot yet has nothing to relay against.
    if (m.type === 'session.updated') { if (p.snapshot) p.snapshot = { ...p.snapshot, sessions: [...p.snapshot.sessions.filter(s => s.id !== m.session.id), m.session] }; if (available(p)) emit({ type: 'session.updated', session: session(p, m.session) }); refresh(); return; }
    if (m.type === 'session.removed') { if (p.snapshot) p.snapshot = { ...p.snapshot, sessions: p.snapshot.sessions.filter(s => s.id !== m.id) }; p.previews.delete(m.id); p.browsers.delete(m.id); emit({ ...m, id: qualify(machine, m.id) }); refresh(); return; }
    if (m.type === 'recents') { if (p.snapshot) p.snapshot = { ...p.snapshot, recents: m.recents }; if (machine === selected && available(p)) emit(m); refresh(); return; }
    // The agent's browser (docs/mockups/ledge-browser-live.html): its state kept to send again after a snapshot, its frames relayed as they come.
    if (m.type === 'browser.live') { if (m.state === 'none') p.browsers.delete(m.id); else p.browsers.set(m.id, m); if (available(p)) emit({ ...m, id: qualify(machine, m.id) }); return; }
    if (m.type === 'browser.frame') { if (available(p)) emit({ ...m, id: qualify(machine, m.id) }); return; }
    // The agent screen (spec 2026-11-04): the same bytes, with the session qualified, from whichever machine runs it.
    if (m.type === 'term.opened' || m.type === 'term.output' || m.type === 'term.size' || m.type === 'term.exit') { if (available(p)) emit({ ...m, id: qualify(machine, m.id) }); return; }
    if (m.type === 'session.preview') { p.previews.set(m.id, m.lines); if (available(p)) emit({ ...m, id: qualify(machine, m.id) }); return; }
    if (m.type === 'session.thread' || m.type === 'session.thread.item' || m.type === 'session.queue.restored') { if (available(p)) emit({ ...m, id: qualify(machine, m.id) }); return; }
    if (m.type === 'session.launched') { if (!closeRows.has(machine)) operations.delete(machine); emit({ ...m, id: qualify(machine, m.id) }); return; }
    if (m.type === 'session.closed') { emit({ ...m, qid: globalQid(machine, m.qid), id: qualify(machine, m.id) }); return; }
    if (m.type === 'chat.acted') { emit({ ...m, qid: globalQid(machine, m.qid) }); return; }
    if (m.type === 'folder.listing') {
      if (m.requestId !== undefined && listings.has(m.requestId)) { if (listings.get(m.requestId)!.machine === machine) { listings.delete(m.requestId); emit(m); } return; }
      // A daemon before 0.9.1 answers folder.create without its requestId: the listing of the new folder, or of the parent with the refusal.
      const creation = m.requestId === undefined ? [...listings].find(([, l]) => l.machine === machine && l.created !== undefined && (m.error === undefined ? m.path === l.created : m.path === l.path)) : undefined;
      if (creation) { listings.delete(creation[0]); emit({ ...m, requestId: creation[0] }); return; }
      if (m.requestId === undefined && machine === selected) emit(m);
      return;
    }
    if (m.type === 'document.content' || m.type === 'document.error') { if (documents.get(m.requestId) === machine) { documents.delete(m.requestId); emit(m); } return; }
    if (m.type === 'repos.info') { if (inspections.get(m.requestId) === machine) { inspections.delete(m.requestId); unfound.delete(m.requestId); emit(m); } return; }
    if (m.type === 'attachment.stored' || m.type === 'attachment.data' || m.type === 'attachment.error') { if (attachmentAsks.get(m.requestId) === machine) { attachmentAsks.delete(m.requestId); emit(m); } return; }
    if (m.type === 'repos.found') { if (scans.get(m.requestId) === machine) { scans.delete(m.requestId); emit(m); } return; }
    if (m.type === 'openrig.state' || m.type === 'openrig.done' || m.type === 'openrig.specList' || m.type === 'openrig.launched' || m.type === 'openrig.reseated'
      || m.type === 'openrig.roleList' || m.type === 'openrig.roleDetail' || m.type === 'openrig.roleFileContent' || m.type === 'openrig.roleDuplicated' || m.type === 'openrig.asksChanged' || m.type === 'openrig.answered'
      || m.type === 'openrig.goalsChanged' || m.type === 'openrig.goal.sent' || m.type === 'openrig.goal.replied' || m.type === 'openrig.rowState' || m.type === 'openrig.graphState' || m.type === 'openrig.snapshotList' || m.type === 'openrig.permissionList' || m.type === 'openrig.queueState' || m.type === 'pong') {
      // An answer goes out once, from the machine asked; a state that follows an action goes out from any machine.
      if (m.requestId !== undefined) { if (rigAsks.get(m.requestId)?.machine !== machine) return; rigAsks.delete(m.requestId); }
      emit({ ...m, machineId: machine }); return;
    }
    // Each machine's harness limits, tagged with it: a front groups machines by account and drops a machine that went away.
    if (m.type === 'usage.state') {
      if (available(p)) {
        const owed = owedPrefs.get(machine);
        if (owed) {
          owedPrefs.delete(machine); keepOwed();
          // Set elsewhere since (it no longer has what it had), or owed too long to a machine never heard from: not sent.
          const changed = owed.was !== null && m.prefs.alert !== owed.was;
          const tooOld = owed.was === null && Date.now() - owed.at > OWED_MAX_MS;
          if (!changed && !tooOld && owed.prefs.alert !== m.prefs.alert) p.client.send({ type: 'usage.set', prefs: owed.prefs });
        }
        for (const a of m.alerts) {
          if (!acked.includes(a.id) || ackSent.has(`${machine}|${a.id}`)) continue;
          ackSent.add(`${machine}|${a.id}`);
          p.client.send({ type: 'usage.ack', id: a.id });
        }
      }
      const tagged = { ...m, machineId: machine };
      usage = new Map(usage).set(machine, tagged); listeners.forEach(fn => fn());
      emit(tagged); return;
    }
    if (m.type === 'models.listing') { if (modelLists.get(m.requestId)?.machine === machine) { modelLists.delete(m.requestId); emit(m); } return; }
    if (m.type === 'session.commands.listing') { const l = commandLists.get(m.requestId); if (l?.machine === machine) { commandLists.delete(m.requestId); emit({ ...m, id: l.id }); } return; }
    if (m.type === 'chat.routed') {
      if (routing?.qid !== m.qid || routing.coordinator !== machine) return;
      const req = routing; routing = null;
      if (m.result.machineId === null) {
        const old = turns.get(m.qid)!;
        turns.set(m.qid, { ...old, answer: m.result.text, answeredAt: new Date().toISOString(), choices: m.result.choices?.map(id => ({ id, label: peers.get(id)?.config.label ?? id })) }); history();
      } else {
        const target = peers.get(m.result.machineId);
        bindings.set(req.qid, { machine: m.result.machineId, raw: req.qid });
        if (!available(target)) { fail(req.qid, `${target?.config.label ?? m.result.machineId} is offline`); return; }
        target!.client.send({ type: 'chat.ask', qid: req.qid, text: m.result.text, tool: req.tool, ...(req.images ? { images: req.images } : {}) });
      }
      return;
    }
    if (m.type === 'chat.history') {
      if (m.turns.some(t => t.qid === operations.get(machine) && t.relay && (t.relay.status || t.relay.error)) && !closeRows.has(machine)) endOperation(machine);
      const close = closeRows.get(machine), closing = close && m.turns.find(t => t.qid === close.qid);
      if (close && closing?.closes && close.rows.every(r => { const c = closing.closes![r]; return !c || c.closedAt || (c.error !== undefined && c.error !== close.errors[r]); })) endOperation(machine);
      for (const raw of m.turns) if (raw.askedAt >= resetAt && raw.askedAt.slice(0, 10) === historyDay) { const t = mappedTurn(p, raw); turns.set(t.qid, t); }
      history(); return;
    }
    if (m.type === 'chat.step' || m.type === 'chat.delta' || m.type === 'chat.done' || m.type === 'chat.error') {
      if (routing?.qid === m.qid && routing.coordinator === machine && m.type === 'chat.error') { routing = null; fail(m.qid, m.message); return; }
      const qid = globalQid(machine, m.qid), old = turns.get(qid); if (!old) return;
      if (m.type === 'chat.done') {
        const raw = { ...old, qid: m.qid, answer: m.text, answeredAt: m.at, proposal: m.proposal, proposals: m.proposals, relay: m.relay, closes: m.closes, projectProposal: m.projectProposal, tasks: m.tasks, actions: m.actions };
        const t = mappedTurn(p, { ...raw, steps: [] }); turns.set(qid, { ...t, steps: old.steps }); history();
      } else if (m.type === 'chat.error') fail(qid, m.message);
      else if (m.type === 'chat.step') { const step = { ...m.step, ...(m.step.id ? { id: qualify(machine, m.step.id) } : {}) }; turns.set(qid, { ...old, steps: [...old.steps, step] }); emit({ ...m, qid, step }); }
      else emit({ ...m, qid });
      return;
    }
    if (m.type === 'error') {
      // An `error` names no rid: it answers this machine's oldest broadcast still waiting (an older daemon does not know the message).
      if (m.request === 'session.broadcast') {
        const b = [...broadcasts.values()].find(x => x.waiting.has(machine));
        // Only a daemon (or the gateway before it) that does not know the message refuses it for its version; one that knows it refused this request.
        if (b) { b.refused.push(machineRefusal(machine, knowsBroadcast(machine) ? 'requête refusée' : 'version trop ancienne')); settleBroadcast(b, machine); }
        return;
      }
      if (p.restarting) return;
      // A mobile.* refusal belongs to the Mobile access settings (the local daemon's alone), never to a session.
      if (m.request?.startsWith('mobile.')) {
        if (machine === 'local') { mobileError = { request: m.request, message: m.message, ...(m.code ? { code: m.code } : {}) }; listeners.forEach(fn => fn()); }
        return;
      }
      if (!p.fresh) { p.error = m.message; publish(); return; }
      // An older daemon does not know repos.inspect (« invalid message »): its pending inspections find nothing, as when it drops.
      if (m.request === 'repos.inspect') { answerUnfoundInspections(machine); return; }
      // Likewise for repos.scan (lot 11): the new daemon answers every scan with repos.found, so a refusal means an older daemon.
      if (m.request === 'repos.scan') { answerFailedScans(machine, 'outdated'); return; }
      if (m.request === 'models.list') { answerFailedModels(machine, 'outdated'); return; }
      // A daemon that drives OpenRig but predates its roles refuses only those: its other pending OpenRig asks stay.
      if (m.request === 'session.commands') { answerFailedCommands(machine, 'outdated'); return; }
      if (m.request === 'openrig.roles' || m.request === 'openrig.role' || m.request === 'openrig.roleFile') { answerFailedRigs(machine, 'outdated', ['roles', 'role', 'roleFile']); return; }
      if (m.request === 'openrig.role.duplicate') { answerFailedRigs(machine, 'outdated', ['roleDuplicate']); return; }
      // Likewise a daemon that predates « À toi » refuses only its asks and answers.
      if (m.request === 'openrig.asks' || m.request === 'openrig.answer') { answerFailedRigs(machine, 'outdated', ['asks', 'answer']); return; }
      if (m.request === 'openrig.goals' || m.request === 'openrig.goal.send' || m.request === 'openrig.goal.reply') { answerFailedRigs(machine, 'outdated', ['goals', 'goalSend', 'goalReply']); return; }
      // Likewise a daemon that predates the rows of the task cards (docs/mockups/ledge-openrig-messages.html).
      if (m.request === 'openrig.graph') { answerFailedRigs(machine, 'outdated', ['graph']); return; }
      if (m.request === 'openrig.snapshots') { answerFailedRigs(machine, 'outdated', ['snapshots']); return; }
      if (m.request === 'openrig.permissions') { answerFailedRigs(machine, 'outdated', ['permissions']); return; }
      if (m.request === 'openrig.queue') { answerFailedRigs(machine, 'outdated', ['queue']); return; }
      if (m.request === 'openrig.row') { answerFailedRigs(machine, 'outdated', ['row']); return; }
      if (m.request?.startsWith('openrig.')) { answerFailedRigs(machine, 'outdated'); return; }
      if ((m.request === 'folder.list' || m.request === 'folder.create') && [...listings.values()].some(l => l.machine === machine)) { answerUnfoundListings(machine, m.message || 'not found'); return; }
      // Only the in-flight operation's own refusal ends it: another refused command leaves it waiting for its answer or the machine's drop.
      if (m.request !== undefined && OPERATIONS.has(m.request)) endOperation(machine);
      emit({ ...m, ...(m.id ? { id: qualify(machine, m.id) } : {}), message: active().length > 1 ? `${p.config.label}: ${m.message}` : m.message });
      return;
    }
    // A relief's answer comes from the machine the session runs on (context handover spec §3.3).
    if (m.type === 'session.handover.result') { emit(m); return; }
    // A machine's part of a broadcast (the rid it was sent): merged, its recipients qualified; a stray or late one is dropped.
    if (m.type === 'session.broadcast.result') {
      const b = [...broadcasts.values()].find(x => x.waiting.has(machine) && x.parts.get(machine) === m.rid);
      if (!b) return;
      b.sent.push(...m.sent.map(x => ({ ...x, id: qualify(machine, x.id) }))); b.refused.push(...m.refused);
      if (m.reason) b.reasons.push(m.reason);
      settleBroadcast(b, machine); return;
    }
    if (machine === 'local') emit(m);
  }
  /** The machine's daemon announces `session.broadcast`; a remote one is reached through the local daemon's SSH gateway, which must know it too. */
  const announces = (machine: string) => !!peers.get(machine)?.snapshot?.daemon?.broadcast;
  const knowsBroadcast = (machine: string) => announces(machine) && (machine === 'local' || announces('local'));
  const labelOf = (machine: string) => peers.get(machine)?.config.label ?? configs.find(c => c.id === machine)?.label ?? machine;
  const machineRefusal = (machine: string, why: string): Refusal => ({ name: labelOf(machine), reason: `${labelOf(machine)} : ${why}` });
  /** A machine's part is over (answered, refused, timed out or dropped); the last one sends the merged result. */
  function settleBroadcast(b: PendingBroadcast, machine: string) {
    const timer = b.waiting.get(machine); if (timer === undefined) return;
    clearTimeout(timer); b.waiting.delete(machine);
    if (!b.waiting.size) finishBroadcast(b);
  }
  function finishBroadcast(b: PendingBroadcast) {
    if (broadcasts.get(b.rid) === b) broadcasts.delete(b.rid);
    // A reason only when nothing went anywhere: every machine silent, else the first daemon's own reason.
    const reason = b.sent.length ? undefined : b.asked > 0 && b.silent === b.asked ? BROADCAST_SILENT : b.reasons[0] ?? b.empty ?? 'personne à qui écrire';
    emit({ type: 'session.broadcast.result', rid: b.rid, sent: b.sent, refused: b.refused, ...(reason ? { reason } : {}) });
  }
  /**
   * A broadcast reaches every machine that holds its sessions, each daemon writing to its own (broadcast spec):
   * - sessions: grouped by machine (a qualified id), each machine sent its own ids; an unqualified entry is a name, the local daemon's;
   * - a project: the local daemon by the project (its registry is the app's); each other machine where the registry places the
   *   project (its repos and rules), by the ids of its sessions that the registry files there and that a broadcast can reach.
   * An unavailable machine is one refusal naming it, a machine that does not announce `broadcast` too (never sent: C-1), a part the
   * protocol refuses too (its reason said). Each part has its own rid (`partRid`), so each daemon's dedupe holds.
   */
  function sendBroadcast(msg: BroadcastMessage) {
    const parts = new Map<string, { to: BroadcastMessage['to']; label?: string }>();
    const b: PendingBroadcast = { rid: msg.rid, waiting: new Map(), parts: new Map(), sent: [], refused: [], reasons: [], silent: 0, asked: 0 };
    const offline = new Set<string>();
    if ('sessions' in msg.to) {
      const byMachine = new Map<string, string[]>();
      for (const raw of msg.to.sessions) {
        const o = splitId(raw), known = o && peers.has(o.machine);
        // A machine in the list but not connected to (disabled): offline, as one whose connection is down.
        if (o && !known && configs.some(c => c.id === o.machine)) { offline.add(o.machine); continue; }
        const [m, id] = known ? [o!.machine, o!.id] : ['local', raw];
        byMachine.set(m, [...(byMachine.get(m) ?? []), id]);
      }
      for (const [m, ids] of byMachine) parts.set(m, { to: { sessions: ids } });
    } else {
      const reg = projects, q = msg.to.project;
      const project = reg?.projects.find(x => x.id === q) ?? reg?.projects.find(x => x.name.toLowerCase() === q.toLowerCase());
      if (!reg || !project) parts.set('local', { to: msg.to });   // the local daemon finds it (a folder its sessions work in) or says it knows none
      else {
        b.empty = `personne à qui écrire dans le projet ${project.name}`;
        const where = new Set([...project.repos.map(r => r.machine), ...reg.rules.filter(r => r.project === project.id).map(r => r.machine)]);
        for (const m of where) {
          if (m === 'local') { parts.set('local', { to: { project: project.id } }); continue; }
          const p = peers.get(m); if (!p) continue;   // not a machine connected to (disabled, or gone from the list)
          if (!available(p)) { offline.add(m); continue; }
          const ids = p.snapshot!.sessions.filter(s => broadcastRecipient(s) && projectOf({ machineId: m, cwd: s.cwd }, reg) === project.id).map(s => s.id);
          if (ids.length > BROADCAST_SESSIONS_MAX) b.refused.push(machineRefusal(m, `${ids.length - BROADCAST_SESSIONS_MAX} session(s) de plus non atteintes (${BROADCAST_SESSIONS_MAX} au plus)`));
          // Its recipients are told the project, not each other's names.
          if (ids.length) parts.set(m, { to: { sessions: ids.slice(0, BROADCAST_SESSIONS_MAX) }, label: broadcastLabel({ project: project.name }).slice(0, BROADCAST_LABEL_MAX) });
        }
      }
    }
    // The same rid sent again while still in flight replaces it: the older parts' timers are dropped.
    for (const t of broadcasts.get(msg.rid)?.waiting.values() ?? []) clearTimeout(t);
    broadcasts.set(msg.rid, b);
    const partOf = (m: string, to: BroadcastMessage['to'], label?: string): BroadcastMessage =>
      ({ type: 'session.broadcast', rid: partRid(msg.rid, m), to, text: msg.text, ...(msg.summary !== undefined ? { summary: msg.summary } : {}), ...(label ? { label } : {}) });
    // The text itself refused (too long, empty): nothing goes anywhere, and the result says why.
    const whole = partRefusal(partOf('local', { sessions: ['-'] }));
    if (whole?.whole) { b.reasons.push(whole.why); finishBroadcast(b); return; }
    for (const [m, { to, label }] of parts) {
      if (!available(peers.get(m))) { offline.add(m); continue; }
      // An old daemon, or an old bridge behind it, does not know the message: its SSH link would drop on it. Never sent.
      if (!knowsBroadcast(m)) { b.refused.push(machineRefusal(m, 'version trop ancienne')); b.reasons.push('version trop ancienne'); continue; }
      const part = partOf(m, to, label);
      const bad = partRefusal(part);
      if (bad) { b.refused.push(machineRefusal(m, bad.why)); b.reasons.push(bad.why); continue; }
      b.asked++; b.parts.set(m, part.rid);
      b.waiting.set(m, setTimeout(() => { b.silent++; b.refused.push(machineRefusal(m, BROADCAST_NO_ANSWER)); settleBroadcast(b, m); }, BROADCAST_TIMEOUT_MS));
      peers.get(m)!.client.send(part);
    }
    for (const m of offline) b.refused.push(machineRefusal(m, 'hors ligne'));
    if (!b.waiting.size) finishBroadcast(b);
  }
  function add(c: MachineConfig) {
    const client = makeClient({ url: machineUrl(c, configs[0]!), token: opts.token });
    const p: Peer = { config: c, client, status: 'connecting', fresh: false, snapshot: null, previews: new Map(), browsers: new Map(), off: [] }; peers.set(c.id, p);
    p.off.push(client.onMessage(m => receive(p, m)), client.onStatus(s => {
      const shown = shows(p);
      p.status = s;
      if (s !== 'open') {
        p.fresh = false;
        // A launch in flight names its request, as the daemon's refusal does, so the form that sent it hears it.
        const op = operations.get(c.id), closing = closeRows.has(c.id);
        if (endOperation(c.id)) emit({ type: 'error', message: `${c.label} is offline`, ...(op === 'launch' ? { request: 'session.launch' } : closing ? { request: 'session.close' } : {}) });
        for (const [requestId, owner] of attachmentAsks) if (owner === c.id) { attachmentAsks.delete(requestId); emit({ type: 'attachment.error', requestId, reason: 'offline' }); }
        for (const b of [...broadcasts.values()]) if (b.waiting.has(c.id)) { b.refused.push(machineRefusal(c.id, 'hors ligne')); settleBroadcast(b, c.id); }
        answerUnfoundInspections(c.id); answerUnfoundListings(c.id, 'offline'); answerFailedScans(c.id, 'offline'); answerFailedModels(c.id, 'offline'); answerFailedCommands(c.id, 'offline'); answerFailedRigs(c.id, 'offline');
        for (const [requestId, owner] of documents) if (owner === c.id) { documents.delete(requestId); emit({ type: 'document.error', requestId, path: '', code: 'read_failed' }); }
        if (routing?.coordinator === c.id) { const qid = routing.qid; routing = null; fail(qid, `${c.label} is offline`); }
        for (const [qid, b] of bindings) { const t = turns.get(qid); if (b.machine === c.id && t && !t.answeredAt && !t.error) fail(qid, `${c.label} is offline`); }
      }
      // A fallen peer retrying (connecting, unreachable, again) changes nothing the overlay shows: a snapshot would drop the
      // threads on screen and ask them again, the whole thread blinking at each retry.
      if (shows(p) === shown) refresh(); else publish();
    }));
    if (connected) client.connect();
  }
  for (const c of active()) add(c);
  function inventory(): RoutingContext {
    return { machines: state.map(m => ({ id: m.id, label: m.label, online: m.ready, local: m.id === 'local', sessions: m.sessions.slice(0, 500).map(s => ({ id: s.id, name: s.name, project: s.repo ?? s.project, cwd: s.cwd, topic: s.topic, state: s.state, readOnly: s.source === 'hook_only' })), folders: m.recents.slice(0, 100).map(r => ({ project: r.project, cwd: r.cwd })) })), history: [...turns.values()].slice(-30).map(t => ({ question: t.question.slice(0, 20000), answer: t.answer?.slice(0, 20000), machineId: t.machineId })) };
  }
  const api: DaemonClient = {
    connect() { connected = true; peers.forEach(p => p.client.connect()); publish(); history(); },
    close() { connected = false; peers.forEach(p => p.client.close()); }, status,
    onMessage(fn) { messages.add(fn); return () => { messages.delete(fn); }; },
    onStatus(fn) { statuses.add(fn); return () => { statuses.delete(fn); }; },
    send(msg) {
      if (msg.type === 'chat.reset') {
        if ([...turns.values()].some(t => !t.answeredAt && !t.error)) return;
        turns.clear(); bindings.clear(); resetAt = new Date().toISOString(); peers.forEach(p => { if (available(p)) p.client.send(msg); }); history(); return;
      }
      if (msg.type === 'chat.ask') {
        if (historyDay !== day()) { turns.clear(); bindings.clear(); historyDay = day(); }
        if (routing || [...turns.values()].some(t => !t.answeredAt && !t.error)) { emit({ type: 'chat.error', qid: msg.qid, message: 'one question at a time' }); return; }
        const context = inventory();
        turns.set(msg.qid, { qid: msg.qid, question: msg.text, askedAt: new Date().toISOString(), steps: [] }); history();
        if (active().length === 1) {
          const p = peers.get('local'); if (!available(p)) return fail(msg.qid, 'Local is offline');
          bindings.set(msg.qid, { machine: 'local', raw: msg.qid }); p!.client.send(msg); return;
        }
        const coordinator = [...peers.values()].find(p => available(p) && p.snapshot?.daemon?.routing);
        if (!coordinator) return fail(msg.qid, 'Update a connected daemon to enable multi-machine chat');
        routing = { qid: msg.qid, text: msg.text, tool: msg.tool, ...(msg.images ? { images: msg.images } : {}), coordinator: coordinator.config.id };
        coordinator.client.send({ type: 'chat.route', qid: msg.qid, text: msg.text, tool: msg.tool, context }); return;
      }
      if (msg.type === 'chat.cancel' && routing?.qid === msg.qid) { peers.get(routing.coordinator)?.client.send(msg); routing = null; fail(msg.qid, 'cancelled'); return; }
      // The usage threshold and « Compris » go to the machine named (local by default); a front sends them to each machine it
      // means. Before the session routing below: an alert's `id` is not a session's. An offline machine: nothing to send.
      if (msg.type === 'usage.set' || msg.type === 'usage.ack') {
        const target = peers.get(msg.machineId ?? 'local');
        if (!available(target)) return;
        const { machineId: _m, ...rest } = msg;
        target!.client.send(rest); return;
      }
      let machine = selected; let outgoing: ClientMessage = msg;
      if (msg.type === 'session.commands') {
        const origin = splitId(msg.id);
        if (!origin || !available(peers.get(origin.machine))) { emit({ type: 'session.commands.listing', requestId: msg.requestId, id: msg.id, commands: [], error: 'offline' }); return; }
        commandLists.set(msg.requestId, { machine: origin.machine, id: msg.id });
      }
      if ('id' in msg && msg.id !== undefined) { const origin = splitId(msg.id); if (!origin) { if (msg.type === 'attachment.put' || msg.type === 'attachment.get') emit({ type: 'attachment.error', requestId: msg.requestId, reason: 'offline' }); else emit({ type: 'error', id: msg.id, message: 'Unknown machine', request: msg.type }); return; } machine = origin.machine; outgoing = { ...msg, id: origin.id }; }
      if ('qid' in msg && msg.qid) { const b = bindings.get(msg.qid); if (!b) { emit({ type: 'error', message: 'Unknown conversation destination', request: msg.type }); return; } machine = b.machine; outgoing = { ...outgoing, qid: b.raw } as ClientMessage; }
      if (msg.type === 'attachment.put' || msg.type === 'attachment.get') {
        // A session's id routes (qualified above); a chat turn's image names its `machine`; neither is the local machine, never the selected one.
        if (msg.id === undefined) machine = (msg.type === 'attachment.get' && msg.machine) || LOCAL_MACHINE.id;
        if (outgoing.type === 'attachment.get') { const { machine: _m, ...rest } = outgoing; outgoing = rest; }
        if (!available(peers.get(machine))) { emit({ type: 'attachment.error', requestId: msg.requestId, reason: 'offline' }); return; }
        attachmentAsks.set(msg.requestId, machine);
      }
      if (msg.type === 'document.read') {
        if (active().length > 1 && !msg.machineId && !msg.sessionId) { emit({ type: 'document.error', requestId: msg.requestId, path: msg.path, code: 'read_failed' }); return; }
        if (msg.machineId) machine = msg.machineId;
        const origin = msg.sessionId ? splitId(msg.sessionId) : null;
        if (origin) { machine = origin.machine; outgoing = { ...msg, sessionId: origin.id }; }
        documents.set(msg.requestId, machine);
      }
      if (msg.type === 'session.launch' && msg.machineId) { machine = msg.machineId; const { machineId: _m, ...rest } = msg; outgoing = rest; }
      if (msg.type === 'repos.inspect') {
        machine = msg.machineId ?? 'local';
        const { machineId: _m, ...rest } = msg; outgoing = rest;
        const none = msg.paths.map(path => ({ path, exists: false as const, branch: null }));
        if (!available(peers.get(machine))) { emit({ type: 'repos.info', requestId: msg.requestId, repos: none }); return; }
        inspections.set(msg.requestId, machine); unfound.set(msg.requestId, none);
      }
      if (msg.type === 'repos.scan') {
        machine = msg.machineId ?? 'local';
        const { machineId: _m, ...rest } = msg; outgoing = rest;
        if (!available(peers.get(machine))) { emit({ type: 'repos.found', requestId: msg.requestId, repos: [], truncated: false, error: 'offline' }); return; }
        scans.set(msg.requestId, machine);
      }
      if (msg.type === 'models.list') {
        machine = msg.machineId ?? 'local';
        const { machineId: _m, ...rest } = msg; outgoing = rest;
        if (!available(peers.get(machine))) { emit({ type: 'models.listing', requestId: msg.requestId, tool: msg.tool, models: [], error: 'offline' }); return; }
        modelLists.set(msg.requestId, { machine, tool: msg.tool });
      }
      if (msg.type === 'openrig.status' || msg.type === 'openrig.act' || msg.type === 'openrig.specs' || msg.type === 'openrig.launch' || msg.type === 'openrig.seats'
        || msg.type === 'openrig.roles' || msg.type === 'openrig.role' || msg.type === 'openrig.roleFile' || msg.type === 'openrig.role.duplicate' || msg.type === 'openrig.asks' || msg.type === 'openrig.answer'
        || msg.type === 'openrig.goals' || msg.type === 'openrig.goal.send' || msg.type === 'openrig.goal.reply' || msg.type === 'openrig.row' || msg.type === 'openrig.graph' || msg.type === 'openrig.snapshots' || msg.type === 'openrig.permissions' || msg.type === 'openrig.queue' || msg.type === 'ping') {
        machine = msg.machineId ?? 'local';
        const { machineId: _m, ...rest } = msg; outgoing = rest;
        const kind: RigKind = msg.type === 'openrig.status' ? 'status' : msg.type === 'openrig.act' ? 'act' : msg.type === 'openrig.specs' ? 'specs' : msg.type === 'openrig.seats' ? 'seats'
          : msg.type === 'openrig.roles' ? 'roles' : msg.type === 'openrig.role' ? 'role' : msg.type === 'openrig.roleFile' ? 'roleFile' : msg.type === 'openrig.role.duplicate' ? 'roleDuplicate'
          : msg.type === 'openrig.asks' ? 'asks' : msg.type === 'openrig.answer' ? 'answer'
          : msg.type === 'openrig.goals' ? 'goals' : msg.type === 'openrig.goal.send' ? 'goalSend' : msg.type === 'openrig.goal.reply' ? 'goalReply' : msg.type === 'openrig.row' ? 'row' : msg.type === 'openrig.graph' ? 'graph' : msg.type === 'openrig.snapshots' ? 'snapshots' : msg.type === 'openrig.permissions' ? 'permissions' : msg.type === 'openrig.queue' ? 'queue' : msg.type === 'ping' ? 'ping' : 'launch';
        const ask: RigAsk = { machine, kind, ...(msg.type === 'openrig.role' || msg.type === 'openrig.roleFile' || msg.type === 'openrig.role.duplicate' ? { roleId: msg.roleId } : {}), ...(msg.type === 'openrig.roleFile' ? { path: msg.path } : {}), ...(msg.type === 'openrig.answer' ? { qitemId: msg.qitemId } : {}),
          ...(msg.type === 'openrig.goal.send' || msg.type === 'openrig.goal.reply' ? { goalId: msg.goalId } : {}), ...(msg.type === 'openrig.goal.reply' ? { replyId: msg.replyId } : {}), ...(msg.type === 'openrig.row' ? { qitem: msg.qitem } : {}), ...(msg.type === 'openrig.graph' || msg.type === 'openrig.snapshots' || msg.type === 'openrig.permissions' || msg.type === 'openrig.queue' ? { rig: msg.rig } : {}) };
        if (!available(peers.get(machine))) { emit(rigFailure(ask, msg.requestId, machine, 'offline')); return; }
        // What lot 7a added: a daemon without `openrigRig` would strip `rig.start`'s snapshot (and restore the wrong one), refuse the others, and
        // its refusal would fail every pending OpenRig ask of the machine. Answered here, outdated, nothing sent.
        const needsRig = msg.type === 'openrig.graph' || msg.type === 'openrig.snapshots' || msg.type === 'openrig.permissions' || msg.type === 'openrig.queue' || msg.type === 'openrig.role.duplicate'
          || (msg.type === 'openrig.act' && (msg.action.kind === 'rig.snapshot' || msg.action.kind === 'rig.permissions' || (msg.action.kind === 'rig.start' && msg.action.snapshot !== undefined)));
        if (needsRig && peers.get(machine)?.snapshot?.daemon?.openrigRig !== true) { emit(rigFailure(ask, msg.requestId, machine, 'outdated')); return; }
        // Lot 7c: `rig.policy` has its own flag (a lot-7a daemon has `openrigRig` but would refuse the action, failing every pending ask).
        if (msg.type === 'openrig.act' && msg.action.kind === 'rig.policy' && peers.get(machine)?.snapshot?.daemon?.openrigPolicy !== true) { emit(rigFailure(ask, msg.requestId, machine, 'outdated')); return; }
        // Lot 7d: `rig.start` with `fresh` and `ping` each have their own flag; an older daemon would drop `fresh` (and resume every seat) or not answer.
        if ((msg.type === 'openrig.act' && msg.action.kind === 'rig.start' && msg.action.fresh !== undefined && peers.get(machine)?.snapshot?.daemon?.openrigFresh !== true)
          || (msg.type === 'ping' && peers.get(machine)?.snapshot?.daemon?.ping !== true)) { emit(rigFailure(ask, msg.requestId, machine, 'outdated')); return; }
        rigAsks.set(msg.requestId, ask);
      }
      if (msg.type === 'folder.list') {
        if (msg.machineId) machine = msg.machineId;
        else if (msg.requestId !== undefined) machine = 'local';
        const { machineId: _m, ...rest } = msg; outgoing = rest;
        if (msg.requestId !== undefined) {
          if (!available(peers.get(machine))) { emit({ type: 'folder.listing', requestId: msg.requestId, path: msg.path || '~', parent: null, entries: [], error: 'offline' }); return; }
          listings.set(msg.requestId, { machine, path: msg.path || '~' });
        }
      }
      if (msg.type === 'folder.create') {
        if (msg.machineId) machine = msg.machineId;
        else if (msg.requestId !== undefined) machine = 'local';
        const { machineId: _m, ...rest } = msg; outgoing = rest;
        if (msg.requestId !== undefined) {
          if (!available(peers.get(machine))) { emit({ type: 'folder.listing', requestId: msg.requestId, path: msg.parent, parent: null, entries: [], error: 'offline' }); return; }
          listings.set(msg.requestId, { machine, path: msg.parent, created: `${msg.parent === '/' ? '' : msg.parent}/${msg.name.trim()}` });
        }
      }
      // « Activer le direct… » changes this machine's Playwright config: the local daemon's.
      if (msg.type === 'update.daemon' || msg.type === 'browser.enable') machine = 'local';
      if (msg.type === 'session.broadcast') { sendBroadcast(msg); return; }
      // Ledge's tasks are the local daemon's: its sessions are named there without their machine.
      if ((msg.type === 'task.cmd' && !msg.qid) || msg.type === 'action.run') machine = 'local';
      if (outgoing.type === 'task.cmd') { const o = outgoing.to ? splitId(outgoing.to) : null; if (o) outgoing = { ...outgoing, to: o.id }; const b = splitId(outgoing.by); if (b && outgoing.by !== LEDGE_GIVER) outgoing = { ...outgoing, by: b.id }; }
      if (msg.type === 'snapshot.request') { publish(); history(); return; }
      const target = peers.get(machine);
      if (!available(target)) {
        if (msg.type === 'document.read') { documents.delete(msg.requestId); emit({ type: 'document.error', requestId: msg.requestId, path: msg.path, code: 'read_failed' }); }
        else emit({ type: 'error', ...('id' in msg ? { id: msg.id } : {}), message: `${target?.config.label ?? machine} is offline`, request: msg.type });
        return;
      }
      if (outgoing.type === 'session.launch' || outgoing.type === 'session.relay' || outgoing.type === 'session.relay.cancel') { closeRows.delete(machine); operations.set(machine, outgoing.qid ?? 'launch'); }
      if (outgoing.type === 'session.close') {
        const all = turns.get(msg.type === 'session.close' ? msg.qid : '')?.closes ?? [];
        // Nothing to wait for on an unknown turn or one without closes: the daemon's error or history settles it, never a held operation.
        if (all.length) { closeRows.set(machine, { qid: outgoing.qid, rows: outgoing.rows ?? all.map((_, i) => i), errors: all.map(c => c.error) }); operations.set(machine, outgoing.qid); }
      }
      target!.client.send(outgoing);
    },
    fleet: {
      primary: peers.get('local')!.client,
      subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }, machines: () => state, selected: () => selected,
      select(id) { if (!peers.has(id)) return; selected = id; publish(); },
      configure(raw) {
        const next = parseMachines(raw);
        // (parseMachines pins the local url, so the permanent local client, also used by the app updater, cannot change.)
        // Daemon-sourced: ask the daemon and wait for its broadcast, which `receive` applies. A closed socket would drop the request silently.
        if (source === 'daemon') {
          const local = peers.get('local')!.client;
          if (local.status() !== 'open') throw Object.assign(new Error('The local daemon is not connected'), { name: 'DaemonOffline' });
          local.send({ type: 'machines.set', machines: toWire(next) }); return;
        }
        localStorage.setItem(MACHINES_KEY, JSON.stringify(next));
        apply(next);
      },
      configured: () => configs,
      machinesSource: () => source,
      probe: ssh => probeMachine(configs[0]!.url!, ssh, { token: opts.token }),
      // The last try's error is forgotten: the machine is « connecting » until its next answer (a snapshot, or an error again).
      retry(id) { const p = peers.get(id); if (!p || !connected) return; p.error = undefined; p.client.connect(); publish(); },
      terminal(id, opts) { const origin = splitId(id); const m = state.find(x => x.id === origin?.machine); return origin && m ? terminalCommand(m, origin.id, opts) : null; },
      shell(id) {
        const origin = splitId(id); const m = state.find(x => x.id === origin?.machine);
        const s = m?.sessions.find(x => x.id === origin?.id);
        return m && s ? shellCommand(m, s.workdir ?? s.cwd) : null;
      },
      turnMachine(qid) { return state.find(m => m.id === bindings.get(qid)?.machine); },
      documentMachine(id) { return splitId(id)?.machine; },
      localSnapshot: () => peers.get('local')?.snapshot ?? null,
      sendTo(machine, msg) { const p = peers.get(machine); if (!available(p)) return false; p!.client.send(msg); return true; },
      onMachineMessage(fn) { machineMessages.add(fn); return () => { machineMessages.delete(fn); }; },
      projects: () => projects,
      setProjects(next) {
        const valid = ProjectsSchema.parse(next);
        const local = peers.get('local')!.client;
        if (local.status() !== 'open') throw Object.assign(new Error('The local daemon is not connected'), { name: 'DaemonOffline' });
        // A daemon that knows projects sends them after its snapshot; one that never did would refuse projects.set as invalid.
        if (projects === null) throw Object.assign(new Error('Update the local Ledge daemon: it does not know projects'), { name: 'DaemonOutdated' });
        local.send({ type: 'projects.set', projects: valid });
      },
      island: () => island,
      setIsland(next) {
        const valid = IslandPrefsSchema.parse(next);
        const local = peers.get('local')!.client;
        if (local.status() !== 'open') throw Object.assign(new Error('The local daemon is not connected'), { name: 'DaemonOffline' });
        if (island === undefined) throw Object.assign(new Error('Update the local Ledge daemon: it does not know the island settings'), { name: 'DaemonOutdated' });
        local.send({ type: 'island.set', prefs: valid });
      },
      mobile: () => mobile,
      mobileError: () => mobileError,
      terminalHolders: () => holders,
      releaseTerminal(id) {
        const local = peers.get('local')!.client;
        if (local.status() !== 'open') throw Object.assign(new Error('The local daemon is not connected'), { name: 'DaemonOffline' });
        const origin = splitId(id);
        if (origin?.machine !== 'local') return;
        local.send({ type: 'terminal.release', id: origin.id });
      },
      tasks: () => taskList,
      usage: () => usage,
      setUsageAlert(alert) {
        const prefs = UsagePrefsSchema.parse({ alert });
        // One threshold for every machine (M7): each daemon keeps its own copy, so each is told.
        // A machine away gets it when it comes back.
        // Every machine configured, heard from this run or not: one away gets it when it comes back.
        for (const [id, peer] of peers) {
          if (available(peer)) { peer.client.send({ type: 'usage.set', prefs }); owedPrefs.delete(id); }
          else owedPrefs.set(id, { prefs, at: Date.now(), was: usage.get(id)?.prefs.alert ?? owedPrefs.get(id)?.was ?? null });
        }
        keepOwed();
      },
      ackUsage(id) {
        // The same account on two machines: the same alert on both, put away on both.
        if (!acked.includes(id)) { acked.push(id); if (acked.length > ACKED_MAX) acked.splice(0, acked.length - ACKED_MAX); keepOwed(); }
        for (const [machine, u] of usage) {
          if (!u.alerts.some(a => a.id === id) || !available(peers.get(machine))) continue;
          ackSent.add(`${machine}|${id}`);
          peers.get(machine)!.client.send({ type: 'usage.ack', id });
        }
      },
      contextNear: () => contextNear,
      setContextNear(near) {
        const valid = ContextPrefsSchema.parse({ near });
        const local = peers.get('local')!.client;
        if (local.status() !== 'open') throw Object.assign(new Error('The local daemon is not connected'), { name: 'DaemonOffline' });
        if (contextNear === undefined) throw Object.assign(new Error('Update the local Ledge daemon: it does not know the context threshold'), { name: 'DaemonOutdated' });
        local.send({ type: 'context.set', prefs: valid });
      },
      // `send` always answers a broadcast, merged, within BROADCAST_TIMEOUT_MS: nothing more to wait for here.
      broadcast(to, text, rid = `broadcast-${Date.now()}-${++broadcastSeq}`) {
        return new Promise<BroadcastResult>(resolve => {
          const listen = (m: ServerMessage) => { if (m.type === 'session.broadcast.result' && m.rid === rid) { messages.delete(listen); resolve(m); } };
          messages.add(listen);
          api.send({ type: 'session.broadcast', rid, to, text });
        });
      },
      sendMobile(msg) {
        const local = peers.get('local')!.client;
        if (local.status() !== 'open') throw Object.assign(new Error('The local daemon is not connected'), { name: 'DaemonOffline' });
        if (mobile === undefined) throw Object.assign(new Error('Update the local Ledge daemon: it does not know mobile access'), { name: 'DaemonOutdated' });
        if (mobileError) { mobileError = undefined; listeners.forEach(fn => fn()); }
        local.send(msg);
      }
    }
  };
  publish();
  return api;
}
