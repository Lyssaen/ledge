import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { DEFAULT_RELAY_URL, NOTE_NOT_TYPED, PROTOCOL_PORT, SshAliasSchema, offers, parseClientMessage, pendingKey, type ClientMessage, type DaemonInfo, type MobileState, type Decision, type Pending, type ServerMessage, type Session, type SessionEvent, type Tool } from '@ledge/protocol';
import type { Store } from './store.js';
import type { History } from './history.js';
import type { Tmux } from '../tmux.js';
import { adapterFor, type KeyPlan } from '../adapters/index.js';
import { Refusal, STALE, bottomLines, dialogMismatch } from '../adapters/types.js';
import { verifyGone } from '../adapters/verify.js';
import { DETECT_LINES } from './poller.js';
import { answeredBy, pendingTool } from './state.js';
import { claudeOpenCall, claudeToolAnswered } from './transcript.js';
import { pickName } from '../names.js';
import { spawnSession } from '../spawn.js';
import { inspectRepos } from './repos.js';
import { extraRoots, scanRepos } from './scan.js';
import { createFolder, listFolder, resolveFolder } from './folders.js';
import { loginShellEnv } from '../shell-path.js';
import { log } from '../log.js';
import { createChat, type Chat } from '../chat/service.js';
import { createForge } from '../chat/forge.js';
import { paths } from '../paths.js';
import { ensureDaemonToken, hostAllowed, requestAuthorized, selectDaemonProtocol } from '../auth.js';
import { readMachines, writeMachines } from './machines.js';
import { readProjects, writeProjects } from './projects.js';
import { readIsland, writeIsland } from './island.js';
import { readDocument } from './documents.js';
import { createModels, type Models } from './models.js';
import { createRelay } from './relay.js';
import { createMailbox } from './mailbox.js';
import type { createDaemonUpdater } from '../update/run-update.js';
import { createRouter } from '../chat/routing.js';
import { serveSsh } from '../transport/ssh.js';
import type { MobileService } from '../mobile/service.js';
import { createPhoneGateway, type PhoneGateway } from '../mobile/gateway.js';
import { MAX_FRAME } from '../transport/frames.js';

/** How each agent resumes the folder's last conversation, all three verified (Cursor Agent: `--continue`). */
export const CONTINUE_ARGS: Record<Tool, string[]> = { claude: ['--continue'], codex: ['resume', '--last'], cursor: ['--continue'] };

/** How each agent continues one conversation by its own id (Claude Code and Cursor Agent `--resume <id>`, Codex `resume <id>`). */
export const RESUME_ARGS: Record<Tool, (id: string) => string[]> = { claude: id => ['--resume', id], codex: id => ['resume', id], cursor: id => ['--resume', id] };

/** The agent's own conversation id: the one its hooks gave, else, for Claude Code, the name of its transcript file. */
export function resumeKey(s: Session): string | undefined {
  if (s.agentSessionId) return s.agentSessionId;
  return s.tool === 'claude' && s.transcriptPath ? basename(s.transcriptPath, '.jsonl') : undefined;
}

/** The harnesses that take extra folders, and how. Claude only (verified: `claude --add-dir a b -- "prompt"`). */
export const MULTI_DIR_ARGS: Partial<Record<Tool, (dirs: string[]) => string[]>> = { claude: dirs => ['--add-dir', ...dirs] };

/** How each agent takes a model (#58): Claude Code `--model`, Codex `-m` (also after `resume`), Cursor Agent `--model`. */
export const MODEL_ARGS: Record<Tool, (model: string) => string[]> = { claude: m => ['--model', m], codex: m => ['-m', m], cursor: m => ['--model', m] };
/** How each agent takes an effort; Cursor Agent has none apart from its model id (`gpt-5.3-codex-high`). */
export const EFFORT_ARGS: Partial<Record<Tool, (effort: string) => string[]>> = { claude: e => ['--effort', e], codex: e => ['-c', `model_reasoning_effort="${e}"`] };

/** The agent's arguments for a `session.launch`: the resume flag, the model and effort, then the first instruction as the positional prompt. */
export function launchArgs(msg: { tool: Tool; prompt?: string; continue?: boolean; dirs?: string[]; model?: string; effort?: string }): string[] {
  const prompt = msg.prompt?.trim();
  const more = msg.dirs?.length ? MULTI_DIR_ARGS[msg.tool]?.(msg.dirs) : undefined;
  const model = msg.model ? MODEL_ARGS[msg.tool](msg.model) : [];
  const effort = msg.effort ? EFFORT_ARGS[msg.tool]?.(msg.effort) ?? [] : [];
  // The `--` only follows --add-dir: the option is variadic and would swallow the prompt.
  return [...(msg.continue ? CONTINUE_ARGS[msg.tool] : []), ...model, ...effort, ...(more ?? []), ...(prompt ? [...(more ? ['--'] : []), prompt] : [])];
}

export { resolveFolder };

/** A deny with a note whose deny keys went but whose input box never came back: refused, the note not typed (NOTE_NOT_TYPED). */
class NoteNotTyped extends Refusal { constructor() { super('denied, but the note could not be typed', NOTE_NOT_TYPED); } }

/** Where `handle` sends its answers: the one socket that asked, or the phone gateway's device. */
type Reply = (m: ServerMessage) => void;

/**
 * Origins allowed to open a WebSocket: the Tauri overlay (packaged and dev server). A browser always
 * sends Origin, so any other web page is refused; Node clients (hook, launcher, status) send none.
 * Origin is not enough: every client must also present the daemon token, and Host must be loopback.
 */
/** How long the hooks of a deleted session are ignored: its late SessionEnd or last Stop must not bring it back. */
export const DELETED_TTL_MS = 5 * 60 * 1000;

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
export async function startServer(opts: { store: Store; tmux: Tmux; port?: number; host?: string; now?: () => string; verify?: { attempts?: number; intervalMs?: number }; confirmMs?: number; untilMs?: number; launcher?: string[]; home?: string; agentEnv?: () => Promise<NodeJS.ProcessEnv>; chat?: Chat; claudeBin?: string[]; daemon?: DaemonInfo; updater?: ReturnType<typeof createDaemonUpdater>; ssh?: typeof serveSsh; history?: History; machinesFile?: string; projectsFile?: string; islandFile?: string; scan?: typeof scanRepos; models?: Models; mobile?: MobileService; mobileUnavailable?: string }): Promise<ServerHandle> {
  const { store, tmux } = opts;
  const now = opts.now ?? (() => new Date().toISOString());
  const launcher = opts.launcher ?? [process.execPath, process.argv[1] ?? 'ledge'];
  // Under systemd the daemon has the bare system environment (no PATH to the agents, no proxy): a launched agent gets
  // the login shell's on top of it, as a terminal would.
  const agentEnv = opts.agentEnv ?? (async () => ({ ...process.env, ...(await loginShellEnv()) }));
  const chat = opts.chat ?? createChat({ store, tmux, home: paths().dir, userHome: opts.home, env: agentEnv, bin: opts.claudeBin, now, projects: () => projects, forge: createForge({ env: agentEnv }) });
  const router = createRouter({ env: agentEnv });
  const models = opts.models ?? createModels({ env: agentEnv });
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
  /** Every local front gets it; the phone gateway passes on only what it knows. */
  const broadcast = (msg: ServerMessage) => { for (const c of localClients) send(c, msg); gateway?.forward(msg); };
  const history = opts.history;
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
  /** `replyTo` for the mailbox and the relay, which keep the refusal's text. */
  const replyText = async (id: string, text: string) => (await replyTo(id, text))?.message ?? null;
  const mailbox = createMailbox({
    store, replyTo: replyText, typing, now,
    relayQueued: id => chat.queuedRelays().some(q => q.relay.id === id),
    sent: { record: (id, m) => { history?.recordSent(id, m); }, mark: (id, rid, status) => history?.markSent(id, rid, status) }
  });
  const relay = createRelay({ chat, store, replyTo: replyText, broadcast, now, typing, next: id => mailbox.kick(id) });
  /** The last preview per session, replayed after every snapshot so a late client does not wait for the agent to write. */
  const previews = new Map<string, string[]>();
  /** The title last pushed to each session's tmux tab, so tmux is told only when it changes. */
  const titles = new Map<string, string>();
  const unsubscribe = store.onChange(c => {
    if (c.type === 'recents') return broadcast({ type: 'recents', recents: c.recents });
    if (c.type === 'updated' && c.session.tmuxSession && titles.get(c.session.id) !== c.session.title) {
      titles.set(c.session.id, c.session.title);
      tmux.setOption(c.session.tmuxSession, '@ledge_title', c.session.title).catch(e => log(`tab title not set for ${c.session.id}: ${(e as Error).message}`));
    }
    if (c.type === 'removed') { previews.delete(c.id); titles.delete(c.id); }
    broadcast(c.type === 'updated' ? { type: 'session.updated', session: c.session } : { type: 'session.removed', id: c.id });
  });
  const sendSnapshot = (reply: Reply) => {
    reply({ type: 'snapshot', sessions: store.all(), recents: store.recents(), launcher, ...(opts.daemon ? { daemon: { ...opts.daemon, routing: true, archive: true, models: true, ...(mobile || unavailable ? { mobile: true } : {}) } } : {}) });
    reply(machinesMsg()); // spec §5.2: after each snapshot, the shared machines list
    reply(projectsMsg()); // then the shared projects (build spec §5)
    reply(islandMsg()); // then the island's settings
    if (mobile) reply({ type: 'mobile', state: mobile.state() }); // then mobile access
    else if (unavailable) reply({ type: 'mobile', state: unavailable });
    for (const [id, lines] of previews) if (store.get(id)) reply({ type: 'session.preview', id, lines });
    reply({ type: 'chat.history', turns: chat.history() });
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
    if (s.source !== 'launcher' || s.state === 'exited') return;
    if (s.tmuxSession) await tmux.killSession(s.tmuxSession).catch(e => log(`kill of ${s.tmuxSession} failed: ${(e as Error).message}`));
    store.apply(s.id, { name: 'PaneGone', at: now(), source: 'daemon' });
  }

  /** session.reply's checks and typing (shared with the chat's relay): null once typed, the refusal otherwise; rejects when the injection fails. */
  async function replyTo(id: string, text: string): Promise<Refusal | null> {
    const s = store.get(id); if (!s) return unknownSession();
    if (s.source === 'hook_only') return readOnly();
    // A select dialog ignores typed text and Enter would pick option 1: those take decide only.
    if (s.pending && s.pending.kind !== 'question') return new Refusal(`a ${s.pending.kind} prompt takes accept or deny, not a reply`, 'not_offered');
    if (text.trim() === '') return new Refusal('empty reply', 'invalid');
    // A question dialog is a select: typed text then Enter would silently pick the highlighted option, unless the
    // adapter knows the dialog's own free-text field.
    const pending = s.pending; const adapter = adapterFor(s.tool);
    if (pending?.kind === 'question' && !/^[1-9]$/.test(text.trim()) && !adapter.freeText) return new Refusal(FREE_TEXT, 'free_text');
    // With no pending (idle, your turn) the text goes to the input line: no prompt to check for.
    await injectAndVerify(id, pane => adapter.replyPlan(text, pending, pane || undefined), !!pending);
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

  /** The chat cards being launched: a second click, or another overlay, is refused until the first one has answered. */
  const chatLaunches = new Set<string>();
  /** Spawns the agent as `ledge <tool>` would and records it; throws the reason (bad folder, tmux). */
  async function launch(req: { tool: Tool; cwd: string; name?: string; prompt?: string; continue?: boolean; dirs?: string[]; model?: string; effort?: string }): Promise<Session> {
    if (req.dirs?.length && !MULTI_DIR_ARGS[req.tool]) throw new Error(`launch: ${req.tool} takes one folder`);
    if (req.effort && !EFFORT_ARGS[req.tool]) throw new Error(`launch: ${req.tool} takes its effort in the model id`);
    const cwd = await resolveFolder(req.cwd, opts.home);
    const dirs = req.dirs?.length ? await Promise.all(req.dirs.map(d => resolveFolder(d, opts.home))) : undefined;
    const live = store.all();
    const env = await agentEnv();
    const spawned = await spawnSession({ tool: req.tool, args: launchArgs({ ...req, dirs }), name: req.name, cwd, tmux, now, env, taken: { names: live.filter(s => s.state !== 'exited').map(s => s.name), ids: live.map(s => s.id) } });
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
  async function handle(msg: ClientMessage, reply: Reply): Promise<void> {
    /** A refusal names the request it answers, so a front can tell a refused reply from a refused decision; a coded one says why. */
    const refuse = (r: Refusal | string, id?: string) => reply({ type: 'error', ...(id !== undefined ? { id } : {}), message: typeof r === 'string' ? r : r.message, request: msg.type, ...(typeof r === 'string' ? {} : { code: r.code }) });
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
        return broadcast(machinesMsg()); // every local client, the sender included
      }
      case 'projects.set': {
        writeProjects(msg.projects, projectsFile); // first: a failing write leaves memory unchanged and reaches the sender
        projects = msg.projects; // already validated by parseClientMessage
        return broadcast(projectsMsg());
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
        // A chat card (spec 2026-10-12 §4): the proposal's own fields, never the message's but the model chosen on the card (#58). Its rows (#24) start one after the other,
        // so each launch registers its bot before the next picks a name; a launched row, or one in flight, is passed over.
        const qid = msg.qid; const rows = msg.rows ?? [0];
        const todo = rows.filter(r => { const p = chat.proposal(qid, r); return p && !p.launchedId && !chatLaunches.has(`${qid}#${r}`); });
        if (todo.length === 0) return refuse(rows.some(r => chat.proposal(qid, r)) ? 'already launched' : 'unknown proposal');
        for (const r of todo) chatLaunches.add(`${qid}#${r}`);
        let failure: unknown = null;
        try {
          for (const r of todo) {
            const p = chat.proposal(qid, r)!;
            try {
              const session = await launch({ tool: p.tool, cwd: p.cwd, prompt: p.prompt, model: msg.model, effort: msg.effort });
              reply({ type: 'session.launched', id: session.id });
              chat.markLaunched(qid, session.id, broadcast, r);
            } catch (e) { chat.markFailed(qid, (e as Error).message, broadcast, r); failure = e; }
            finally { chatLaunches.delete(`${qid}#${r}`); }
          }
        } finally { for (const r of todo) chatLaunches.delete(`${qid}#${r}`); }
        if (failure) throw failure;
        return;
      }
      case 'folder.list': return reply(await listFolder(msg.path, opts.home, msg.requestId));
      case 'folder.create': {
        const listing = await createFolder(msg.parent, msg.name, opts.home, msg.requestId);
        if (!listing.error) log(`created folder ${listing.path}`);
        return reply(listing);
      }
      case 'session.event': {
        const ev = msg.event;
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
        store.apply(msg.id, { name: 'SessionEnd', at: now(), source: 'hook', exitCode: msg.exitCode });
        return;
      case 'session.decide': {
        const s = store.get(msg.id); if (!s) return refuse(unknownSession(), msg.id);
        if (s.source === 'hook_only') return refuse(readOnly(), msg.id);
        // A decision is for the request the user saw: another one (or none) since is refused before any key.
        if (msg.expect && (s.pending?.kind !== msg.expect.kind || s.pending.text !== msg.expect.text
          || (msg.expect.key !== undefined && pendingKey(s.pending) !== msg.expect.key))) return refuse(new Refusal(STALE, 'stale'), msg.id);
        if (!s.pending) return refuse(new Refusal('nothing to decide', 'nothing_to_decide'), msg.id);
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
        const refused = await replyTo(msg.id, msg.text);
        if (refused) refuse(refused, msg.id);
        return;
      }
      case 'session.interrupt': {
        const s = store.get(msg.id);
        if (s?.source === 'hook_only') return refuse(readOnly(), msg.id);
        if (!s?.tmuxSession) return;
        await tmux.sendKeys(s.tmuxSession, adapterFor(s.tool).interruptKeys());
        return;
      }
      case 'session.kill': {
        const s = store.get(msg.id); if (!s) return;
        if (s.source === 'hook_only') return refuse(readOnly(), msg.id);
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
        if (s.state !== 'exited') return refuse(new Refusal('the session is still running', 'busy'), msg.id);
        const key = resumeKey(s); if (!key) return refuse('no conversation to resume', msg.id);
        // Marked live before the first await: a second resume arriving while this one spawns is then refused above.
        const { archivedAt: _a, exitedAt: _e, exitCode: _c, ...rest } = s;
        store.upsert({ ...rest, state: 'starting', source: 'launcher', agentSessionId: key });
        try {
          const cwd = await resolveFolder(s.cwd, opts.home);
          const env = await agentEnv();
          const spawned = await spawnSession({ tool: s.tool, id: s.id, name: s.name, args: [...RESUME_ARGS[s.tool](key), ...(s.model ? MODEL_ARGS[s.tool](s.model) : []), ...(s.effort ? EFFORT_ARGS[s.tool]?.(s.effort) ?? [] : [])], cwd, tmux, now, env, taken: { names: store.all().filter(o => o.id !== s.id && o.state !== 'exited').map(o => o.name), ids: [] } });
          // Deleted or archived while it spawned: that request wins, the agent just started is stopped and not recorded.
          const cur = store.get(s.id);
          if (!cur || cur.archivedAt !== undefined) {
            if (spawned.tmuxSession) await tmux.killSession(spawned.tmuxSession).catch(e => log(`kill of ${spawned.tmuxSession} failed: ${(e as Error).message}`));
            log(`resume of ${s.id} dropped: the session was ${cur ? 'archived' : 'deleted'} meanwhile`);
            return;
          }
          const { topic, topicSource, repo, repoPath, branch, worktree, repoId, project, transcriptPath, model, effort } = s;
          store.upsert({ ...spawned, agentSessionId: key, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(transcriptPath ? { transcriptPath } : {}), ...(topic ? { topic } : {}), ...(topicSource ? { topicSource } : {}), ...(repo ? { repo } : {}), ...(repoPath ? { repoPath } : {}), ...(branch ? { branch } : {}), ...(worktree !== undefined ? { worktree } : {}), ...(repoId ? { repoId } : {}), project });
          log(`resumed ${spawned.name} (${spawned.tool}) in ${spawned.cwd} as ${spawned.id}`);
        } catch (e) {
          // Put the old record back only over the interim one: a delete or an archive since then stands.
          const cur = store.get(s.id);
          if (cur && cur.archivedAt === undefined && cur.state === 'starting') store.upsert(s);
          return refuse((e as Error).message, msg.id);
        }
        return;
      }
      case 'session.delete': {
        const s = store.get(msg.id); if (!s) return refuse(unknownSession(), msg.id);
        // A running hook_only session is not stopped by Ledge: like a dismissed one, its next hook brings it back.
        if (s.source === 'launcher' || s.state === 'exited') markDeleted(msg.id);
        await endSession(s);
        store.remove(msg.id);
        return;
      }
      // An agent's message to another session: acked at once, typed when the target is free.
      case 'session.message': return reply(mailbox.submit(msg));
      // A chat card's instruction: a refusal reaches the requester as an `error`, the card's state everyone through chat.history.
      case 'session.relay': return relay.request(msg.qid);
      case 'session.relay.cancel': return relay.cancel(msg.qid);
      // Broadcast: every overlay shows the same progress, and the one that asked may be the one that reconnects.
      // A busy refusal goes to the asker only: it must not fail the flow the other overlays follow.
      case 'update.daemon':
        if (!opts.updater) return reply({ type: 'update.failed', version: msg.version, reason: 'no-systemd' });
        return opts.updater.update(msg.version, broadcast, reply);
      case 'chat.ask': return chat.ask(msg.qid, msg.text, broadcast, msg.tool);
      case 'chat.route':
        try { reply({ type: 'chat.routed', qid: msg.qid, result: await router.route(msg) }); }
        catch (e) { reply({ type: 'chat.error', qid: msg.qid, message: (e as Error).message }); }
        return;
      case 'chat.cancel': router.cancel(msg.qid); return chat.cancel(msg.qid);
      case 'chat.reset': return chat.reset(broadcast);
      case 'session.focus':
        return; // handled by the overlay plan via wt.exe; the daemon only acknowledges
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
    return handle(msg, reply).catch(e => {
      if (msg.type === 'document.read') return reply({ type: 'document.error', requestId: msg.requestId, path: msg.path, code: 'read_failed' });
      log(`${msg.type} failed: ${(e as Error).message}`);
      reply({ type: 'error', ...(msg.type.startsWith('session.') && 'id' in msg ? { id: msg.id } : {}), message: (e as Error).message, request: msg.type, ...(e instanceof Refusal ? { code: e.code } : {}) });
    });
  }

  if (mobile) gateway = createPhoneGateway({
    mobile,
    sessions: () => store.all(),
    session: id => store.get(id),
    thread: id => history?.items(id),
    preview: id => previews.get(id),
    dispatch,
    version: opts.daemon?.version ?? 'unknown',
    log,
    now
  });

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
    localClients.add(ws); ws.once('close', () => localClients.delete(ws));
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
      void dispatch(msg, reply);
    });
  });

  return {
    port,
    broadcast,
    preview,
    close: () => new Promise(res => { unsubscribe(); for (const u of unsubscribeHistory) u(); unsubscribeMobile?.(); gateway?.stop(); relay.close(); mailbox.close(); for (const c of wss.clients) c.terminate(); for (const socket of sockets) socket.destroy(); wss.close(() => httpServer.close(() => res())); })
  };
}
