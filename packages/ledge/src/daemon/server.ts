import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { actionById, autonomyArgs, contextNear, ompApprovalFor, askShown, type ChatAction, type Autonomy } from '@ledge/protocol';
import { ATTACHMENT_LOCAL_MAX, DEFAULT_RELAY_URL, NOTE_NOT_TYPED, PROTOCOL_PORT, SshAliasSchema, offers, parseClientMessage, pendingKey, type AttachmentRef, type ImageUpload, type ChatErrorCode, type ClientMessage, type RigPlan, type RigResultCode, type DaemonInfo, type Projects, type MobileState, type Decision, type Pending, type ServerMessage, type Session, type SessionEvent, type Machine, type Tool, type OmpApproval, type CloseHow, type ModelRefusal, type RefusalCode, backendOf, MANDATE_CATEGORY_LABEL } from '@ledge/protocol';
import type { Store } from './store.js';
import type { History } from './history.js';
import { AttachmentError, AttachmentStore } from './attachments.js';
import { withImages } from '../attachmentText.js';
import type { Tmux } from '../tmux.js';
import { adapterFor, type KeyPlan } from '../adapters/index.js';
import { Refusal, STALE, bottomLines, dialogMismatch } from '../adapters/types.js';
import { verifyGone } from '../adapters/verify.js';
import { DETECT_LINES } from './poller.js';
import { answeredBy, pendingTool } from './state.js';
import { claudeOpenCall, claudeToolAnswered, labelTranscript, resumeLabel } from './transcript.js';
import { pickName } from '../names.js';
import { readPeers, type ClaudePeer } from './peers.js';
import { spawnSession, type TmuxTool } from '../spawn.js';
import { createOmpHost, type OmpHost } from './omp/host.js';
import { ompChoices } from './omp/catalog.js';
import { inspectRepos } from './repos.js';
import { extraRoots, scanRepos } from './scan.js';
import { createFolder, listFolder, resolveFolder } from './folders.js';
import { loginShellEnv } from '../shell-path.js';
import { log } from '../log.js';
import { tooWide, type Chat } from '../chat/service.js';
import { createChatThreads } from '../chat/threads.js';
import { createForge } from '../chat/forge.js';
import { paths } from '../paths.js';
import { ensureDaemonToken, hostAllowed, requestAuthorized, selectDaemonProtocol, sessionKey, tokenEquals } from '../auth.js';
import { readMachines, writeMachines } from './machines.js';
import { readProjects, writeProjects } from './projects.js';
import { readContextPrefs, readIsland, writeContextPrefs, writeIsland } from './island.js';
import { readDocument } from './documents.js';
import { createModels, type Models } from './models.js';
import { createRelay, free } from './relay.js';
import { launchFromChat, LaunchRefused } from '../chat/launch.js';
import { rigManaged, RigManagedError } from './openrig/guard.js';
import { cardOf, closeFromChat, CloseRefused } from '../chat/close.js';
import { actFromChat, ActRefused } from '../chat/act.js';
import type { ChatMessage } from '../chat/service.js';
import { actionMessage, resolveAction, resolveRun, runGuard, type Resolved } from './actions.js';
import { createMailbox, type MailJournal } from './mailbox.js';
import { createAsks, type Asks, type AsksJournal } from './asks.js';
import type { Bridge } from './openrig/bridge.js';
import { createRemotePeers } from './openrig/remote.js';
import { createRigAggregate } from './openrig/aggregate.js';
import { createRigRouter, isRigCommand } from './openrig/router.js';
import { createAnswerQueue } from './openrig/answerQueue.js';
import type { DaemonClient } from '@ledge/fleet/client';
import { listSpecs } from './openrig/specs.js';
import { OpenRigUnreachable } from './openrig/http.js';
import { pairSession, restorePairs, unpairGone } from './openrig/pairing.js';
import { createAnswers, type Answers } from './openrig/answer.js';
import { ANSWER_PATH } from './openrig/facts.js';
import { actOnRig } from './openrig/actions.js';
import { HUMAN_ADDRESS } from './openrig/facts.js';
import { createLedgeThread } from './ledgeThread.js';
import { createLedgeSay } from './ledgeSay.js';
import { createSeatSend } from './openrig/seatSend.js';
import { createRidMemo } from './openrig/ridMemo.js';
import { createPlans, prepareRigPlan } from './openrig/plan.js';
import { createLaunches } from './openrig/launch.js';
import { adoptRig } from './openrig/adopt.js';
import { mandateSummary } from './openrig/seatContext.js';
import { execGitSlow } from './openrig/workspace.js';
import { watchRigRepos } from './openrig/repos.js';
import { createHandovers, heldNames } from './handover.js';
import { createBrain, brainArgs, brainEnv, localDay } from './brain/session.js';
import { isBrainTool } from './brain/settings.js';
import { createMemory } from './brain/memory.js';
import { DEFAULT_MANDATE, ensureMandate, escalateCategory, parseMandate } from './brain/mandate.js';
import { createBrainInbox } from './brain/inbox.js';
import { brainResponder, BRAIN_FIRST_TEXT } from './brain/responder.js';
import { createDeciding, type Deciding } from './brain/decide.js';
import { createRevisit } from './brain/revisit.js';
import { createBrainCommands, parseBrainArgs, NOT_BRAIN_LINE, type RigActMsg, type RigPrepareMsg, type RigResult } from './brain/commands.js';
import { readContext } from './context.js';
import type { createDaemonUpdater } from '../update/run-update.js';
import { createRouter } from '../chat/routing.js';
import { serveSsh } from '../transport/ssh.js';
import type { MobileService } from '../mobile/service.js';
import { createPhoneGateway, type PhoneGateway } from '../mobile/gateway.js';
import { createNotifier } from '../mobile/push/notifier.js';
import { chatEndPayload } from '../mobile/push/triggers.js';
import { pushFor } from '../mobile/push/triggers.js';
import { createChallengeStore } from '../mobile/challenges.js';
import { rpOf } from '../mobile/webauthn.js';
import { MAX_FRAME } from '../transport/frames.js';

/** How each agent resumes the folder's last conversation, all three verified (Cursor Agent: `--continue`). */
export const CONTINUE_ARGS: Record<TmuxTool, string[]> = { claude: ['--continue'], codex: ['resume', '--last'], cursor: ['--continue'] };

/** How each agent continues one conversation by its own id (Claude Code and Cursor Agent `--resume <id>`, Codex `resume <id>`). */
export const RESUME_ARGS: Record<TmuxTool, (id: string) => string[]> = { claude: id => ['--resume', id], codex: id => ['resume', id], cursor: id => ['--resume', id] };

/** The agent's own conversation id: the one its hooks gave, else, for Claude Code, the name of its transcript file. */
export function resumeKey(s: Session): string | undefined {
  // OMP resumes by the exact journal, never by "the latest one of the folder" (spec 2026-10-20 §4).
  if (s.tool === 'omp') return s.agentSessionFile;
  if (s.agentSessionId) return s.agentSessionId;
  return s.tool === 'claude' && s.transcriptPath ? basename(s.transcriptPath, '.jsonl') : undefined;
}

/** The harnesses that take extra folders, and how. Claude only (verified: `claude --add-dir a b -- "prompt"`). */
export const MULTI_DIR_ARGS: Partial<Record<TmuxTool, (dirs: string[]) => string[]>> = { claude: dirs => ['--add-dir', ...dirs] };

/** How each agent takes a model (#58): Claude Code `--model`, Codex `-m` (also after `resume`), Cursor Agent `--model`. */
export const MODEL_ARGS: Record<TmuxTool, (model: string) => string[]> = { claude: m => ['--model', m], codex: m => ['-m', m], cursor: m => ['--model', m] };
/** How each agent takes an effort; Cursor Agent has none apart from its model id (`gpt-5.3-codex-high`). */
export const EFFORT_ARGS: Partial<Record<TmuxTool, (effort: string) => string[]>> = { claude: e => ['--effort', e], codex: e => ['-c', `model_reasoning_effort="${e}"`] };

/** The agent's arguments for a `session.launch`: the resume flag, the model and effort, then the first instruction as the positional prompt. */
export function launchArgs(msg: { tool: TmuxTool; prompt?: string; continue?: boolean; dirs?: string[]; model?: string; effort?: string; autonomy?: Autonomy }): string[] {
  const prompt = msg.prompt?.trim();
  const more = msg.dirs?.length ? MULTI_DIR_ARGS[msg.tool]?.(msg.dirs) : undefined;
  const model = msg.model ? MODEL_ARGS[msg.tool](msg.model) : [];
  const effort = msg.effort ? EFFORT_ARGS[msg.tool]?.(msg.effort) ?? [] : [];
  // The `--` only follows --add-dir: the option is variadic and would swallow the prompt.
  return [...(msg.continue ? CONTINUE_ARGS[msg.tool] : []), ...model, ...effort, ...autonomyArgs(msg.tool, msg.autonomy), ...(more ?? []), ...(prompt ? [...(more ? ['--'] : []), prompt] : [])];
}

export { resolveFolder };

/** A deny with a note whose deny keys went but whose input box never came back: refused, the note not typed (NOTE_NOT_TYPED). */
class NoteNotTyped extends Refusal { constructor() { super('denied, but the note could not be typed', NOTE_NOT_TYPED); } }

/** Where `handle` sends its answers: the one socket that asked, or the phone gateway's device. */
export type Reply = (m: ServerMessage) => void;

/**
 * Origins allowed to open a WebSocket: the Tauri overlay (packaged and dev server). A browser always
 * sends Origin, so any other web page is refused; Node clients (hook, launcher, status) send none.
 * Origin is not enough: every client must also present the daemon token, and Host must be loopback.
 */
/** How long the hooks of a deleted session are ignored: its late SessionEnd or last Stop must not bring it back. */
export const DELETED_TTL_MS = 5 * 60 * 1000;
/** How long after a model change the end hooks of the agent it replaced are ignored: they must not end the new one. */
export const RESPAWN_HOOKS_MS = 10 * 1000;

export const ALLOWED_ORIGINS: readonly string[] = [
  'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:1420', 'http://127.0.0.1:1420',
  // Desktop's Vite dev server (spec 2026-10-14 §5.4)
  'http://localhost:1421', 'http://127.0.0.1:1421'
];

export function originAllowed(origin: string | undefined): boolean {
  return origin === undefined || ALLOWED_ORIGINS.includes(origin);
}

function requestPath(url: string | undefined): string {
  const raw = url ?? '/';
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

/** Why a handshake is refused, or null when path, origin, host and token all pass. The reason is safe to log. */
function refusal(req: IncomingMessage, token: string): 'path' | 'origin' | 'host' | 'auth' | null {
  const path = requestPath(req.url);
  if (!(path === '/' || (path.startsWith('/ssh/') && SshAliasSchema.safeParse(path.slice(5)).success))) return 'path';
  if (!originAllowed(req.headers.origin)) return 'origin';
  if (!hostAllowed(req.headers.host)) return 'host';
  if (!requestAuthorized(req.headers, token)) return 'auth';
  return null;
}

/** Plain HTTP is not a daemon API. 401, and no CORS headers, so a browser page cannot read the response. */
function unauthorized(req: IncomingMessage, res: ServerResponse): void {
  req.resume();
  const body = 'Unauthorized\n';
  res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', Connection: 'close' });
  res.end(body);
}

export interface ServerHandle {
  port: number; close(): Promise<void>; broadcast(msg: ServerMessage): void;
  /** Remembers a session's terminal preview and broadcasts it; a client that connects later gets it after the snapshot. */
  preview(id: string, lines: string[]): void;
  /** Whether some client follows this session in color (`session.preview.subscribe`). */
  colorWanted(id: string): boolean;
  /** Whether a colored image of this session is held (dropped when no client follows it any more). */
  colorCached(id: string): boolean;
  /** Sends the colored preview to the clients that follow `id`, and to them only. */
  sendColorPreview(id: string, lines: string[]): void;
  /** The OMP processes this daemon owns. */
  omp: OmpHost;
  /** Closes a session cleanly (its exit command, a kill as a last resort); rejects with a Refusal. */
  closeSession(id: string): Promise<{ how: CloseHow }>;
  /** Runs the unsent-images sweep now (it also runs at start and every 24 h). */
  sweepAttachments(): Promise<void>;
  /** Writes the resume labels that waited for their Claude process to end (the poller calls it every tick). */
  labelExited(): void;
  /** The decisions lone sessions ask the user: the OpenRig bridge mirrors the open ones. */
  asks: Asks;
  /** The shared projects, as last set. */
  projects(): Projects;
  /** Ledge's voice: a line in its thread (what it did on its own, e.g. starting OpenRig). */
  say(text: string): void;
}

/**
 * A permission request that left the pending untouched was dropped by the reducer (session exited, another
 * requester already holds the card, or the same helper asked twice). The main thread refining its own card is not a drop.
 */
function logDroppedRequest(id: string, ev: SessionEvent, before: Session | undefined, after: Session | undefined): void {
  if (ev.name !== 'PermissionRequest' || !after || after.pending !== before?.pending) return;
  const held = before?.pending;
  if (held && !held.helperId && !ev.helperId) return;
  const who = ev.helperId ? `helper ${ev.helperId}` : 'main thread';
  const why = after.state === 'exited' ? 'the session has exited'
    : held ? `${held.helperId ? `helper ${held.helperId}` : 'the main thread'} already holds the pending request` : 'nothing was set';
  log(`${who} permission for ${ev.tool ?? 'a tool'} on ${id} not routed: ${why}`);
}

/**
 * `launcher` is the command that runs this very CLI inside WSL (node + the built script): the overlay appends
 * `attach <id>` to it to open a terminal tab on a session. `home` is where `~` expands for `session.launch`.
 */
export async function startServer(opts: { store: Store; tmux: Tmux; port?: number; host?: string; now?: () => string; verify?: { attempts?: number; intervalMs?: number }; confirmMs?: number; untilMs?: number; launcher?: string[]; home?: string; agentEnv?: () => Promise<NodeJS.ProcessEnv>; chat?: Chat; claudeBin?: string[]; daemon?: DaemonInfo; updater?: ReturnType<typeof createDaemonUpdater>; ssh?: typeof serveSsh; history?: History; machinesFile?: string; projectsFile?: string; islandFile?: string; contextFile?: string; scan?: typeof scanRepos; models?: Models; mobile?: MobileService; mobileUnavailable?: string; omp?: OmpHost; close?: { freeMs?: number; exitMs?: number }; peers?: () => readonly ClaudePeer[]; mail?: MailJournal; asks?: AsksJournal; handoverBriefMs?: number; attachments?: AttachmentStore; openrig?: Bridge;
  /** How the remote peers reach a machine's daemon (default: this daemon's own `/ssh/<alias>`); tests point it at another daemon. */
  remoteConnect?: (machine: Machine, url: string) => DaemonClient }): Promise<ServerHandle> {
  const { store, tmux } = opts;
  const now = opts.now ?? (() => new Date().toISOString());
  const launcher = opts.launcher ?? [process.execPath, process.argv[1] ?? 'ledge'];
  // Under systemd the daemon has the bare system environment (no PATH to the agents, no proxy): a launched agent gets
  // the login shell's on top of it, as a terminal would.
  const agentEnv = opts.agentEnv ?? (async () => ({ ...process.env, ...(await loginShellEnv()) }));
  const attachments = opts.attachments ?? new AttachmentStore(paths().attachments);
  const mirror = opts.openrig;
  const threads = createChatThreads({ attachments, store, tmux, home: paths().dir, userHome: opts.home, env: agentEnv, bin: opts.claudeBin, now, projects: () => projects, forge: createForge({ env: agentEnv }),
    // Every machine's rigs and escalations (the aggregate, made further down once the server listens).
    ...(mirror ? { openrig: () => ({ rigs: aggregate?.rigs() ?? mirror.rigs(), escalations: aggregate?.escalations() ?? mirror.escalations() }) } : {}) });
  const chat: Chat = opts.chat ?? threads.desktop;
  const router = createRouter({ env: agentEnv });
  const omp = opts.omp ?? createOmpHost({ store, env: agentEnv, dir: join(paths().dir, 'omp'), now, attachments });
  const models = opts.models ?? createModels({ env: agentEnv, omp: async () => ompChoices(await omp.catalog(opts.home ?? homedir())) });
  const token = await ensureDaemonToken();
  const httpServer = createServer(unauthorized);
  const sockets = new Set<Socket>();
  httpServer.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const wss = new WebSocketServer({
    server: httpServer, maxPayload: MAX_FRAME,
    verifyClient: ({ req }: { req: IncomingMessage }) => {
      const why = refusal(req, token);
      if (why) {
        const origin = String(req.headers.origin ?? 'none').replace(/[\r\n]/g, '').slice(0, 120);
        log(`refused a connection (${why}) from origin ${origin}`);
      }
      return why === null;
    },
    handleProtocols: (protocols: Set<string>) => selectDaemonProtocol(protocols, token)
  });
  // ws re-emits the http server's errors on wss, and an EventEmitter without an 'error' listener throws: listen failures reject here, later ones are logged.
  await new Promise<void>((res, rej) => {
    const onError = (e: Error) => rej(e);
    wss.once('error', onError);
    httpServer.listen(opts.port ?? PROTOCOL_PORT, opts.host ?? '127.0.0.1', () => { wss.off('error', onError); res(); });
  });
  wss.on('error', e => log(`daemon server error: ${e.message}`));
  const port = (httpServer.address() as { port: number }).port;

  const machinesFile = opts.machinesFile ?? paths().machines;
  /** The machines list shared by every local front; copied so state never aliases DEFAULT_MACHINES. */
  let machines = readMachines(machinesFile).map(m => ({ ...m }));
  const machinesMsg = (): ServerMessage => ({ type: 'machines', machines });
  const projectsFile = opts.projectsFile ?? paths().projects;
  /** The projects and folder rules shared by every local front (build spec §5); never sent to a remote peer. */
  let projects = readProjects(projectsFile);
  const projectsMsg = (): ServerMessage => ({ type: 'projects', projects });
  const islandFile = opts.islandFile ?? paths().island;
  /** The island's settings, set from Desktop (atelier spec §7); never sent to a remote peer. */
  let island = readIsland(islandFile);
  const islandMsg = (): ServerMessage => ({ type: 'island', prefs: island });
  // The context threshold (context handover spec §3.2): past it a session is near its limit, and an `auto` session is relieved.
  const contextFile = opts.contextFile ?? join(paths().dir, 'context.json');
  let contextPrefs = readContextPrefs(contextFile);
  const contextMsg = (): ServerMessage => ({ type: 'context.prefs', prefs: contextPrefs });
  const mobile = opts.mobile;
  /** The mobile service failed to start: fronts see « unavailable » (and its reason), not a daemon too old to know mobile access. */
  const unavailable: MobileState | undefined = !mobile && opts.mobileUnavailable !== undefined
    ? { enabled: false, relayUrl: DEFAULT_RELAY_URL, account: null, signin: null, signinError: null, link: { state: 'unavailable', error: opts.mobileUnavailable.slice(0, 200) }, devices: [], pairings: [] }
    : undefined;
  const send = (ws: WebSocket, msg: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
  // Remote peers must never receive local snapshots, sessions, previews or chat broadcasts.
  const localClients = new Set<WebSocket>();
  const remoteClients = new Set<WebSocket>();
  /** The approved phones' way in and out, when mobile access is up; set once `dispatch` can run. */
  let gateway: PhoneGateway | undefined;
  /** The notifier is made after the gateway: a chat end reaches it through this. */
  let notifyChatEnd: ((deviceId: string, code?: ChatErrorCode) => void) | undefined;
  /** Every local front gets it; the phone gateway passes on only what it knows. */
  const broadcast = (msg: ServerMessage) => { for (const c of localClients) send(c, msg); gateway?.forward(msg); };
  threads.setEmitter('desktop', broadcast);
  const history = opts.history;
  await attachments.load().catch(e => log(`attachments not loaded: ${(e as Error).message}`));
  // Unsent images go after a day; the ones a session history or a live chat turn refers to stay.
  const sweepAttachments = async () => {
    try {
      const referenced = new Set([...(await history?.attachmentIds() ?? []), ...threads.attachmentIds(), ...chat.attachmentIds()]);
      const removed = await attachments.sweep(referenced);
      if (removed.length > 0) log(`attachments swept: ${removed.length}`);
    } catch (e) { log(`attachments sweep failed: ${(e as Error).message}`); }
  };
  void sweepAttachments();
  const sweepTimer = setInterval(() => { void sweepAttachments(); }, 24 * 3_600_000); sweepTimer.unref();
  const unsubscribeHistory = history ? [
    history.onItem((id, item) => {
      broadcast({ type: 'session.thread.item', id, item });
      // A late result of an older parallel call (same `at` as its call) never takes the last message back; a failed send never flies.
      const cur = store.get(id)?.lastMessage;
      if (item.kind === 'sent' && item.status !== 'read' && item.status !== 'failed' && cur?.id !== item.id && (!cur || item.at >= cur.at)) {
        store.patch(id, { lastMessage: { id: item.id, to: item.to, ...(item.peer ? { peer: item.peer } : {}), summary: item.summary ?? item.text.split('\n')[0]!.slice(0, 120), at: item.at } });
      }
    }),
    store.onEvent((id, ev) => history.record(id, ev)),
    store.onChange(c => { if (c.type === 'removed') history.forget(c.id); })
  ] : [];
  // Mobile access: local fronts only, never a remote peer.
  const unsubscribeMobile = mobile?.onChange(() => broadcast({ type: 'mobile', state: mobile.state() }));
  // One lock for both: a session is never typed into by the relay and the mailbox at once.
  const typing = new Set<string>();
  /** Sessions being closed: neither the relay nor the mailbox delivers to them, even free; their queues fail once they exit. */
  const closing = new Set<string>();
  // An injected chat (tests) is the only thread there is; otherwise the relay and the close cards work across the PC's and every device's.
  const cardThreads: Pick<typeof threads, 'all' | 'owner' | 'emitterOf' | 'queuedRelays'> = opts.chat ? {
    all: () => [['desktop', chat]], owner: qid => (chat.relay(qid) || chat.close(qid, 0) || chat.action(qid, 0) ? 'desktop' : undefined), emitterOf: () => broadcast,
    queuedRelays: () => chat.queuedRelays(broadcast).map(q => ({ thread: 'desktop' as const, ...q }))
  } : threads;
  /** `replyTo` for the mailbox and the relay, which keep the refusal's text. */
  const replyText = async (id: string, text: string) => (await replyTo(id, text))?.message ?? null;
  const mailbox = createMailbox({
    store, replyTo: replyText, typing, closing, now, ...(opts.mail ? { journal: opts.mail } : {}),
    relayQueued: id => cardThreads.queuedRelays().some(q => q.relay.id === id),
    sent: { record: (id, m) => { history?.recordSent(id, m); }, mark: (id, rid, status) => history?.markSent(id, rid, status) }
  });
  const relay = createRelay({ threads: cardThreads, store, replyTo: replyText, now, typing, closing, next: id => mailbox.kick(id) });
  /** The decisions lone sessions ask the user (`ledge ask`): every change reaches the local fronts. */
  const asks = createAsks({ store, mailbox, now, ...(opts.asks ? { journal: opts.asks } : {}), onAsk: ask => broadcast({ type: 'ask.updated', ask }) });
  /** The local OpenRig mirror: every change reaches the fronts; a rig gone takes its sessions' seats with it (never on a mere disconnect). */
  const bridge = opts.openrig;
  /** Ledge's thread (with or without OpenRig): every item, new or grown, reaches the local fronts. */
  const thread = createLedgeThread({ path: paths().ledgeThread, now });
  const unsubscribeThread = thread.onItem(item => broadcast({ type: 'ledge.thread.item', item }));
  const seatSend = bridge ? createSeatSend({ bridge }) : null;
  /** The launch plans `rig.prepare` made, taken once by `rig.launch`. */
  const rigPlans = createPlans(Date.now);
  /** A resent rig command (same rid) is answered from the first run, not run twice (24 h). */
  const ridMemo = createRidMemo();
  /** Rigs launched from a plan, until their lead has the goal; picked up again after a restart. */
  const launches = bridge && seatSend ? createLaunches({ cli: bridge.cli(), bridge, git: execGitSlow,
    send: (ref, text) => seatSend.send('local', ref, text), say: text => { thread.append({ kind: 'ledge', text }); },
    mandate: () => { const f = paths().mandate; let text: string | null = null; try { if (existsSync(f)) text = readFileSync(f, 'utf8'); } catch { /* unreadable: the default */ } return mandateSummary(text); },
    file: paths().rigLaunches, now: Date.now, setTimer: setTimeout, clearTimer: clearTimeout }) : null;
  launches?.resume();
  /** The repositories off-project rigs work in, looked for every 30 s. */
  const stopRepoWatch = bridge ? watchRigRepos({ bridge, sessions: () => store.all() }) : null;
  /** Messages to Ledge (`ledge.say`): one at a time through the desktop chat, whose `chat.*` every front gets. */
  const ledgeSay = createLedgeSay({ thread, chat, escalations: id => aggregate?.escalation(id) ?? bridge?.escalation(id), broadcast, tool: () => threads.deviceTool(),
    // `@seat …` goes to a rig seat; without OpenRig every text is a question to Ledge.
    toSeat: (rid, text) => (seatSend ? seatSend.fromSay(rid, text) : Promise.resolve(null)) });
  /** Answers to escalations, the one way to answer them (only with an OpenRig bridge). */
  const answers: Answers | null = bridge ? createAnswers({
    port: { escalation: bridge.escalation, patch: bridge.patchEscalation, status: bridge.status, cli: bridge.cli, http: bridge.http,
      replyRow: bridge.replyRow, setReplyRow: bridge.setReplyRow, humanRead: bridge.humanRead },
    asks, path: { kind: ANSWER_PATH }, localMachine: 'local', now }) : null;
  let deciding: Deciding | null = null;
  const remote = bridge ? createRemotePeers({ port, ...(opts.remoteConnect ? { connect: opts.remoteConnect } : {}) }) : null;
  const aggregate = bridge && remote ? createRigAggregate({ bridge, remote, machines: () => machines, projects: () => projects }) : null;
  const unsubscribeAggregate = aggregate?.onMessage(m => {
    broadcast(m);
    // Ledge's thread names the remote escalations and exchanges too (the local ones come from the bridge, below), once per id.
    if (m.type === 'escalation.updated' && m.escalation.machine !== 'local' && !thread.hasEscalation(m.escalation.id)) thread.append({ kind: 'escalation', escalationId: m.escalation.id });
    if (m.type === 'rig.exchange' && m.exchange.machine !== 'local') thread.exchange(m.exchange);
  });
  /** Answers to an unreachable machine's escalations, kept in openrig.json until its daemon takes them (sent once, same rid);
   *  what does not go is said in Ledge's thread. Follows the peers itself (open, its OpenRig running, rig.result, removed). */
  const answerQueue = aggregate && remote ? createAnswerQueue({ remote, aggregate, notice: text => { thread.append({ kind: 'ledge', text }); },
    labelOf: id => machines.find(m => m.id === id)?.label ?? id, machines: () => machines }) : null;
  /** Rig commands and answers go to their machine: 'local' to `handle` (its rid memo), another one to its peer. */
  const rigRouter = aggregate && remote && answerQueue ? createRigRouter({ aggregate, remote, answers: answerQueue, local: (msg, reply) => handle(msg, reply),
    labelOf: id => machines.find(m => m.id === id)?.label ?? id }) : null;
  // Local side effects only: the fronts get the bridge's messages through the aggregate.
  const unsubscribeBridge = bridge?.onMessage(m => {
    if (m.type === 'rig.snapshot' || m.type === 'rig.removed') unpairGone(store, bridge.rigs());
    if (m.type === 'rig.snapshot') restorePairs(store, bridge);
    // The bridge sends escalation.updated on every change and again after a reconnect: only an id the thread lacks is new.
    if (m.type === 'escalation.updated' && !thread.hasEscalation(m.escalation.id)) {
      thread.append({ kind: 'escalation', escalationId: m.escalation.id });
      deciding?.arrived(m.escalation);   // grace when the brain is on (Lot 7)
    }
    if (m.type === 'rig.exchange') thread.exchange(m.exchange);
  });
  // The relief of a session whose context is nearly full (context handover spec §3.3). `launch` and `closeSession` are hoisted.
  // The brain's relief (Lot 7, Task 10) is prepared by the brain, created just below: only called once both exist.
  const handovers = createHandovers({ store, mailbox, launch: req => launch(req), close: s => closeSession(s), brainRelief: s => brain.relief(s),
    dir: join(paths().dir, 'handovers'), now, ...(opts.handoverBriefMs !== undefined ? { briefMs: opts.handoverBriefMs } : {}) });
  /** Ledge's memory (rules and decisions), injected into the brain's instructions. */
  const memory = createMemory({ dir: paths().memoryDir, now });
  /**
   * The permanent brain session (Lot 7): launched through `session.launch`'s path with `brain: true`, an exited brain taken up
   * through `session.resume`'s, closed through `session.close`'s. Started below once the daemon serves, if the user enabled it.
   */
  const brain = createBrain({ store, settingsPath: paths().brainSettings, dir: paths().brainDir, memory, env: agentEnv, handovers,
    mandate: () => ensureMandate(paths().mandate),
    close: s => closeSession(s),
    launch: async o => {
      const key = o.resume ? resumeKey(o.resume) : undefined;
      if (o.resume && key) {
        const refused = await respawn(o.resume, key, o.resume.model, o.resume.effort);
        if (refused) throw new Error(refused);
        return store.get(o.resume.id) ?? o.resume;
      }
      return launch({ tool: o.tool, cwd: o.cwd, name: o.name, id: o.id, env: o.env, brain: true, ...(o.prompt ? { prompt: o.prompt } : {}) });
    } });
  /** What the brain is told, typed into its session through the mailbox. */
  const brainInbox = createBrainInbox({ mailbox, brainId: () => brain.session()?.id });
  /** The mandate as it reads now: a missing file is the default one (ensureMandate writes it), an unreadable one decides nothing. */
  const readMandate = () => {
    const f = paths().mandate;
    try { return parseMandate(existsSync(f) ? readFileSync(f, 'utf8') : DEFAULT_MANDATE); } catch { return parseMandate(''); }
  };
  if (bridge && answers) deciding = createDeciding({ escalations: { escalation: bridge.escalation, patchEscalation: bridge.patchEscalation },
    answers, thread, memory, inbox: brainInbox, mandate: readMandate, brainOn: () => brain.status().state === 'on' && ['idle', 'working'].includes(brain.session()?.state ?? ''), now: Date.now });
  /** « Revenir dessus » (Lot 7): a correction while the seat has not taken the reply, a conversation once it has. */
  const revisits = bridge && answers ? createRevisit({ memory, escalations: { escalation: bridge.escalation, patchEscalation: bridge.patchEscalation },
    answers, thread, inbox: brainInbox, brainOn: () => brain.status().state === 'on', bridge }) : null;
  // Ledge's thread is answered by the brain; the one-shot runner serves when there is none (it reads the status itself).
  ledgeSay.setResponder(brainResponder({ inbox: brainInbox, thread, fallback: ledgeSay.oneShot, status: brain.status, hasSession: () => brain.session() !== undefined, onStatus: brain.onStatus }));
  // The brain's daily relief, at its first free moment after local midnight (Lot 7, Task 10).
  const brainDayTimer = setInterval(() => {
    const s = brain.session();
    if (s) brain.checkRelief({ today: localDay(), idle: s.state === 'idle' });
  }, 60_000);
  brainDayTimer.unref?.();
  /** mandat.md as clients read it: a missing file is created with the default text. */
  const mandateText = (): string => {
    const f = paths().mandate;
    try { return readFileSync(f, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return ''; }
    try { writeMandate(DEFAULT_MANDATE); } catch (e) { log(`mandate not created: ${(e as Error).message}`); }
    return DEFAULT_MANDATE;
  };
  const writeMandate = (text: string): void => {
    const f = paths().mandate; mkdirSync(dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, text); renameSync(tmp, f);
  };
  const mandateMsg = (): ServerMessage => ({ type: 'mandate', text: mandateText(), path: paths().mandate });
  const rulesMsg = (): ServerMessage => ({ type: 'rules', items: memory.rules() });
  const decisionsMsg = (): ServerMessage => ({ type: 'decisions', items: memory.decisions({ limit: 200 }) });
  const unsubscribeMemory = memory.onChange(() => { broadcast(rulesMsg()); broadcast(decisionsMsg()); });
  const unsubscribeBrain = brain.onStatus(status => {
    broadcast({ type: 'brain.status', status });
    if (status.state !== 'on') deciding?.release(`brain ${status.state}`);
  });
  /** Each session's state last seen: a turn's end (→ idle) is when its context is read again. */
  const lastState = new Map<string, Session['state']>();
  /** Reads a session's context after a turn (§3.1); a session working without asking is relieved by Ledge past the threshold (§3.2). */
  const measure = async (id: string): Promise<void> => {
    const s = store.get(id); if (!s) return;
    const context = await readContext(s, now());
    const cur = store.get(id);
    if (!context || !cur) return;
    if (cur.context?.used !== context.used || cur.context.window !== context.window) store.upsert({ ...cur, context });
    // The brain has its own relief, at 70 % and every day (Lot 7, Task 10), never the generic one (ruling C11).
    if (cur.brain === true) { brain.checkRelief({ context, today: localDay(), idle: cur.state === 'idle' }); return; }
    const h = cur.handover?.state;
    if (contextNear(context, contextPrefs.near) && cur.autonomy === 'auto' && h !== 'briefing' && h !== 'launching' && h !== 'done' && h !== 'failed') {
      const refused = handovers.start(id, { auto: true });
      if (refused) log(`automatic relief of ${cur.name} not started: ${refused}`);
    }
  };
  /** The last preview per session, replayed after every snapshot so a late client does not wait for the agent to write. */
  const previews = new Map<string, string[]>();
  /** The title last pushed to each session's tmux tab, so tmux is told only when it changes. */
  const titles = new Map<string, string>();
  /** The `exitedAt` of the exit last labelled for `claude --resume`, per session: one label per exit. */
  const labelled = new Map<string, string>();
  /** Exited sessions whose label waits for their Claude process to end, retried by the poller. */
  const unlabelled = new Set<string>();
  const livePeers = opts.peers ?? (() => readPeers());
  /** Labels an exited launched Claude's transcript for `claude --resume`, once per exit, never while a live process holds it. */
  const labelExit = (s: Session): void => {
    unlabelled.delete(s.id);
    if (s.tool !== 'claude' || s.source !== 'launcher' || s.state !== 'exited' || !s.transcriptPath || !s.topic || s.topic === s.name || labelled.get(s.id) === (s.exitedAt ?? '')) return;
    const id = basename(s.transcriptPath, '.jsonl');
    if (livePeers().some(p => p.sessionId === id)) { unlabelled.add(s.id); return; }
    labelled.set(s.id, s.exitedAt ?? '');
    const r = labelTranscript(s.transcriptPath, s.name, resumeLabel(s.name, s.topic));
    if (r instanceof Error) log(`resume label of ${s.id} not written: ${r.message}`);
  };
  const labelExited = (): void => { for (const id of [...unlabelled]) { const s = store.get(id); if (s) labelExit(s); else unlabelled.delete(id); } };
  const unsubscribe = store.onChange(c => {
    if (c.type === 'recents') return broadcast({ type: 'recents', recents: c.recents });
    if (c.type === 'updated' && c.session.tmuxSession && titles.get(c.session.id) !== c.session.title) {
      titles.set(c.session.id, c.session.title);
      tmux.setOption(c.session.tmuxSession, '@ledge_title', c.session.title).catch(e => log(`tab title not set for ${c.session.id}: ${(e as Error).message}`));
    }
    if (c.type === 'removed') { previews.delete(c.id); titles.delete(c.id); labelled.delete(c.id); unlabelled.delete(c.id); lastState.delete(c.id); }
    if (c.type === 'updated') {
      const was = lastState.get(c.session.id); lastState.set(c.session.id, c.session.state);
      if (c.session.state === 'idle' && was !== undefined && was !== 'idle' && c.session.transcriptPath) void measure(c.session.id).catch(e => log(`context of ${c.session.id} not read: ${(e as Error).message}`));
    }
    if (c.type === 'updated') labelExit(c.session);
    if (c.type === 'updated' && c.session.modelNext) void applyModelNext(c.session.id).catch(e => log(`model change of ${c.session.id} failed: ${(e as Error).message}`));
    broadcast(c.type === 'updated' ? { type: 'session.updated', session: c.session } : { type: 'session.removed', id: c.id });
  });
  const sendSnapshot = (reply: Reply) => {
    reply({ type: 'snapshot', sessions: store.all(), recents: store.recents(), launcher, ...(opts.daemon ? { daemon: { ...opts.daemon, routing: true, archive: true, models: true, modelSwitch: true, omp: true, ompApproval: true, asks: true, ...(mobile || unavailable ? { mobile: true } : {}), ...(bridge ? { openrig: true } : {}), ...(aggregate ? { openrigFleet: true } : {}), colorPreview: true } } : {}) });
    reply(machinesMsg()); // spec §5.2: after each snapshot, the shared machines list
    reply(projectsMsg()); // then the shared projects (build spec §5)
    reply({ type: 'asks', asks: asks.all().filter(askShown) }); // then the decisions waiting for the user
    reply(islandMsg()); // then the island's settings
    if (mobile) reply({ type: 'mobile', state: mobile.state() }); // then mobile access
    else if (unavailable) reply({ type: 'mobile', state: unavailable });
    for (const [id, lines] of previews) if (store.get(id)) reply({ type: 'session.preview', id, lines });
    reply({ type: 'chat.history', turns: chat.history() });
    reply(contextMsg()); // the context threshold (context handover spec §3.2)
    if (aggregate) for (const m of aggregate.replay()) reply(m);
    reply({ type: 'brain.status', status: brain.status() });
    reply(mandateMsg()); reply(rulesMsg()); reply(decisionsMsg());
    reply({ type: 'ledge.thread.history', ...thread.page() }); // last: Ledge's thread, whose items name those escalations
  };
  /** The session each local client follows in color (one at most), and the last colored image per followed session. */
  const colorFollow = new Map<WebSocket, string>();
  const colorLast = new Map<string, string[]>();
  const colorWanted = (id: string) => { for (const v of colorFollow.values()) if (v === id) return true; return false; };
  const colorCached = (id: string) => colorLast.has(id);
  const sendColorPreview = (id: string, lines: string[]) => {
    // A capture can finish after its final subscriber leaves. Do not retain that stale frame.
    if (!colorWanted(id)) return;
    colorLast.set(id, lines);
    for (const [ws, followed] of colorFollow) if (followed === id) send(ws, { type: 'session.preview.color', id, lines });
  };
  const preview = (id: string, lines: string[]) => {
    if (!store.get(id)) return;
    previews.set(id, lines);
    broadcast({ type: 'session.preview', id, lines });
  };

  /** How long an `until` step waits for the screen the next keys are meant for, polled every UNTIL_POLL_MS. */
  const UNTIL_MS = opts.untilMs ?? 1500;
  const UNTIL_POLL_MS = 50;
  /** Enough for a dialog's bottom or a long draft wrapped in the input line, with the status under it. */
  const UNTIL_LINES = 30;
  /** Lines read to check a dialog taller than DETECT_LINES (a long command): its subject is above them. */
  const CHECK_LINES = 500;

  async function runPlan(s: Session, plan: KeyPlan): Promise<void> {
    if (!s.tmuxSession) throw new Refusal('session has no terminal (started without ledge)', 'read_only');
    for (const step of plan) {
      if ('text' in step) await tmux.sendText(s.tmuxSession, step.text);
      else if ('waitMs' in step) await new Promise(r => setTimeout(r, step.waitMs));
      else if ('keys' in step) await tmux.sendKeys(s.tmuxSession, step.keys);
      else {
        const end = Date.now() + UNTIL_MS;
        for (;;) {
          const pane = await tmux.capture(s.tmuxSession, UNTIL_LINES);
          if (pane !== null && step.until(pane)) break;
          if (Date.now() >= end) throw step.denied ? new NoteNotTyped() : new Refusal(NOT_TAKEN, 'not_taken');
          await new Promise(r => setTimeout(r, UNTIL_POLL_MS));
        }
      }
    }
  }

  const inFlight = new Set<string>();
  /**
   * How long an answer to a request tied to a tool (a hook's, Claude Code) waits for its PostToolUse or its tool_result,
   * the screen read meanwhile: a tool may take a moment to run after its approval.
   */
  const CONFIRM_MS = opts.confirmMs ?? 3000;
  /** The answers typed from Ledge that wait for their hook, by session: the hook that comes settles the request at once. */
  const awaited = new Map<string, { pending: Pending; decision?: Decision; settled: boolean; byHook: boolean }>();
  /** A hook that confirms an awaited answer settles its request before it is applied: `Decided` (with the decision, so
   *  the thread names it) first, the PostToolUse on top. A request replaced meanwhile is left alone. */
  function settleByHook(id: string, ev: SessionEvent): void {
    const a = awaited.get(id); const cur = store.get(id)?.pending;
    if (!a || a.settled || !answeredBy(a.pending, ev) || !cur || pendingKey(cur) !== pendingKey(a.pending)) return;
    a.settled = true; a.byHook = true;
    store.apply(id, { name: 'Decided', at: now(), source: 'daemon', ...(a.decision ? { decision: a.decision } : {}) });
  }

  /**
   * With `requirePrompt`, fail closed: the prompt must be on screen before anything is typed, else a
   * stale pending (or a dialog the adapter cannot read) would get keys meant for something else and
   * the "prompt gone" check would then report success. A plan given as a function is built from that
   * same capture, so the keys match the dialog actually on screen. True once `Decided` is applied (with `decision`, so
   * the thread names it at once), false when a newer prompt arrived meanwhile and was left alone.
   */
  async function injectAndVerify(id: string, planFor: KeyPlan | ((pane: string) => KeyPlan), requirePrompt: boolean, decision?: Decision): Promise<boolean> {
    const s = store.get(id);
    if (!s) throw new Refusal(`unknown session ${id}`, 'unknown_session');
    if (inFlight.has(id)) throw new Refusal('a decision is already in progress', 'busy');
    inFlight.add(id);
    try {
      const adapter = adapterFor(s.tool);
      const decided = s.pending;
      const stillTheSame = () => {
        const cur = store.get(id)?.pending;
        return cur === decided || (!!cur && !!decided && pendingKey(cur) === pendingKey(decided));
      };
      let before: string | null = null;
      if (requirePrompt) {
        before = s.tmuxSession ? await tmux.capture(s.tmuxSession, DETECT_LINES) : null;
        if (before === null || !adapter.promptStillVisible(bottomLines(before))) throw new Refusal(NO_PROMPT, 'no_prompt');
        // The request checked before the capture may have been replaced while it ran: no key for one the user did not see.
        if (!stillTheSame()) throw new Refusal(STALE, 'stale');
        // Nor for another dialog already on screen whose hook has not come yet: the daemon still holds the old request.
        // One taller than the capture is read whole, or gets no key.
        if (decided) {
          const shown = adapter.detectPrompt(before) ?? adapter.detectPrompt(await tmux.capture(s.tmuxSession!, CHECK_LINES) ?? '');
          const refused = dialogMismatch(shown, decided, await tmux.width?.(s.tmuxSession!) ?? undefined);
          // STALE, or a dialog it cannot read whole (UNCHECKED): the closest code is that no prompt it can read is there.
          if (refused) throw new Refusal(refused, refused === STALE ? 'stale' : 'no_prompt');
        }
      }
      const plan = typeof planFor === 'function' ? planFor(before ?? '') : planFor;
      // An adapter that can tell one prompt from the next reads more of the pane: a new prompt is not a failed answer.
      const stillShown = (p: string) => decided && adapter.promptGone ? !adapter.promptGone(p, decided) : adapter.promptStillVisible(bottomLines(p));
      // A Claude Code request a hook tied to a tool is confirmed by that tool's PostToolUse or its tool_result (#35); the
      // screen, read meanwhile, still tells a step the tool does not end (question 1 of several). Any other: the screen.
      const tool = s.tool === 'claude' && decided?.source === 'hook' ? pendingTool(decided) : undefined;
      const answer = tool ? { pending: decided!, ...(decision ? { decision } : {}), settled: false, byHook: false } : undefined;
      const transcript = tool && !decided!.helperId && s.transcriptPath ? s.transcriptPath : undefined;
      const call = transcript ? claudeOpenCall(transcript, tool!) : undefined;
      const promptGone = async (): Promise<boolean> => {
        if (!answer) return verifyGone(() => tmux.capture(s.tmuxSession!, DETECT_LINES), stillShown, opts.verify);
        const interval = opts.verify?.intervalMs ?? 200;
        for (const end = Date.now() + CONFIRM_MS; ;) {
          if (answer.byHook || (call && claudeToolAnswered(transcript!, call))) return true;
          const pane = await tmux.capture(s.tmuxSession!, DETECT_LINES);
          if (answer.byHook || (pane !== null && !stillShown(pane))) return true; // a failed capture is never "gone"
          if (Date.now() >= end) return false;
          await new Promise(r => setTimeout(r, interval));
        }
      };
      if (answer) awaited.set(id, answer);
      try { await runPlan(s, plan); }
      catch (e) {
        // The deny keys went and the input box never came back for the note: if the request is gone, the refusal
        // happened (the thread says so, unless a newer prompt came meanwhile: left alone) and only the note is missing;
        // if it stays, nothing was refused.
        if (e instanceof NoteNotTyped) {
          if (await promptGone()) {
            if (answer) answer.settled = true;
            if (!answer?.byHook && stillTheSame()) store.apply(id, { name: 'Decided', at: now(), source: 'daemon', ...(decision ? { decision } : {}) });
            throw e;
          }
          e = new Refusal(NOT_TAKEN, 'not_taken');
        }
        if (answer?.byHook) return true; // a later step failed, but the agent took the answer: its hook says so
        store.apply(id, { name: 'InjectFailed', at: now(), source: 'daemon', text: (e as Error).message });
        throw e;
      }
      const gone = await promptGone();
      if (answer) answer.settled = true;
      if (answer?.byHook) return true; // its hook settled it
      if (!stillTheSame()) return false; // a newer prompt arrived meanwhile: leave it alone
      if (gone) { store.apply(id, { name: 'Decided', at: now(), source: 'daemon', ...(decision ? { decision } : {}) }); return true; }
      // The client gets an `error` reply for that id (via the caller's catch), so a retry from `error` reads as failed.
      store.apply(id, { name: 'InjectFailed', at: now(), source: 'daemon', text: NOT_TAKEN });
      throw new Refusal(NOT_TAKEN, 'not_taken');
    } finally { inFlight.delete(id); awaited.delete(id); }
  }

  const READ_ONLY = 'session started without ledge, read only';
  const NO_PROMPT = 'no prompt visible in the terminal, open the tab';
  const NOT_TAKEN = 'the terminal did not take it';
  const FREE_TEXT = 'free-text answers are not supported yet, answer in the terminal';
  const NOT_OFFERED = 'this answer is not offered for this request, answer in the terminal';
  const unknownSession = () => new Refusal('unknown session', 'unknown_session');
  const readOnly = () => new Refusal(READ_ONLY, 'read_only');

  /** A live session Ledge launched is stopped (its tmux killed, a failure only logged) and marked exited; any other is left as it is. */
  async function endSession(s: Session): Promise<void> {
    if (s.rig) throw new RigManagedError();
    if (s.source !== 'launcher' || s.state === 'exited') return;
    if (backendOf(s) === 'omp-rpc') { await omp.close(s.id).catch(e => log(`close of omp ${s.id} failed: ${(e as Error).message}`)); store.apply(s.id, { name: 'PaneGone', at: now(), source: 'daemon' }); return; }
    if (s.tmuxSession) await tmux.killSession(s.tmuxSession).catch(e => log(`kill of ${s.tmuxSession} failed: ${(e as Error).message}`));
    store.apply(s.id, { name: 'PaneGone', at: now(), source: 'daemon' });
  }

  /** How long a close waits for a free prompt, then for the agent to leave after its exit command (spec 2026-10-21 §3). */
  const CLOSE_FREE_MS = opts.close?.freeMs ?? 10_000;
  const CLOSE_EXIT_MS = opts.close?.exitMs ?? 15_000;
  /**
   * Waits up to `ms` for `ok`, polled every UNTIL_POLL_MS. `gone` as soon as the session has exited or left the store: the
   * close is then over, and nothing more is typed. An exit seen while another path holds the session (`typing`: a model
   * change's respawn ends the agent, then brings it back) is not final, and is waited out.
   */
  async function closeWait(id: string, ms: number, ok: (s: Session) => boolean): Promise<'ok' | 'gone' | 'timeout'> {
    for (const end = Date.now() + ms; ;) {
      const cur = store.get(id);
      if (!cur || (cur.state === 'exited' && !typing.has(id))) return 'gone';
      if (ok(cur)) return 'ok';
      if (Date.now() >= end) return 'timeout';
      await new Promise(r => setTimeout(r, UNTIL_POLL_MS));
    }
  }

  /**
   * Ends a live session as its user would: frees its prompt (a pending request is refused, never answered), types the agent's
   * exit command, and waits for it to leave; kills its tmux session as a last resort. Never archives: the session stays resumable.
   */
  async function closeSession(s: Session): Promise<{ how: CloseHow }> {
    const id = s.id; const cur = store.get(id);
    if (!cur) throw unknownSession();
    if (cur.source === 'hook_only') throw readOnly();
    if (cur.rig) throw new RigManagedError();
    if (cur.state === 'exited') throw new Refusal('the session has already exited', 'busy');
    if (closing.has(id)) throw new Refusal('a close is already in progress', 'busy');
    closing.add(id);
    try {
      if (backendOf(cur) === 'omp-rpc') {
        await omp.close(id).catch(e => log(`close of omp ${id} failed: ${(e as Error).message}`));
        store.apply(id, { name: 'PaneGone', at: now(), source: 'daemon' });
        return { how: 'exit' };
      }
      const adapter = adapterFor(cur.tool); const { tmuxSession: pane, pending } = cur;
      // Busy or asking: the interrupt keys free the prompt. On a request they refuse it, which the thread records, but only for
      // the request that was interrupted and is still there (a newer one, or one a hook already settled, is left alone), not a
      // helper's, and only a hook's: a request read off the screen has no permission row, so a deny would mark an older one. A
      // question has no permission row: its Decided carries no decision, only `byClose`, for its tool row. A failed key refuses nothing and ends in the kill.
      if (!free(cur) && pane) {
        const asked = pending && pendingKey(pending);
        const sent = await tmux.sendKeys(pane, adapter.interruptKeys()).then(() => true, e => { log(`close of ${id}: the interrupt failed: ${(e as Error).message}`); return false; });
        const still = store.get(id)?.pending;
        if (sent && pending && !pending.helperId && still && pendingKey(still) === asked) {
          if (pending.kind === 'question') store.apply(id, { name: 'Decided', at: now(), source: 'daemon', byClose: true });
          else if (pending.source === 'hook') store.apply(id, { name: 'Decided', at: now(), source: 'daemon', decision: 'deny', byClose: true });
        }
      }
      let why: string;
      // Re-checked synchronously before the locks are taken: nothing may have started typing since the wait saw it free.
      const idle = (x: Session) => free(x) && !typing.has(id) && !inFlight.has(id);
      const until = Date.now() + CLOSE_FREE_MS;
      let freed = await closeWait(id, CLOSE_FREE_MS, idle);
      while (freed === 'ok' && !idle(store.get(id)!)) freed = await closeWait(id, Math.max(0, until - Date.now()), idle);
      if (freed === 'gone') return { how: 'exit' };
      if (freed === 'timeout') why = `its prompt was not free after ${CLOSE_FREE_MS} ms`;
      else {
        let typed = true;
        // Held as a reply and a relay hold it: nothing else is typed into the line while the exit command is.
        typing.add(id); inFlight.add(id);
        try { await runPlan(store.get(id)!, adapter.exitPlan()); }
        catch (e) { typed = false; log(`close of ${id}: the exit command failed: ${(e as Error).message}`); }
        finally { typing.delete(id); inFlight.delete(id); }
        why = typed ? `still running ${CLOSE_EXIT_MS} ms after its exit command` : 'its exit command could not be typed';
        if (typed && await closeWait(id, CLOSE_EXIT_MS, () => false) === 'gone') return { how: 'exit' };
      }
      const last = store.get(id);
      if (!last || last.state === 'exited') return { how: 'exit' };
      if (last.tmuxSession) await tmux.killSession(last.tmuxSession).catch(e => log(`kill of ${last.tmuxSession} failed: ${(e as Error).message}`));
      store.apply(id, { name: 'PaneGone', at: now(), source: 'daemon' });
      log(`close of ${id}: killed (${why})`);
      return { how: 'killed' };
    } finally { closing.delete(id); }
  }

  /** The images typed with a reply by session: the next prompt event without `attachments` is theirs (the hook could not tell). */
  const typed = new Map<string, { ids: string[]; at: number }>();
  const TYPED_MS = 30_000;

  /** session.reply's checks and typing (shared with the chat's relay): null once typed, the refusal otherwise; rejects when the injection fails. */
  async function replyTo(id: string, text: string, how: { steer?: boolean; attachments?: string[] } = {}): Promise<Refusal | null> {
    const s = store.get(id); if (!s) return unknownSession();
    if (s.source === 'hook_only') return readOnly();
    if (closing.has(id)) return new Refusal('the session is being closed', 'busy');
    const ids = how.attachments ?? [];
    const refs: AttachmentRef[] = [];
    for (const a of ids) {
      const ref = attachments.ref(a);
      if (!ref) return new Refusal('attachment missing', 'attachment_missing');
      refs.push(ref);
    }
    if (refs.length > 0 && s.pending) return new Refusal('reply with images while a dialog is open', 'attachments_not_accepted');
    if (backendOf(s) === 'omp-rpc') return replyOmp(s, text, how.steer === true, refs);
    if (refs.length > 0) text = withImages(text, ids.map(a => attachments.path(a)!));
    // A select dialog ignores typed text and Enter would pick option 1: those take decide only.
    if (s.pending && s.pending.kind !== 'question') return new Refusal(`a ${s.pending.kind} prompt takes accept or deny, not a reply`, 'not_offered');
    if (text.trim() === '') return new Refusal('empty reply', 'invalid');
    // A question dialog is a select: typed text then Enter would silently pick the highlighted option, unless the
    // adapter knows the dialog's own free-text field.
    const pending = s.pending; const adapter = adapterFor(s.tool);
    if (pending?.kind === 'question' && !/^[1-9]$/.test(text.trim()) && !adapter.freeText) return new Refusal(FREE_TEXT, 'free_text');
    // With no pending (idle, your turn) the text goes to the input line: no prompt to check for.
    // Noted before typing: the agent's hook can land before the injection is verified.
    if (ids.length > 0) typed.set(id, { ids, at: Date.parse(now()) });
    try { await injectAndVerify(id, pane => adapter.replyPlan(text, pending, pane || undefined), !!pending); }
    catch (e) { typed.delete(id); throw e; }
    return null;
  }

  /**
   * A reply to an OMP session: the answer to the dialog it waits on, else an instruction: a new turn at rest, queued behind
   * the running one otherwise (OMP's `follow_up`: « après ce tour »). Null once sent, the refusal otherwise.
   */
  async function replyOmp(s: Session, text: string, steer: boolean, refs: AttachmentRef[]): Promise<Refusal | null> {
    if (text.trim() === '' && refs.length === 0) return new Refusal('empty reply', 'invalid');
    if (s.state === 'exited') return new Refusal('the session has ended', 'unavailable');
    if (s.pending) { const refused = await omp.answer(s.id, text); return refused === null ? null : new Refusal(refused, 'not_offered'); }
    if (!omp.isLive(s.id)) return new Refusal('the session is not running', 'unavailable');
    // At rest an instruction starts a turn; while OMP works it waits for the turn's end, unless the user asked to redirect it now.
    await omp.send(s.id, text, s.state === 'working' ? (steer ? 'steer' : 'follow_up') : 'prompt', refs);
    return null;
  }

  /** Sessions deleted in the last DELETED_TTL_MS, by id: their late hooks are ignored. */
  const deleted = new Map<string, number>();
  function markDeleted(id: string): void {
    const t = Date.now();
    for (const [k, at] of deleted) if (t - at > DELETED_TTL_MS) deleted.delete(k);
    deleted.set(id, t);
  }
  function recentlyDeleted(id: string): boolean {
    const at = deleted.get(id); if (at === undefined) return false;
    if (Date.now() - at <= DELETED_TTL_MS) return true;
    deleted.delete(id); return false;
  }

  /**
   * Starts the agent again on its conversation, under the same id and name, with `model` and `effort` (the agent's
   * default where left out): session.resume, and a model change on a live session. Null once spawned, the refusal otherwise.
   */
  async function respawn(s: Session, key: string, model: string | undefined, effort: string | undefined): Promise<string | null> {
    { const r = rigManaged(s); if (r) return r.message; }
    if (s.tool === 'omp') return respawnOmp(s, key, model, effort);
    // Marked live before the first await: a second resume arriving while this one spawns is then refused.
    const { archivedAt: _a, exitedAt: _e, exitCode: _c, modelNext: _n, ...kept } = s;
    // A brain never works without asking: an autonomy it carries is dropped (Task 10).
    const { autonomy: _au, ...rest } = kept;
    const autonomy = s.brain ? undefined : s.autonomy;
    store.upsert({ ...rest, ...(autonomy ? { autonomy } : {}), state: 'starting', source: 'launcher', agentSessionId: key });
    try {
      const cwd = await resolveFolder(s.cwd, opts.home);
      const base = await agentEnv();
      // A brain keeps its shims and LEDGE_BRAIN on a resume (C9), and its brain mark.
      const env = s.brain ? { ...base, ...brainEnv(paths().brainDir, base) } : base;
      const spawned = await spawnSession({ tool: s.tool, id: s.id, name: s.name, ...(s.brain ? { brain: true as const } : {}), args: [...RESUME_ARGS[s.tool](key), ...(model ? MODEL_ARGS[s.tool](model) : []), ...(effort ? EFFORT_ARGS[s.tool]?.(effort) ?? [] : []), ...(s.brain ? brainArgs(s.tool) : autonomyArgs(s.tool, s.autonomy))], cwd, tmux, now, env,
        ...(autonomy ? { autonomy } : {}), taken: { names: store.all().filter(o => o.id !== s.id && o.state !== 'exited').map(o => o.name), ids: [] } });
      // Deleted or archived while it spawned: that request wins, the agent just started is stopped and not recorded.
      const cur = store.get(s.id);
      if (!cur || cur.archivedAt !== undefined) {
        if (spawned.tmuxSession) await tmux.killSession(spawned.tmuxSession).catch(e => log(`kill of ${spawned.tmuxSession} failed: ${(e as Error).message}`));
        log(`resume of ${s.id} dropped: the session was ${cur ? 'archived' : 'deleted'} meanwhile`);
        return null;
      }
      const { topic, topicSource, repo, repoPath, branch, worktree, repoId, project, transcriptPath } = s;
      store.upsert({ ...spawned, agentSessionId: key, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(transcriptPath ? { transcriptPath } : {}), ...(topic ? { topic } : {}), ...(topicSource ? { topicSource } : {}), ...(repo ? { repo } : {}), ...(repoPath ? { repoPath } : {}), ...(branch ? { branch } : {}), ...(worktree !== undefined ? { worktree } : {}), ...(repoId ? { repoId } : {}), project });
      log(`resumed ${spawned.name} (${spawned.tool}) in ${spawned.cwd} as ${spawned.id}${model || effort ? ` on ${model ?? 'its default model'}${effort ? ` · ${effort}` : ''}` : ''}`);
      return null;
    } catch (e) {
      // Put the old record back only over the interim one: a delete or an archive since then stands.
      const cur = store.get(s.id);
      if (cur && cur.archivedAt === undefined && cur.state === 'starting') store.upsert(s);
      return (e as Error).message;
    }
  }

  /** OMP continued from its exact journal under the same Ledge id and name: a new process, the same conversation. */
  async function respawnOmp(s: Session, file: string, model: string | undefined, effort: string | undefined): Promise<string | null> {
    const { archivedAt: _a, exitedAt: _e, exitCode: _c, modelNext: _n, lastError: _l, ...rest } = s;
    store.upsert({ ...rest, state: 'starting', source: 'launcher' });
    try {
      const cwd = await resolveFolder(s.cwd, opts.home);
      const spawned = await omp.launch({ id: s.id, name: s.name, cwd, resumeFile: file, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(s.approval ? { approval: s.approval } : {}) });
      const { topic, topicSource, repo, repoPath, branch, worktree, repoId, project, autonomy } = s;
      store.upsert({ ...spawned, ...(autonomy ? { autonomy } : {}), ...(topic ? { topic } : {}), ...(topicSource ? { topicSource } : {}), ...(repo ? { repo } : {}), ...(repoPath ? { repoPath } : {}), ...(branch ? { branch } : {}), ...(worktree !== undefined ? { worktree } : {}), ...(repoId ? { repoId } : {}), project });
      log(`resumed ${spawned.name} (omp) in ${spawned.cwd} as ${spawned.id}`);
      return null;
    } catch (e) {
      const cur = store.get(s.id);
      if (cur && cur.archivedAt === undefined && cur.state === 'starting') store.upsert(s);
      return (e as Error).message;
    }
  }

  /** Sessions restarted on another model, by id: the end hooks of the agent replaced, arriving late, are ignored. */
  const respawned = new Map<string, number>();
  const replacedLately = (id: string) => { const at = respawned.get(id); return at !== undefined && Date.now() - at <= RESPAWN_HOOKS_MS; };
  /** The change waiting in `modelNext` of an OMP session, applied at its free moment; a refusal leaves the session as it is and is logged. */
  async function applyOmpModel(s: Session): Promise<void> {
    const next = s.modelNext!;
    typing.add(s.id); applyingModel.set(s.id, null);
    try { await omp.setModel(s.id, next); log(`model of ${s.id} is now ${next.model ?? 'unchanged'}${next.effort ? ` · ${next.effort}` : ''}`); }
    catch (e) {
      const message = (e as Error).message;
      log(`model change of ${s.id} failed: ${message}`);
      // The model may have changed anyway (the effort refused): the record keeps the truth, the request is dropped, the fronts told.
      store.patch(s.id, { modelNext: undefined });
      modelFailed(s.id, message, 'refused');
    } finally { typing.delete(s.id); afterModelApply(s.id); }
  }

  /** A model change accepted earlier that fails once applied: every front told, with the code the phone reads (the request's id). */
  const modelFailed = (id: string, message: string, code: ModelRefusal) => broadcast({ type: 'error', id, message, request: 'session.model', code });
  /**
   * The model changes being applied (respawn, set_model), by session, with the change asked meanwhile (accepted as `turn`):
   * the apply rewrites the record without `modelNext`, so the later request is kept here and put back once it is done.
   */
  const applyingModel = new Map<string, { model?: string; effort?: string } | null>();
  /** After an apply: the change asked meanwhile waits again for a free moment, is dropped when it is what now runs, or is
   *  refused with its code when the session can no longer switch (the respawn failed: ended). */
  function afterModelApply(id: string): void {
    const later = applyingModel.get(id); applyingModel.delete(id);
    const s = store.get(id); if (!later || !s) return;
    const refusal = modelRefusal(s, later.effort ?? null);
    if (refusal) { store.patch(id, { modelNext: undefined }); return modelFailed(id, refusal.message, refusal.refused); }
    store.patch(id, { modelNext: later.model === s.model && later.effort === s.effort ? undefined : later });
  }
  /** The session can take a model change at once: free, nothing typed into it, not being closed, no chat card waiting for it. */
  function canApplyNow(id: string): boolean {
    return free(store.get(id)) && !typing.has(id) && !closing.has(id) && !cardThreads.queuedRelays().some(q => q.relay.id === id);
  }
  /** Why the session cannot change model, in the order a front is told (absent: it can). */
  function modelRefusal(s: Session, effort: string | null): { refused: ModelRefusal; message: string } | null {
    const inPlace = backendOf(s) === 'omp-rpc';
    // Started without Ledge: Ledge can neither restart it nor drive it.
    if (s.source === 'hook_only') return { refused: 'not_launched', message: READ_ONLY };
    if (s.state === 'exited') return { refused: 'ended', message: 'the session has ended' };
    if (!resumeKey(s)) return { refused: 'no_conversation', message: 'no conversation to resume' };
    if (inPlace && !omp.isLive(s.id)) return { refused: 'not_running', message: 'the session is not running' };
    if (effort && !inPlace && !EFFORT_ARGS[s.tool as TmuxTool]) return { refused: 'effort_in_model', message: `${s.tool} takes its effort in the model id` };
    return null;
  }
  /**
   * `session.model`: refused with a code, or accepted and applied `now` (the
   * session is free), at the end of its `turn` (`modelNext`), or not at all (`none`: the model it already runs).
   */
  async function changeModel(id: string, model: string | null, effort: string | null): Promise<{ refused: ModelRefusal; message: string } | { when: 'now' | 'turn' | 'none' }> {
    const s = store.get(id); if (!s) throw unknownSession();
    const refusal = modelRefusal(s, effort); if (refusal) return refusal;
    const next = { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
    // Asked while another change is applied: kept for after it (even the model it runs now, which the apply is leaving).
    if (applyingModel.has(id)) { applyingModel.set(id, next); store.patch(id, { modelNext: next }); return { when: 'turn' }; }
    // The model it already runs: a change asked earlier is dropped, nothing restarts.
    if (next.model === s.model && next.effort === s.effort) { if (s.modelNext) store.patch(id, { modelNext: undefined }); return { when: 'none' }; }
    // Decided before the patch: the store's listener starts the change at once (applyModelNext) when the session can take it.
    const when = canApplyNow(id) ? 'now' : 'turn';
    store.patch(id, { modelNext: next });
    return { when };
  }

  /** A model change waiting for the session's free moment (`modelNext`): the agent stopped and resumed on that model. */
  async function applyModelNext(id: string): Promise<void> {
    const s = store.get(id);
    if (!s?.modelNext || !canApplyNow(id)) return;
    // OMP changes its model in place (set_model on the same process): nothing is stopped, the conversation is never left.
    if (backendOf(s) === 'omp-rpc') return applyOmpModel(s);
    const { model, effort } = s.modelNext;
    // Accepted, then no longer applicable (the session lost what a respawn needs): dropped, and said with the refusal's code.
    const refusal = modelRefusal(s, effort ?? null);
    if (refusal) { store.patch(id, { modelNext: undefined }); return modelFailed(id, refusal.message, refusal.refused); }
    const key = resumeKey(s)!; // modelRefusal refuses a session without one
    // Held like a typing: neither the mailbox nor the relay writes into the agent being replaced.
    typing.add(id); applyingModel.set(id, null);
    try {
      for (const [k, at] of respawned) if (Date.now() - at > RESPAWN_HOOKS_MS) respawned.delete(k);
      respawned.set(id, Date.now());
      await endSession(s);
      const ended = store.get(id);
      if (!ended || ended.archivedAt !== undefined) { store.patch(id, { modelNext: undefined }); return; }
      const refused = await respawn({ ...ended, modelNext: undefined }, key, model, effort);
      // The session stays ended, as it was before the respawn: Resume brings it back on its former model.
      if (refused) { log(`model change of ${id} failed: ${refused}`); modelFailed(id, refused, 'restart_failed'); }
    } catch (e) {
      // The old agent could not be stopped: the change is dropped rather than tried again at each update.
      log(`model change of ${id} failed: ${(e as Error).message}`);
      store.patch(id, { modelNext: undefined });
      modelFailed(id, (e as Error).message, 'restart_failed');
    } finally { typing.delete(id); afterModelApply(id); }
  }

  /** The chat cards being launched: a second click, or another overlay, is refused until the first one has answered. */
  const chatLaunches = new Set<string>();
  /** The close card rows being closed: a second click, or another overlay, is passed over until the first one has answered. */
  const chatCloses = new Set<string>();
  /**
   * The cards' closes under way, by session. Two cards can name one session (a phone's and Desktop's): the second waits for
   * the first one's close and reads its outcome, closed rather than failed for a close another card is making.
   */
  const cardSessionCloses = new Map<string, Promise<{ how: CloseHow }>>();
  function closeForCard(id: string): Promise<{ how: CloseHow }> {
    const running = cardSessionCloses.get(id);
    if (running) return running;
    const s = store.get(id); if (!s) throw unknownSession();
    if (s.rig) return Promise.reject(new RigManagedError());
    const p = closeSession(s);
    cardSessionCloses.set(id, p);
    const done = () => { if (cardSessionCloses.get(id) === p) cardSessionCloses.delete(id); };
    p.then(done, done);
    return p;
  }
  /** The generic card rows being applied: a second click, or another overlay, is passed over until the first one has answered. */
  const chatActs = new Set<string>();
  /**
   * A generic card's rows (spec 2026-10-26 action registry §2.1), applied through the daemon's own handlers so their rules stay in
   * one place: a row fails on the handler's `error`.
   */
  function actOnCard(card: { chat: Pick<Chat, 'action' | 'markAction'>; emit: (m: ChatMessage) => void }, qid: string, rid: string, rows?: number[], confirmed?: true, deny?: true) {
    return actFromChat({
      chat: card.chat, emit: card.emit, inFlight: chatActs, now,
      resolve: row => resolveAction(row.action, row.args, { sessions: store.all() }),
      apply: async row => { const r = await applyRow(row, rid); if (r.failure !== undefined) throw new Error(r.failure); }
    }, qid, rows, confirmed, deny);
  }
  /** The turn's cards were set aside (« Ignorer », on any thread's device): nothing of them applies until opened again. */
  const setAside = (qid: string) => cardThreads.all().some(([, c]) => c.ignored(qid));
  const SET_ASIDE = 'ignored card: open it again first';
  /** A resolved row through the daemon's own handler: its failure is the handler's `error`. */
  async function applyRow(row: Pick<ChatAction, 'action' | 'args'>, rid: string): Promise<{ failure?: string }> {
    const out = actionMessage(row, rid);
    let failure: string | undefined;
    await handle(out, m => { if (m.type === 'error') failure ??= m.message; });
    return failure !== undefined ? { failure } : {};
  }
  /** Whether `key` is the one Ledge gave session `by` (#93), shared by `action.run` and `brain.cmd`. */
  function verifySessionKey(by: string, key: string | undefined): { ok: true } | { ok: false; reason: string } {
    // Without a key, the session was most likely launched before Ledge gave one: it is relaunched, not suspected.
    if (!key) return { ok: false, reason: `la session ${by} n'a pas de clé (lancée avant cette version de Ledge, ou hors de Ledge) : reprends-la depuis Ledge, ou demande à l'utilisateur` };
    const want = sessionKey(by, token);
    if (!want || !tokenEquals(key, want)) return { ok: false, reason: `la clé ne correspond pas à la session ${by} : lance la commande depuis cette session, telle que Ledge l'a lancée` };
    return { ok: true };
  }
  /** Lifecycle of a rig or a seat, through OpenRig (`rig.act`, and the brain's `rig down|restart|handover`). */
  async function rigAct(msg: RigActMsg): Promise<RigResult> {
    if (msg.machine !== 'local') return { ok: false, code: 'unreachable', reason: `machine ${msg.machine} is not this daemon's` };
    if (!bridge) return { ok: false, code: 'openrig_down', reason: "OpenRig n'est pas branché" };
    // Cancelling a launch: forget it first, so a seat turning ready while `down` runs cannot get the goal.
    if (msg.verb === 'down' && msg.rigId !== undefined && launches?.pending().some(l => l.rigId === msg.rigId)) await launches.cancel(msg.rigId);
    const r = await actOnRig({ http: () => bridge.http(), ensureRunning: why => bridge.ensureRunning(why), operator: HUMAN_ADDRESS },
      { verb: msg.verb, ...(msg.rigId !== undefined ? { rigId: msg.rigId } : {}), ...(msg.seatRef !== undefined ? { seatRef: msg.seatRef } : {}) });
    return r.ok ? { ok: true } : { ok: false, code: r.code, reason: r.reason };
  }
  /** A launch plan (`rig.prepare`, and the brain's check of a launch card); the caller keeps it or not. */
  async function rigPrepare(msg: RigPrepareMsg, allowStart = true): Promise<RigPlan | { code: RigResultCode; reason: string }> {
    if (msg.machine !== 'local') return { code: 'unreachable', reason: `machine ${msg.machine} is not this daemon's` };
    if (!bridge) return { code: 'openrig_down', reason: "OpenRig n'est pas branché" };
    // Ledge starts OpenRig itself for a launch, and says so in its thread (the bridge's notice); only a start that fails is refused.
    const status = allowStart ? await bridge.ensureRunning('launch') : bridge.status();
    const http = bridge.http();
    if (!http || status.state !== 'running') return { code: 'openrig_down', reason: status.detail ?? `OpenRig ${status.state}` };
    try {
      const plan = await prepareRigPlan({ http, home: paths().dir, projects: () => projects, machine: msg.machine }, msg);
      return 'refused' in plan ? { code: 'failed', reason: plan.refused } : plan;
    } catch (e) {
      log(`openrig: plan not made: ${(e as Error).message}`);
      return { code: e instanceof OpenRigUnreachable ? 'openrig_down' : 'failed', reason: (e as Error).message };
    }
  }
  /** `ledge brain …` (Lot 7): what the brain session may do, once the daemon knows it is the brain. */
  const brainCommands = createBrainCommands({ deciding, thread, seatSend, memory, rigs: () => bridge?.rigs() ?? [], escalations: () => bridge?.escalations() ?? [],
    sessions: () => store.all(), projects: () => projects, chat, emit: broadcast, rigAct, rigPrepare: msg => rigPrepare(msg, false),
    handover: (by, text) => handovers.brief(by, text) });
  /**
   * `brain.cmd`: only from the brain session, as its key says; any refusal leaves no trace (no thread item, nothing sent to
   * OpenRig). Then the args are parsed and the op runs.
   */
  async function runBrainCmd(msg: Extract<ClientMessage, { type: 'brain.cmd' }>, reply: Reply): Promise<void> {
    const answer = (r: { ok: boolean; line: string; code?: Extract<ServerMessage, { type: 'brain.result' }>['code'] }) => reply({ type: 'brain.result', rid: msg.rid, ...r });
    if (!msg.by || !verifySessionKey(msg.by, msg.key).ok) return answer({ ok: false, code: 'identity', line: NOT_BRAIN_LINE });
    const s = store.get(msg.by);
    if (s?.brain !== true || s.state === 'exited' || s.archivedAt !== undefined) return answer({ ok: false, code: 'not_brain', line: NOT_BRAIN_LINE });
    const parsed = parseBrainArgs(msg.op, msg.args);
    if (!parsed.ok) return answer({ ok: false, code: 'invalid', line: parsed.usage });
    try { return answer(await brainCommands.run(parsed.value, msg.by)); }
    catch (e) { log(`brain: ${msg.op} failed: ${(e as Error).message}`); return answer({ ok: false, code: 'failed', line: `Échec : ${(e as Error).message}` }); }
  }
  /**
   * `action.run` (#93): an action of the registry outside the chat, resolved and applied as a generic card's row, so the CLI
   * writes no rule of its own. A destructive one asks again (`confirmed`), and the guard decides who may run it at all.
   */
  async function runAction(msg: Extract<ClientMessage, { type: 'action.run' }>, reply: Reply): Promise<void> {
    const answer = (x: { row?: ChatAction; reason?: string; code?: string; path?: string }) => reply({ type: 'action.result', rid: msg.rid, action: msg.action, ...x });
    const parsed = actionById(msg.action)!.args.safeParse(msg.args);
    if (!parsed.success) return answer({ reason: `invalid args: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`, code: 'refused' });
    // A session is who its key says (#93): a `by` from another environment, or none, is refused before anything is resolved.
    if (msg.by !== undefined) { const v = verifySessionKey(msg.by, msg.key); if (!v.ok) return answer({ reason: v.reason, code: 'identity' }); }
    const ctx = { sessions: store.all() };
    const r: Resolved = resolveRun(msg.action, parsed.data, ctx);
    if ('refused' in r) return answer({ reason: r.refused, code: 'refused' });
    const guard = runGuard(r, msg.by, ctx);
    if (guard) return answer({ row: r, reason: guard, code: 'agent' });
    if (r.risk === 'destructive' && !msg.confirmed) return answer({ row: r, reason: 'destructive: confirm it', code: 'confirm_required' });
    // A session closing itself is answered first: its command would wait on its own close, and the close on its prompt.
    const self = msg.by;
    if (r.action === 'session.close' && self !== undefined && r.session === self) {
      answer({ row: r });
      closeForCard(self).catch(e => log(`self close of ${self} failed: ${(e as Error).message}`));
      return;
    }
    if (r.action === 'session.close') {
      const failure = await closeForCard(String(r.args.session)).then(() => undefined, e => (e as Error).message);
      return answer({ row: r, ...(failure !== undefined ? { reason: failure, code: 'failed' } : {}) });
    }
    const { failure } = await applyRow(r, msg.rid);
    return answer({ row: r, ...(failure !== undefined ? { reason: failure, code: 'failed' } : {}) });
  }
  type LaunchReq = { tool: Tool; cwd: string; name?: string; prompt?: string; continue?: boolean; dirs?: string[]; model?: string; effort?: string; approval?: OmpApproval; autonomy?: Autonomy;
    /** The brain's launch (C8): its own id, its env merged over the agents', and the brain mark. Tmux tools only. */
    id?: string; env?: Record<string, string>; brain?: true };
  /** Spawns the agent as `ledge <tool>` would and records it; throws the reason (bad folder, tmux). */
  async function launch(req: LaunchReq): Promise<Session> {
    const cwd = await resolveFolder(req.cwd, opts.home);
    const filled: LaunchReq = { ...req, cwd };
    if (filled.approval && filled.tool !== 'omp') throw new Error(`launch: ${filled.tool} takes no approval mode`);
    if ((filled.brain || filled.id || filled.env) && filled.tool === 'omp') throw new Error('launch: OMP cannot be the brain');
    const session = filled.tool === 'omp' ? await launchOmp(filled) : await launchTmux({ ...filled, tool: filled.tool });
    return store.get(session.id) ?? session;
  }
  /** `omp --mode rpc-ui` owned by the daemon: no pane. `continue` has no meaning here (a folder's latest journal is never picked). */
  async function launchOmp(req: LaunchReq): Promise<Session> {
    if (req.continue) throw new Error('launch: OMP resumes an exact conversation, not the latest of a folder');
    const cwd = req.cwd;
    const dirs = req.dirs?.length ? await Promise.all(req.dirs.map(d => resolveFolder(d, opts.home))) : undefined;
    const approval = req.approval ?? ompApprovalFor(req.autonomy);
    const launched = await omp.launch({ cwd, ...(req.name ? { name: req.name } : {}), ...(dirs ? { dirs } : {}), ...(req.model ? { model: req.model } : {}), ...(req.effort ? { effort: req.effort } : {}), ...(approval ? { approval } : {}) });
    const session: Session = { ...launched, ...(req.autonomy && req.autonomy !== 'ask' ? { autonomy: req.autonomy } : {}) };
    if (session.autonomy) store.upsert(session);
    store.touchRecent(session.cwd, session.project, session.startedAt);
    log(`launched ${session.name} (omp) in ${session.cwd} as ${session.id}`);
    const prompt = req.prompt?.trim();
    // The session exists and is usable: a first instruction that fails is its error state, not a failed launch.
    if (prompt) await omp.send(session.id, prompt).catch(e => log(`first prompt of ${session.id} failed: ${(e as Error).message}`));
    return store.get(session.id) ?? session;
  }
  async function launchTmux(req: LaunchReq & { tool: TmuxTool }): Promise<Session> {
    if (req.dirs?.length && !MULTI_DIR_ARGS[req.tool]) throw new Error(`launch: ${req.tool} takes one folder`);
    if (req.effort && !EFFORT_ARGS[req.tool]) throw new Error(`launch: ${req.tool} takes its effort in the model id`);
    const cwd = req.cwd;
    const dirs = req.dirs?.length ? await Promise.all(req.dirs.map(d => resolveFolder(d, opts.home))) : undefined;
    const all = store.all();
    // A brain's relief takes « Ledge » from the brain it relieves (ruling C10): brain names are not taken for a brain.
    const live = req.brain ? all.filter(s => s.brain !== true) : all;
    const base = await agentEnv();
    const env = req.env ? { ...base, ...req.env } : base;
    const autonomy = req.autonomy;
    const spawned = await spawnSession({ tool: req.tool, args: [...(req.brain ? brainArgs(req.tool) : []), ...launchArgs({ ...req, dirs, autonomy })], name: req.name, cwd, tmux, now, env,
      ...(autonomy ? { autonomy } : {}), ...(req.id ? { id: req.id } : {}), ...(req.brain ? { brain: true as const } : {}),
      taken: { names: [...live.filter(s => s.state !== 'exited').map(s => s.name), ...heldNames(live)], ids: all.map(s => s.id) } });
    const session: Session = { ...spawned, ...(req.model ? { model: req.model } : {}), ...(req.effort ? { effort: req.effort } : {}) };
    store.upsert(session);
    store.touchRecent(session.cwd, session.project, session.startedAt);
    log(`launched ${session.name} (${session.tool}) in ${session.cwd} as ${session.id}`);
    return session;
  }

  /** The scan in flight (lot 11): a `repos.scan` arriving while one walks gets that walk's result, under its own requestId. */
  let scanning: ReturnType<typeof scanRepos> | null = null;
  function sharedScan(): ReturnType<typeof scanRepos> {
    if (scanning) return scanning;
    const home = opts.home ?? homedir();
    const extra = extraRoots(home, [...store.recents().map(r => r.cwd), ...store.all().filter(s => s.state !== 'exited').map(s => s.cwd)]);
    const walk = (opts.scan ?? scanRepos)({ home, extra }).finally(() => { if (scanning === walk) scanning = null; });
    return (scanning = walk);
  }
  /**
   * Applies one message from a local front or the phone gateway, answering the sender through `reply` only. Settles once
   * the action is applied or refused: a decision, a reply or an interrupt has been typed (or refused) by then.
   */
  /** Stores an upload (a local client may send up to ATTACHMENT_LOCAL_MAX); invalid base64 is `unreadable`. */
  async function storeUpload(u: ImageUpload): Promise<AttachmentRef> {
    const decode = (data: string) => {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 === 1) throw new AttachmentError('unreadable');
      return Buffer.from(data, 'base64');
    };
    return attachments.put(decode(u.data), u.preview ? decode(u.preview.data) : undefined, ATTACHMENT_LOCAL_MAX);
  }

  async function handle(msg: ClientMessage, reply: Reply): Promise<void> {
    /** A refusal names the request it answers, so a front can tell a refused reply from a refused decision; a coded one says why. */
    const refuse = (r: { message: string; code: RefusalCode | ModelRefusal } | string, id?: string) => reply({ type: 'error', ...(id !== undefined ? { id } : {}), message: typeof r === 'string' ? r : r.message, request: msg.type, ...(typeof r === 'string' ? {} : { code: r.code }) });
    const notYet = () => reply({ type: 'error', message: 'not supported yet', request: msg.type, code: 'unavailable' });
    switch (msg.type) {
      case 'document.read': {
        const session = msg.sessionId ? store.get(msg.sessionId) : undefined;
        if (msg.sessionId && !session) return reply({ type: 'document.error', requestId: msg.requestId, path: msg.path, code: 'session_missing' });
        return reply(await readDocument(msg, { cwd: session?.cwd, workdir: session?.workdir, home: opts.home ?? process.env.HOME ?? '' }));
      }
      case 'repos.inspect': return reply({ type: 'repos.info', requestId: msg.requestId, repos: await inspectRepos(msg.paths, { home: opts.home }) });
      // Lot 11: home, then the parents of the recent and live folders outside it. Answered even when it fails: an `error` for
      // repos.scan reads, to the fleet, as a daemon too old to know it. The remotes it carries are never logged.
      case 'repos.scan': {
        try { return reply({ type: 'repos.found', requestId: msg.requestId, ...await sharedScan() }); }
        catch (e) { log(`repos.scan failed: ${(e as Error).message}`); return reply({ type: 'repos.found', requestId: msg.requestId, repos: [], truncated: false, error: 'scan failed' }); }
      }
      // #58: answered even when the agent cannot be asked, so the form falls back to the agent's default and « Other… ».
      case 'models.list': return reply({ type: 'models.listing', requestId: msg.requestId, tool: msg.tool, ...await models.list(msg.tool) });
      case 'snapshot.request': return sendSnapshot(reply);
      case 'machines.set': {
        writeMachines(msg.machines, machinesFile); // first: a failing write leaves memory unchanged and reaches the sender
        machines = msg.machines; // already validated by parseClientMessage
        remote?.setMachines(machines); // a machine gone takes its rigs and escalations with it
        return broadcast(machinesMsg()); // every local client, the sender included
      }
      case 'projects.set': {
        writeProjects(msg.projects, projectsFile); // first: a failing write leaves memory unchanged and reaches the sender
        projects = msg.projects; // already validated by parseClientMessage
        bridge?.refresh(); aggregate?.refresh(); // the rigs filed in a project follow it, remote ones too
        return broadcast(projectsMsg());
      }
      case 'context.set': {
        writeContextPrefs(msg.prefs, contextFile); // first: a failing write leaves memory unchanged and reaches the sender
        contextPrefs = msg.prefs;
        // Sessions already past the new threshold: an `auto` session is relieved at its next turn's end.
        return broadcast(contextMsg());
      }
      case 'island.set': {
        writeIsland(msg.prefs, islandFile); // first: a failing write leaves memory unchanged and reaches the sender
        island = msg.prefs; // already validated by parseClientMessage
        return broadcast(islandMsg());
      }
      case 'session.register': {
        let incoming = msg.session;
        const existing = store.get(incoming.id);
        // Two launchers can pick the same name from the same snapshot: the first to register keeps it.
        const others = store.all().filter(o => o.id !== incoming.id);
        if (others.some(o => o.state !== 'exited' && o.name === incoming.name)) {
          const old = incoming.name;
          const name = pickName(others.map(o => o.name));
          const title = incoming.title.startsWith(`${old} ·`) ? `${name}${incoming.title.slice(old.length)}` : incoming.title;
          incoming = { ...incoming, name, title };
        }
        if (existing && existing.source === 'hook_only') {
          // What the hooks already learned wins over the launcher's fresh record, exit included.
          store.upsert({
            ...existing, ...incoming, state: existing.state, pending: existing.pending, lastActivityAt: existing.lastActivityAt,
            lastHookAt: existing.lastHookAt, exitCode: existing.exitCode, exitedAt: existing.exitedAt, source: 'launcher'
          });
        } else store.upsert(incoming);
        if (incoming.cwd) store.touchRecent(incoming.cwd, incoming.project, incoming.startedAt);
        return;
      }
      case 'session.launch': {
        // Any failure (bad folder, tmux) reaches the requester as an `error` without id, through the caller's catch.
        if (msg.qid === undefined) return reply({ type: 'session.launched', id: (await launch(msg)).id });
        if (setAside(msg.qid)) return refuse(SET_ASIDE);
        // A chat card (spec 2026-10-12 §4): the proposal's own fields, never the message's but the model chosen on the card (#58).
        let failure: unknown = null;
        try {
          const done = await launchFromChat({
            chat, emit: broadcast, inFlight: chatLaunches,
            launch: async p => {
              try {
                const session = await launch({ tool: p.tool, cwd: p.cwd, prompt: p.prompt, model: msg.model ?? p.model, effort: msg.effort ?? p.effort });
                reply({ type: 'session.launched', id: session.id });
                return session.id;
              } catch (e) { failure = e; throw e; }
            }
          }, msg.qid, msg.rows);
          if (done.failed > 0 && failure) throw failure;
        } catch (e) { if (e instanceof LaunchRefused) return refuse(e.message); throw e; }
        return;
      }
      case 'folder.list': return reply(await listFolder(msg.path, opts.home, msg.requestId));
      case 'folder.create': {
        const listing = await createFolder(msg.parent, msg.name, opts.home, msg.requestId);
        if (!listing.error) log(`created folder ${listing.path}`);
        return reply(listing);
      }
      case 'session.event': {
        let ev = msg.event;
        if (ev.name === 'UserPromptSubmit') {
          // A reply typed with images comes back as a plain prompt: the first one within the window carries them.
          const t = typed.get(msg.id); typed.delete(msg.id);
          if (!ev.attachments && t && Date.parse(now()) - t.at <= TYPED_MS) { ev = { ...ev, attachments: t.ids }; msg.event = ev; }
        }
        // Late hooks of a session deleted moments ago (its SessionEnd, a last Stop) bring back neither it nor its thread.
        if (recentlyDeleted(msg.id)) return;
        // The agent's text precedes the action it announces: sync the parent's transcript before the row lands.
        const ownTurn = !ev.helperId && (ev.name === 'PreToolUse' || ev.name === 'PermissionRequest' || ev.name === 'Stop');
        const helperEnd = ev.name === 'SubagentStop' && !!ev.helperId;
        if (history && ev.transcriptPath && (ownTurn || helperEnd)) {
          try { history.sync(msg.id, ev.transcriptPath, { helperId: helperEnd ? ev.helperId : undefined, force: ev.name === 'Stop' || helperEnd }); }
          catch (e) { log(`transcript not read for ${msg.id}: ${(e as Error).message}`); }
        }
        const terminal = ev.name === 'SessionEnd' || ev.name === 'PaneGone';
        // The end of the agent a model change replaced: the one resumed in its place goes on.
        if (terminal && ev.source === 'hook' && replacedLately(msg.id)) return;
        const stored = store.get(msg.id);
        // A hook from an archived session still running (hook_only): it is alive again. An exited one stays archived,
        // and so does one whose hook says it ends.
        if (stored?.archivedAt && stored.state !== 'exited' && !terminal) store.unarchive(msg.id);
        const before = store.get(msg.id);
        if (!before && terminal) return; // never a new session from its end
        if (!before) {
          const taken = store.all().map(s => s.name);
          const cwd = msg.cwd ?? '';
          const base: Session = { id: msg.id, name: pickName(taken), tool: msg.agent ?? 'claude', cwd, project: basename(cwd) || 'unknown', title: 'untracked session', tmuxSession: null, state: 'working', helpers: [], startedAt: msg.event.at, lastActivityAt: msg.event.at, source: 'hook_only' };
          store.upsert(base);
          store.apply(msg.id, msg.event); // through apply, so the history sees the session's first event too
        } else {
          // The agent may have left its launch folder (a worktree it entered): its documents' relative links start there.
          if (msg.cwd) store.patch(msg.id, { workdir: msg.cwd });
          settleByHook(msg.id, ev); store.apply(msg.id, msg.event);
        }
        logDroppedRequest(msg.id, msg.event, before, store.get(msg.id));
        if (bridge) pairSession(store, bridge, msg);
        return;
      }
      case 'session.thread':
        return reply({ type: 'session.thread', id: msg.id, items: history?.items(msg.id) ?? [] });
      case 'session.rename': {
        if (!store.get(msg.id)) return refuse(unknownSession(), msg.id);
        store.apply(msg.id, { name: 'Renamed', at: now(), source: 'daemon', text: msg.topic });
        return;
      }
      case 'session.unregister':
        if (replacedLately(msg.id)) return;
        store.apply(msg.id, { name: 'SessionEnd', at: now(), source: 'hook', exitCode: msg.exitCode });
        return;
      case 'session.decide': {
        const s = store.get(msg.id); if (!s) return refuse(unknownSession(), msg.id);
        if (s.source === 'hook_only') return refuse(readOnly(), msg.id);
        // A decision is for the request the user saw: another one (or none) since is refused before any key.
        if (msg.expect && (s.pending?.kind !== msg.expect.kind || s.pending.text !== msg.expect.text
          || (msg.expect.key !== undefined && pendingKey(s.pending) !== msg.expect.key))) return refuse(new Refusal(STALE, 'stale'), msg.id);
        if (!s.pending) return refuse(new Refusal('nothing to decide', 'nothing_to_decide'), msg.id);
        // OMP's requests are its own dialogs, answered with the option or the text they ask for (a reply), never accept/deny keys.
        if (backendOf(s) === 'omp-rpc') return refuse(new Refusal('answer this request with one of its options', 'not_offered'), msg.id);
        const pending = s.pending; const adapter = adapterFor(s.tool);
        // What the harness cannot do is refused before any key (a question never takes `always` or a note).
        if (msg.decision === 'always' && !offers(s.tool, pending.kind, 'always')) return refuse(new Refusal(NOT_OFFERED, 'not_offered'), msg.id);
        if (msg.note !== undefined && (msg.decision !== 'deny' || !offers(s.tool, pending.kind, 'note'))) return refuse(new Refusal(NOT_OFFERED, 'not_offered'), msg.id);
        const { decision, note } = msg;
        // Only a decision the terminal took lands in the thread, through the `Decided` it carries: that settles the
        // permission it answered and no other (an older one answered in the terminal keeps its own state).
        await injectAndVerify(msg.id, pane => adapter.keysFor(decision, pending, pane, note), true, decision);
        return;
      }
      case 'session.reply': {
        const refused = await replyTo(msg.id, msg.text, { steer: msg.steer, attachments: msg.attachments });
        if (refused) refuse(refused, msg.id);
        return;
      }
      case 'session.answer': {
        const s = store.get(msg.id); if (!s) return refuse('unknown session', msg.id);
        if (backendOf(s) !== 'omp-rpc') return refuse('this session has no set of questions to answer', msg.id);
        const refused = await omp.answerAsk(msg.id, msg.requestId, msg.answers, msg.cancel === true);
        if (refused) refuse(refused, msg.id);
        return;
      }
      case 'session.interrupt': {
        const s = store.get(msg.id);
        if (s?.source === 'hook_only') return refuse(readOnly(), msg.id);
        if (s && backendOf(s) === 'omp-rpc') {
          if (!msg.restoreQueue) return void await omp.interrupt(s.id).catch(e => refuse((e as Error).message, msg.id));
          // The queue comes back as a draft for the one who asked; never re-sent by the daemon.
          return void await omp.interruptAndRestore(s.id).then(({ entries, imagesDropped }) => reply({ type: 'session.queue.restored', id: s.id, texts: entries.map(e => e.text), entries, ...(imagesDropped ? { imagesDropped } : {}) }), e => refuse((e as Error).message, msg.id));
        }
        if (!s?.tmuxSession) return;
        await tmux.sendKeys(s.tmuxSession, adapterFor(s.tool).interruptKeys());
        return;
      }
      case 'session.kill': {
        const s = store.get(msg.id); if (!s) return;
        if (s.source === 'hook_only') return refuse(readOnly(), msg.id);
        { const r = rigManaged(s); if (r) return refuse(r, msg.id); }
        if (backendOf(s) === 'omp-rpc') return endSession(s);
        if (s.tmuxSession) await tmux.killSession(s.tmuxSession);
        store.apply(msg.id, { name: 'PaneGone', at: now(), source: 'daemon' });
        return;
      }
      case 'session.dismiss': {
        const s = store.get(msg.id); if (!s) return refuse(unknownSession(), msg.id);
        if (s.state !== 'exited' && s.source !== 'hook_only') return refuse(new Refusal('the session is still running, kill it first', 'busy'), msg.id);
        // Removal broadcasts session.removed, drops the remembered preview and is saved to the journal.
        // A dismissed hook_only session that is in fact still alive comes back on its next hook (the
        // hook-before-register path in session.event recreates it): acceptable, it is still running.
        store.remove(msg.id);
        return;
      }
      case 'session.archive': {
        const s = store.get(msg.id); if (!s) return refuse(unknownSession(), msg.id);
        { const r = rigManaged(s); if (r) return refuse(r, msg.id); }
        await endSession(s);
        store.archive(msg.id, now());
        return;
      }
      case 'session.restore': {
        if (!store.get(msg.id)) return refuse(unknownSession(), msg.id);
        store.unarchive(msg.id, now());
        return;
      }
      case 'session.resume': {
        const s = store.get(msg.id); if (!s) return refuse(unknownSession(), msg.id);
        { const r = rigManaged(s); if (r) return refuse(r, msg.id); }
        if (s.state !== 'exited') return refuse(new Refusal('the session is still running', 'busy'), msg.id);
        const key = resumeKey(s); if (!key) return refuse({ message: 'no conversation to resume', code: 'no_conversation' }, msg.id);
        const refused = await respawn(s, key, s.model, s.effort);
        if (refused) refuse(refused, msg.id);
        return;
      }
      case 'session.model': {
        const target = store.get(msg.id); if (!target) return refuse('unknown session', msg.id);
        { const r = rigManaged(target); if (r) return refuse(r, msg.id); }
        // Answered as soon as decided: a failure once applied reaches every front as an `error` with the same id.
        const r = await changeModel(msg.id, msg.model, msg.effort);
        if ('refused' in r) return refuse({ message: r.message, code: r.refused }, msg.id);
        return reply({ type: 'session.model.accepted', id: msg.id, when: r.when });
      }
      case 'session.delete': {
        const s = store.get(msg.id); if (!s) return refuse(unknownSession(), msg.id);
        { const r = rigManaged(s); if (r) return refuse(r, msg.id); }
        // A running hook_only session is not stopped by Ledge: like a dismissed one, its next hook brings it back.
        if (s.source === 'launcher' || s.state === 'exited') markDeleted(msg.id);
        await endSession(s);
        store.remove(msg.id);
        return;
      }
      // An agent's message to another session: acked at once, typed when the target is free.
      case 'session.message': {
        return reply(mailbox.submit(msg));
      }
      case 'message.read': return reply(mailbox.read(msg));
      case 'session.handover': {
        const reason = handovers.start(msg.id);
        return reply({ type: 'session.handover.result', rid: msg.rid, ok: reason === null, ...(reason ? { reason } : {}) });
      }
      case 'handover.brief': {
        const reason = handovers.brief(msg.by, msg.text);
        return reply({ type: 'handover.result', rid: msg.rid, ...(reason ? { reason } : {}) });
      }
      case 'handover.show': {
        const r = handovers.show(msg.by);
        return reply({ type: 'handover.result', rid: msg.rid, ...('text' in r ? { text: r.text } : { reason: r.reason }) });
      }
      case 'ask.create': {
        const r = asks.create(msg.by, msg.question, msg.options);
        return reply('code' in r ? { type: 'ask.result', rid: msg.rid, code: r.code, reason: r.reason } : { type: 'ask.result', rid: msg.rid, ask: r });
      }
      case 'ask.answer': {
        const r = asks.answer(msg.id, msg.text);
        return reply('code' in r ? { type: 'ask.result', rid: msg.rid, code: r.code, reason: r.reason } : { type: 'ask.result', rid: msg.rid, ask: r });
      }
      // A chat card's instruction: a refusal reaches the requester as an `error`, the card's state everyone through chat.history.
      case 'session.relay': return setAside(msg.qid) ? refuse(SET_ASIDE) : relay.request(msg.qid);
      case 'session.relay.cancel': return relay.cancel(msg.qid);
      // A chat's close card (spec 2026-10-21 close §4), on the thread that holds the turn: each row closed answers the
      // requester, the card's state reaches the thread's clients through chat.history. A failed row is the requester's one
      // `error`, once every row has settled.
      case 'session.close': {
        const card = cardOf(cardThreads, msg.qid);
        if (!card) return refuse('unknown close');
        if (setAside(msg.qid)) return refuse(SET_ASIDE);
        try {
          const done = await closeFromChat({
            chat: card.chat, emit: card.emit, inFlight: chatCloses,
            close: closeForCard,
            onClosed: (row, id, how) => reply({ type: 'session.closed', qid: msg.qid, row, id, how })
          }, msg.qid, msg.rows);
          if (done.failed.length > 0) throw new Error(done.failed[0]!.message);
        } catch (e) { if (e instanceof CloseRefused) return refuse(e.message); throw e; }
        return;
      }
      case 'action.run': return runAction(msg, reply);
      // A chat's generic card (spec 2026-10-26 action registry §9.2), on the thread that holds the turn: the rows apply in order and
      // stop at the first failure; the requester gets chat.acted, the thread's clients the rows' state through chat.history.
      case 'chat.act': {
        const card = cardOf(cardThreads, msg.qid);
        if (!card) return refuse('unknown action');
        if (setAside(msg.qid)) return reply({ type: 'error', message: SET_ASIDE, request: msg.type, code: 'ignored' });
        try { return reply({ type: 'chat.acted', rid: msg.rid, qid: msg.qid, ...(await actOnCard(card, msg.qid, msg.rid, msg.rows, msg.confirmed, msg.deny)) }); }
        catch (e) { if (e instanceof ActRefused) return reply({ type: 'error', message: e.message, request: msg.type, ...(e.code ? { code: e.code } : {}) }); throw e; }
      }
      // Broadcast: every overlay shows the same progress, and the one that asked may be the one that reconnects.
      // A busy refusal goes to the asker only: it must not fail the flow the other overlays follow.
      case 'update.daemon':
        if (!opts.updater) return reply({ type: 'update.failed', version: msg.version, reason: 'no-systemd' });
        return opts.updater.update(msg.version, broadcast, reply);
      case 'chat.ask': {
        const uploads = msg.images ?? [];
        // A refusal ends the asker's turn (a chat.error for its qid), as chat.route does: a generic error would leave it waiting.
        if (msg.text.trim() === '' && uploads.length === 0) return reply({ type: 'chat.error', qid: msg.qid, message: 'empty question' });
        const refs: AttachmentRef[] = [];
        try { for (const u of uploads) refs.push(await storeUpload(u)); }
        catch (e) { if (e instanceof AttachmentError) return reply({ type: 'chat.error', qid: msg.qid, message: `image refused: ${e.reason}` }); throw e; }
        return chat.ask(msg.qid, msg.text, broadcast, msg.tool, refs);
      }
      case 'attachment.put':
        try { return reply({ type: 'attachment.stored', requestId: msg.requestId, ref: await storeUpload(msg.image) }); }
        catch (e) { if (e instanceof AttachmentError) return reply({ type: 'attachment.error', requestId: msg.requestId, reason: e.reason }); throw e; }
      case 'attachment.get': {
        const found = await attachments.read(msg.attachment, msg.preview === true);
        if (!found) return reply({ type: 'attachment.error', requestId: msg.requestId, reason: 'not_found' });
        return reply({ type: 'attachment.data', requestId: msg.requestId, attachment: msg.attachment, mime: found.mime, data: found.data.toString('base64') });
      }
      case 'chat.route':
        try { reply({ type: 'chat.routed', qid: msg.qid, result: await router.route(msg) }); }
        catch (e) { reply({ type: 'chat.error', qid: msg.qid, message: (e as Error).message }); }
        return;
      case 'chat.cancel': router.cancel(msg.qid); return chat.cancel(msg.qid);
      case 'chat.reset': return chat.reset(broadcast);
      // « Ignorer » / « Revoir » a card of the PC's thread: every overlay gets the turn's ignoredAt through chat.history.
      case 'chat.ignore': { const why = chat.ignore(msg.qid, msg.undo === true, broadcast); return why === null ? undefined : refuse(why); }
      case 'session.focus':
        return; // handled by the overlay plan via wt.exe; the daemon only acknowledges
      // The OpenRig mirror's exchanges: this daemon answers for its own machine only (lot 6 routes the others).
      case 'rig.exchanges.request':
        if (!bridge) return notYet();
        if (msg.machine !== 'local') return reply({ type: 'error', message: `machine ${msg.machine} is not this daemon's`, request: msg.type, code: 'unreachable' });
        return reply({ type: 'rig.exchanges', machine: 'local', rigId: msg.rigId, items: bridge.exchanges(msg.rigId) });
      // The rig specs of this machine (the Rigs tab's « Specs »); the Desktop routes a remote machine's request to its own daemon.
      case 'rig.specs.request': {
        const base = { type: 'rig.specs' as const, requestId: msg.requestId, machine: 'local' };
        const st = bridge?.status().state; const http = bridge?.http();
        if (!bridge || !http || st !== 'running') return reply({ ...base, specs: [], error: st === 'unsupported' ? 'unsupported' : 'openrig_down' });
        try { return reply({ ...base, specs: await listSpecs(http) }); }
        catch (e) { log(`openrig: specs not listed: ${(e as Error).message}`); return reply({ ...base, specs: [], error: e instanceof OpenRigUnreachable ? 'openrig_down' : 'failed' }); }
      }
      // OpenRig writes and Ledge's own voice come in later lots.
      case 'ledge.thread.request': return reply({ type: 'ledge.thread.history', ...thread.page(msg.before) });
      // To the sender only: every client learns the escalation's new state from the bridge's escalation.updated.
      case 'escalation.answer': return ridMemo.once('escalation.answer', msg.rid, reply, async reply => {
        if (!answers) return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'openrig_down', reason: "OpenRig n'est pas branché" });
        const r = await answers.answer(msg.id, msg.answers, msg.by);
        return reply(r.ok ? { type: 'rig.result', rid: msg.rid, ok: true } : { type: 'rig.result', rid: msg.rid, ok: false, code: r.code, reason: r.reason });
      });
      // To the sender: accepted as soon as the user item is in the thread; the answer reaches every front through the thread.
      case 'ledge.say': {
        if (msg.text.trim() === '') return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'invalid', reason: 'empty message' });
        const answered = ledgeSay.say(msg.rid, msg.text, msg.about);
        reply({ type: 'rig.result', rid: msg.rid, ok: true });
        return answered;
      }
      // Lifecycle of a rig or a seat, through OpenRig; to the sender only (the mirror shows the effect by SSE).
      case 'rig.act': return ridMemo.once('rig.act', msg.rid, reply, async reply => {
        const r = await rigAct(msg);
        return reply(r.ok ? { type: 'rig.result', rid: msg.rid, ok: true } : { type: 'rig.result', rid: msg.rid, ok: false, code: r.code, ...(r.reason !== undefined ? { reason: r.reason } : {}) });
      });
      // Writing to a seat; to the sender only. The Desktop routes another machine's seats to its own daemon (lot 6).
      case 'rig.send': return ridMemo.once('rig.send', msg.rid, reply, async reply => {
        if (msg.machine !== 'local') return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'unreachable', reason: `machine ${msg.machine} is not this daemon's` });
        if (msg.text.trim() === '' || msg.seatRef.startsWith('-')) return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'invalid', reason: 'empty message or bad seat' });
        if (!bridge || !seatSend) return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'openrig_down', reason: "OpenRig n'est pas branché" });
        const r = await seatSend.send(msg.machine, msg.seatRef, msg.text);
        return reply(r.ok ? { type: 'rig.result', rid: msg.rid, ok: true } : { type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', reason: r.reason });
      });
      case 'rig.prepare': return ridMemo.once('rig.prepare', msg.rid, reply, async reply => {
        const plan = await rigPrepare(msg);
        if ('code' in plan) return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: plan.code, reason: plan.reason });
        rigPlans.put(plan);
        return reply({ type: 'rig.plan', rid: msg.rid, plan });
      });
      // A plan `rig.prepare` made, launched once; to the sender only (the mirror and the thread show the rest).
      case 'rig.launch': return ridMemo.once('rig.launch', msg.rid, reply, async reply => {
        if (!bridge || !launches) return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'openrig_down', reason: "OpenRig n'est pas branché" });
        const plan = rigPlans.take(msg.planId);
        if (plan === 'used') return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', reason: 'plan already launched' });
        if (plan === null) return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', reason: 'plan expired' });
        try {
          const r = await launches.launch(plan);
          // « Not now »: the plan stays, the same rid (not memoized) launches it later.
          if (!r.ok && r.code === 'openrig_down') rigPlans.giveBack(plan.id);
          return reply(r.ok ? { type: 'rig.result', rid: msg.rid, ok: true } : { type: 'rig.result', rid: msg.rid, ok: false, code: r.code, reason: r.reason });
        } catch (e) {
          log(`openrig: launch failed: ${(e as Error).message}`);
          return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', reason: (e as Error).message });
        }
      });
      // Files a rig in a project: only projects.json changes; the mirror recomputes the rig's project.
      case 'rig.adopt': {
        const result = (r: { ok: true } | { ok: false; code: 'failed' | 'unreachable' | 'openrig_down'; reason: string }): void => reply({ type: 'rig.result', rid: msg.rid, ...r });
        if (!bridge) return result({ ok: false, code: 'openrig_down', reason: "OpenRig n'est pas branché" });
        if (msg.machine !== 'local') return result({ ok: false, code: 'unreachable', reason: `La machine ${msg.machine} n'est pas joignable d'ici` });
        if (!bridge.rigs().some(r => r.id === msg.rigId)) return result({ ok: false, code: 'failed', reason: 'unknown rig' });
        const next = adoptRig(projects, msg.projectId, msg.rigId);
        if ('refused' in next) return result({ ok: false, code: 'failed', reason: next.refused });
        try { writeProjects(next, projectsFile); } catch (e) { log(`openrig: adopt not saved: ${(e as Error).message}`); return result({ ok: false, code: 'failed', reason: (e as Error).message }); }
        projects = next; bridge.refresh(); aggregate?.refresh(); broadcast(projectsMsg());
        return result({ ok: true });
      }
      case 'brain.cmd': return runBrainCmd(msg, reply);
      case 'decision.revisit': {
        if (!revisits) return reply({ type: 'rig.result', rid: msg.rid, ok: false, reason: "OpenRig n'est pas branché" });
        const r = await revisits.revisit(msg.id, msg.text);
        return reply({ type: 'rig.result', rid: msg.rid, ok: r.ok, ...(r.reason !== undefined ? { reason: r.reason } : {}) });
      }
      case 'mandate.update': {
        try { writeMandate(msg.text); } catch (e) { return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', reason: (e as Error).message }); }
        broadcast(mandateMsg());
        return reply({ type: 'rig.result', rid: msg.rid, ok: true, ...(parseMandate(msg.text).readable ? {} : { reason: 'le mandat illisible fait tout remonter à toi' }) });
      }
      case 'rule.set': {
        const r = memory.setRule(msg.id, msg.status);
        return reply(r ? { type: 'rig.result', rid: msg.rid, ok: true } : { type: 'rig.result', rid: msg.rid, ok: false, code: 'invalid', reason: 'règle inconnue' });
      }
      case 'category.escalate': {
        const text = mandateText();
        if (parseMandate(text).user.includes(msg.category)) return reply({ type: 'rig.result', rid: msg.rid, ok: true });
        const next = escalateCategory(text, msg.category);
        if (next === text) return reply({ type: 'rig.result', rid: msg.rid, ok: true }); // not in the first list: nothing to move
        try { writeMandate(next); } catch (e) { return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', reason: (e as Error).message }); }
        broadcast(mandateMsg());
        brainInbox.push({ kind: 'state', text: `L'utilisateur se fait remonter ${MANDATE_CATEGORY_LABEL[msg.category].fr} désormais.` });
        return reply({ type: 'rig.result', rid: msg.rid, ok: true });
      }
      case 'brain.set': {
        if (msg.tool !== undefined && !isBrainTool(msg.tool)) return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'invalid', reason: `${msg.tool === 'omp' ? 'OMP' : msg.tool} ne peut pas être le cerveau de Ledge : choisis Claude Code, Codex ou Cursor.` });
        try { await brain.set({ enabled: msg.enabled, ...(msg.tool ? { tool: msg.tool } : {}) }); }
        catch (e) { return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', reason: (e as Error).message }); }
        const st = brain.status();
        if (!msg.enabled && brain.session()) return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', reason: "Le cerveau de Ledge tourne encore : sa fermeture n'a pas abouti." });
        if (st.state === 'down') return reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', ...(st.reason ? { reason: st.reason } : {}) });
        if (msg.first && msg.enabled) thread.append({ kind: 'ledge', text: BRAIN_FIRST_TEXT }); // the first activation says what Ledge now does
        return reply({ type: 'rig.result', rid: msg.rid, ok: true });
      }
      // A refusal of the service (an unknown pairing, a sign-in while disabled) reaches the sender as an `error`.
      case 'mobile.set': case 'mobile.signin': case 'mobile.signin.cancel': case 'mobile.signout': case 'mobile.retry':
      case 'mobile.pairing.approve': case 'mobile.pairing.deny': case 'mobile.device.revoke':
        if (!mobile) return refuse(new Refusal('mobile access is not available', 'unavailable'));
        return mobile.handle(msg);
    }
  }

  /**
   * `handle`, its failure answered through `reply` too: a refusal with its code, any other error without one. The `id`
   * is only a session's (a mobile.* id names a pairing or a device). Never rejects.
   */
  function dispatch(msg: ClientMessage, reply: Reply): Promise<void> {
    return (rigRouter && isRigCommand(msg) ? rigRouter.route(msg, reply) : handle(msg, reply)).catch(e => {
      if (msg.type === 'document.read') return reply({ type: 'document.error', requestId: msg.requestId, path: msg.path, code: 'read_failed' });
      log(`${msg.type} failed: ${(e as Error).message}`);
      reply({ type: 'error', ...(msg.type.startsWith('session.') && 'id' in msg && typeof msg.id === 'string' ? { id: msg.id } : {}), message: (e as Error).message, request: msg.type, ...(e instanceof Refusal ? { code: e.code } : {}) });
    });
  }

  if (mobile) gateway = createPhoneGateway({
    mobile,
    ...(aggregate ? { openrig: { rigs: aggregate.rigs, escalations: aggregate.escalations, escalation: aggregate.escalation, exchanges: aggregate.exchanges, rules: memory.rules, decisions: () => memory.decisions({ limit: 200 }), projects: () => projects, thread: (before?: string) => thread.page(before) } } : {}),
    // A dropped device thread takes its queued cards with it: the sessions they waited for go on to what else waits.
    chats: { ...threads, async drop(id: string) {
      const waiting = [...new Set(threads.queuedRelays().filter(q => q.thread === `device:${id}`).map(q => q.relay.id))];
      try { await threads.drop(id); } finally { for (const sid of waiting) relay.settle(sid); }
    } },
    sessions: () => store.all(),
    session: id => store.get(id),
    thread: id => history?.items(id),
    preview: id => previews.get(id),
    dispatch,
    attachments,
    relay,
    launchChat: (thread, qid, rows) => {
      const c = thread === 'desktop' ? threads.desktop : threads.device(thread.slice('device:'.length));
      const userHome = resolve(opts.home ?? homedir());
      return launchFromChat({
        chat: c, emit: threads.emitterOf(thread) ?? (() => {}), inFlight: chatLaunches,
        launch: async p => (await launch({ tool: p.tool, cwd: p.cwd, prompt: p.prompt, model: p.model, effort: p.effort })).id,
        refuse: p => { const wide = tooWide(resolve(p.cwd), userHome); return wide ? `the folder is ${wide}` : null; }
      }, qid, rows);
    },
    closeChat: (thread, qid, rows) => {
      const card = cardOf(cardThreads, qid);
      if (!card || card.thread !== thread) return Promise.reject(new CloseRefused('unknown close'));
      // The phone learns of each row from chat.history, so nothing is sent on a close.
      return closeFromChat({
        chat: card.chat, emit: card.emit, inFlight: chatCloses,
        close: closeForCard
      }, qid, rows);
    },
    actChat: (thread, qid, rid, rows, confirmed, deny) => {
      const card = cardOf(cardThreads, qid);
      if (!card || card.thread !== thread) return Promise.reject(new ActRefused('unknown action'));
      return actOnCard(card, qid, rid, rows, confirmed, deny);
    },
    onChatEnd: (deviceId, end) => notifyChatEnd?.(deviceId, end.code),
    version: opts.daemon?.version ?? 'unknown',
    boot: randomUUID(),
    log,
    now,
    rp: () => rpOf(mobile.state().relayUrl),
    challenges: createChallengeStore(),
    credential: id => mobile.credential(id),
    setCredential: (id, c) => mobile.setCredential(id, c),
    contextNear: () => contextPrefs.near,
    // The phone's model switch (#58): `session.model` answers with a code, and `models.list` asks this machine's agents.
    models: true,
    // A session's « Fermer » on the phone: the cards' close, so a close under way (a card's, another phone's) is shared.
    closeSession: closeForCard,
    // The phone's « Mettre à jour le PC » and « Redémarrer le daemon »: the updater Desktop's `update.daemon` uses, progress broadcast.
    ...(opts.updater && opts.daemon ? {
      pc: {
        canUpdate: opts.daemon.install === 'npm' && opts.daemon.systemd, canRestart: opts.daemon.systemd,
        update: (version: string, reply: (m: ServerMessage) => void) => { void opts.updater!.update(version, broadcast, reply); },
        restart: (reply: (m: ServerMessage) => void) => { void opts.updater!.restart(broadcast, reply); }
      }
    } : {})
  });
  /** A hidden phone is told, through the relay, of what deserves it. */
  let unsubscribePush: (() => void) | undefined;
  if (mobile) {
    const notifier = createNotifier({ mobile, presence: id => gateway?.visible(id) ?? false, log });
    notifyChatEnd = (deviceId, code) => {
      const badge = store.all().filter(s => s.pending).length;
      void notifier.notify(chatEndPayload(code, badge), undefined, deviceId).catch(e => log(`push failed (${e instanceof Error ? e.name : 'error'})`));
    };
    unsubscribePush = store.onApply((before, after) => {
      const p = pushFor(before, after, store.all());
      if (p) void notifier.notify(p, after.id).catch(e => log(`push failed (${e instanceof Error ? e.name : 'error'})`));
    });
  }

  wss.on('connection', (ws, req) => {
    ws.on('error', e => log(`socket error: ${e.message}`));
    const path = requestPath(req.url);
    if (path.startsWith('/ssh/')) {
      if (remoteClients.size >= 20) { ws.close(1013, 'Too many remote connections'); return; }
      remoteClients.add(ws); ws.once('close', () => remoteClients.delete(ws));
      const parsed = SshAliasSchema.safeParse(path.slice(5));
      if (!parsed.success) { ws.close(1008, 'Invalid SSH alias'); remoteClients.delete(ws); return; }
      const alias = parsed.data;
      void agentEnv().then(env => { if (ws.readyState === WebSocket.OPEN) (opts.ssh ?? serveSsh)(ws, alias, { env }); })
        .catch(e => { send(ws, { type: 'error', message: (e as Error).message }); ws.close(1011); });
      return;
    }
    localClients.add(ws);
    ws.once('close', () => { localClients.delete(ws); colorFollow.delete(ws); for (const id of colorLast.keys()) if (!colorWanted(id)) colorLast.delete(id); });
    const reply: Reply = m => send(ws, m);
    sendSnapshot(reply);
    ws.on('message', data => {
      let msg: ClientMessage;
      let raw: unknown;
      try { raw = JSON.parse(String(data)); msg = parseClientMessage(raw); }
      catch (e) {
        log(`invalid message: ${(e as Error).message}`);
        // The type and the id it carried, when it has them: a newer front's value this daemon does not know is refused by
        // name, for that very session, at once (not left to the front's own timeout).
        // Only a session's id: a mobile.* id names a pairing or a device, never a session a front would fail.
        const { type, id } = (raw ?? {}) as { type?: unknown; id?: unknown };
        const named = typeof type === 'string' && type.length <= 64 ? type : undefined;
        return reply({ type: 'error', message: 'invalid message', ...(named?.startsWith('session.') && typeof id === 'string' && id.length <= 200 ? { id } : {}), ...(named ? { request: named } : {}), code: 'invalid' });
      }
      if (msg.type === 'session.preview.subscribe') {
        // Per client, so it lives here and not in `dispatch` (which has no socket).
        if (msg.id === null) colorFollow.delete(ws); else colorFollow.set(ws, msg.id);
        for (const id of colorLast.keys()) if (!colorWanted(id)) colorLast.delete(id);
        const last = msg.id === null ? undefined : colorLast.get(msg.id);
        if (last) reply({ type: 'session.preview.color', id: msg.id!, lines: last });
        return;
      }
      void dispatch(msg, reply);
    });
  });

  remote?.setMachines(machines);
  void brain.start().catch(e => log(`brain not started: ${(e as Error).message}`));

  return {
    port,
    broadcast,
    preview,
    colorWanted,
    colorCached,
    sendColorPreview,
    omp,
    sweepAttachments,
    closeSession: id => { const s = store.get(id); return s ? closeSession(s) : Promise.reject(unknownSession()); },
    labelExited,
    asks,
    projects: () => projects,
    say: text => { thread.append({ kind: 'ledge', text }); },
    close: () => new Promise<void>(res => { clearInterval(sweepTimer); clearInterval(brainDayTimer); unsubscribe(); unsubscribeBrain(); unsubscribeMemory(); deciding?.dispose(); brain.dispose(); unsubscribeBridge?.(); unsubscribeAggregate?.(); rigRouter?.close(); remote?.close(); launches?.close(); stopRepoWatch?.(); unsubscribeThread(); for (const u of unsubscribeHistory) u(); unsubscribeMobile?.(); unsubscribePush?.(); gateway?.stop(); relay.close(); mailbox.close(); asks.close(); handovers.close(); void omp.closeAll(); for (const c of wss.clients) c.terminate(); for (const socket of sockets) socket.destroy(); wss.close(() => httpServer.close(() => res())); }).then(() => thread.flush())
  };
}
