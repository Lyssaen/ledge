import type { IncomingMessage } from 'node:http';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { NOTE_NOT_TYPED, PROTOCOL_PORT, SshAliasSchema, offers, parseClientMessage, type ClientMessage, type DaemonInfo, type Decision, type ServerMessage, type Session, type SessionEvent, type Tool } from '@ledge/protocol';
import type { Store } from './store.js';
import type { History } from './history.js';
import type { Tmux } from '../tmux.js';
import { adapterFor, type KeyPlan } from '../adapters/index.js';
import { STALE } from '../adapters/types.js';
import { verifyGone } from '../adapters/verify.js';
import { DETECT_LINES } from './poller.js';
import { pickName } from '../names.js';
import { spawnSession } from '../spawn.js';
import { inspectRepos } from './repos.js';
import { extraRoots, scanRepos } from './scan.js';
import { createFolder, listFolder, resolveFolder } from './folders.js';
import { loginShellEnv } from '../shell-path.js';
import { log } from '../log.js';
import { createChat, type Chat } from '../chat/service.js';
import { paths } from '../paths.js';
import { readMachines, writeMachines } from './machines.js';
import { readProjects, writeProjects } from './projects.js';
import { readDocument } from './documents.js';
import { createRelay } from './relay.js';
import type { createDaemonUpdater } from '../update/run-update.js';
import { createRouter } from '../chat/routing.js';
import { serveSsh } from '../transport/ssh.js';
import { MAX_FRAME } from '../transport/frames.js';

/** How each agent resumes the folder's last conversation, all three verified (Cursor Agent: `--continue`). */
export const CONTINUE_ARGS: Record<Tool, string[]> = { claude: ['--continue'], codex: ['resume', '--last'], cursor: ['--continue'] };

/** The harnesses that take extra folders, and how. Claude only (verified: `claude --add-dir a b -- "prompt"`). */
export const MULTI_DIR_ARGS: Partial<Record<Tool, (dirs: string[]) => string[]>> = { claude: dirs => ['--add-dir', ...dirs] };

/** The agent's arguments for a `session.launch`: the resume flag, then the first instruction as the positional prompt. */
export function launchArgs(msg: { tool: Tool; prompt?: string; continue?: boolean; dirs?: string[] }): string[] {
  const prompt = msg.prompt?.trim();
  const more = msg.dirs?.length ? MULTI_DIR_ARGS[msg.tool]?.(msg.dirs) : undefined;
  // The `--` only follows --add-dir: the option is variadic and would swallow the prompt.
  return [...(msg.continue ? CONTINUE_ARGS[msg.tool] : []), ...(more ?? []), ...(prompt ? [...(more ? ['--'] : []), prompt] : [])];
}

export { resolveFolder };

/** A deny with a note whose deny keys went but whose input box never came back: refused, the note not typed (NOTE_NOT_TYPED). */
class NoteNotTyped extends Error { constructor() { super('denied, but the note could not be typed'); } }

/**
 * Origins allowed to open a WebSocket: the Tauri overlay (packaged and dev server). A browser always
 * sends Origin, so any web page is refused; Node clients (hook, launcher, status) send none and pass.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
  'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:1420', 'http://127.0.0.1:1420',
  // Desktop's Vite dev server (spec 2026-10-14 §5.4)
  'http://localhost:1421', 'http://127.0.0.1:1421'
];

export function originAllowed(origin: string | undefined): boolean {
  return origin === undefined || ALLOWED_ORIGINS.includes(origin);
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
export async function startServer(opts: { store: Store; tmux: Tmux; port?: number; host?: string; now?: () => string; verify?: { attempts?: number; intervalMs?: number }; untilMs?: number; launcher?: string[]; home?: string; agentEnv?: () => Promise<NodeJS.ProcessEnv>; chat?: Chat; claudeBin?: string[]; daemon?: DaemonInfo; updater?: ReturnType<typeof createDaemonUpdater>; ssh?: typeof serveSsh; history?: History; machinesFile?: string; projectsFile?: string; scan?: typeof scanRepos }): Promise<ServerHandle> {
  const { store, tmux } = opts;
  const now = opts.now ?? (() => new Date().toISOString());
  const launcher = opts.launcher ?? [process.execPath, process.argv[1] ?? 'ledge'];
  // Under systemd the daemon has the bare system environment (no PATH to the agents, no proxy): a launched agent gets
  // the login shell's on top of it, as a terminal would.
  const agentEnv = opts.agentEnv ?? (async () => ({ ...process.env, ...(await loginShellEnv()) }));
  const chat = opts.chat ?? createChat({ store, tmux, home: paths().dir, userHome: opts.home, env: agentEnv, bin: opts.claudeBin, now, projects: () => projects });
  const router = createRouter({ env: agentEnv });
  const wss = new WebSocketServer({
    host: opts.host ?? '127.0.0.1', port: opts.port ?? PROTOCOL_PORT, maxPayload: MAX_FRAME,
    verifyClient: ({ req }: { req: IncomingMessage }) => {
      const path = req.url ?? '/';
      const ok = originAllowed(req.headers.origin) && (path === '/' || (path.startsWith('/ssh/') && SshAliasSchema.safeParse(path.slice(5)).success));
      if (!ok) log(`refused a connection from origin ${String(req.headers.origin)}`);
      return ok;
    }
  });
  await new Promise<void>((res, rej) => { wss.once('listening', res); wss.once('error', rej); });
  const port = (wss.address() as { port: number }).port;

  const machinesFile = opts.machinesFile ?? paths().machines;
  /** The machines list shared by every local front; copied so state never aliases DEFAULT_MACHINES. */
  let machines = readMachines(machinesFile).map(m => ({ ...m }));
  const machinesMsg = (): ServerMessage => ({ type: 'machines', machines });
  const projectsFile = opts.projectsFile ?? paths().projects;
  /** The projects and folder rules shared by every local front (build spec §5); never sent to a remote peer. */
  let projects = readProjects(projectsFile);
  const projectsMsg = (): ServerMessage => ({ type: 'projects', projects });
  const send = (ws: WebSocket, msg: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
  // Remote peers must never receive local snapshots, sessions, previews or chat broadcasts.
  const localClients = new Set<WebSocket>();
  const remoteClients = new Set<WebSocket>();
  const broadcast = (msg: ServerMessage) => { for (const c of localClients) send(c, msg); };
  const history = opts.history;
  const unsubscribeHistory = history ? [
    history.onItem((id, item) => broadcast({ type: 'session.thread.item', id, item })),
    store.onEvent((id, ev) => history.record(id, ev)),
    store.onChange(c => { if (c.type === 'removed') history.forget(c.id); })
  ] : [];
  const relay = createRelay({ chat, store, replyTo, broadcast, now });
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
  const sendSnapshot = (ws: WebSocket) => {
    send(ws, { type: 'snapshot', sessions: store.all(), recents: store.recents(), launcher, ...(opts.daemon ? { daemon: { ...opts.daemon, routing: true } } : {}) });
    send(ws, machinesMsg()); // spec §5.2: after each snapshot, the shared machines list
    send(ws, projectsMsg()); // then the shared projects (build spec §5)
    for (const [id, lines] of previews) if (store.get(id)) send(ws, { type: 'session.preview', id, lines });
    send(ws, { type: 'chat.history', turns: chat.history() });
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

  async function runPlan(s: Session, plan: KeyPlan): Promise<void> {
    if (!s.tmuxSession) throw new Error('session has no terminal (started without ledge)');
    for (const step of plan) {
      if ('text' in step) await tmux.sendText(s.tmuxSession, step.text);
      else if ('waitMs' in step) await new Promise(r => setTimeout(r, step.waitMs));
      else if ('keys' in step) await tmux.sendKeys(s.tmuxSession, step.keys);
      else {
        const end = Date.now() + UNTIL_MS;
        for (;;) {
          const pane = await tmux.capture(s.tmuxSession, UNTIL_LINES);
          if (pane !== null && step.until(pane)) break;
          if (Date.now() >= end) throw step.denied ? new NoteNotTyped() : new Error(NOT_TAKEN);
          await new Promise(r => setTimeout(r, UNTIL_POLL_MS));
        }
      }
    }
  }

  const inFlight = new Set<string>();

  /**
   * With `requirePrompt`, fail closed: the prompt must be on screen before anything is typed, else a
   * stale pending (or a dialog the adapter cannot read) would get keys meant for something else and
   * the "prompt gone" check would then report success. A plan given as a function is built from that
   * same capture, so the keys match the dialog actually on screen. True once `Decided` is applied (with `decision`, so
   * the thread names it at once), false when a newer prompt arrived meanwhile and was left alone.
   */
  async function injectAndVerify(id: string, planFor: KeyPlan | ((pane: string) => KeyPlan), requirePrompt: boolean, decision?: Decision): Promise<boolean> {
    const s = store.get(id);
    if (!s) throw new Error(`unknown session ${id}`);
    if (inFlight.has(id)) throw new Error('a decision is already in progress');
    inFlight.add(id);
    try {
      const adapter = adapterFor(s.tool);
      const decided = s.pending;
      const stillTheSame = () => {
        const cur = store.get(id)?.pending;
        return cur === decided || (!!cur && !!decided && cur.kind === decided.kind && cur.text === decided.text);
      };
      let before: string | null = null;
      if (requirePrompt) {
        before = s.tmuxSession ? await tmux.capture(s.tmuxSession, DETECT_LINES) : null;
        if (before === null || !adapter.promptStillVisible(before.split('\n').slice(-5).join('\n'))) throw new Error(NO_PROMPT);
        // The request checked before the capture may have been replaced while it ran: no key for one the user did not see.
        if (!stillTheSame()) throw new Error(STALE);
      }
      const plan = typeof planFor === 'function' ? planFor(before ?? '') : planFor;
      // An adapter that can tell one prompt from the next reads more of the pane: a new prompt is not a failed answer.
      const promptGone = () => decided && adapter.promptGone
        ? verifyGone(() => tmux.capture(s.tmuxSession!, DETECT_LINES), p => !adapter.promptGone!(p, decided), opts.verify)
        : verifyGone(() => tmux.capture(s.tmuxSession!, 5), p => adapter.promptStillVisible(p), opts.verify);
      try { await runPlan(s, plan); }
      catch (e) {
        // The deny keys went and the input box never came back for the note: if the request is gone, the refusal
        // happened (the thread says so, unless a newer prompt came meanwhile: left alone) and only the note is missing;
        // if it stays, nothing was refused.
        if (e instanceof NoteNotTyped) {
          if (await promptGone()) {
            if (stillTheSame()) store.apply(id, { name: 'Decided', at: now(), source: 'daemon', ...(decision ? { decision } : {}) });
            throw e;
          }
          e = new Error(NOT_TAKEN);
        }
        store.apply(id, { name: 'InjectFailed', at: now(), source: 'daemon', text: (e as Error).message });
        throw e;
      }
      const gone = await promptGone();
      if (!stillTheSame()) return false; // a newer prompt arrived meanwhile: leave it alone
      if (gone) { store.apply(id, { name: 'Decided', at: now(), source: 'daemon', ...(decision ? { decision } : {}) }); return true; }
      // The client gets an `error` reply for that id (via the caller's catch), so a retry from `error` reads as failed.
      store.apply(id, { name: 'InjectFailed', at: now(), source: 'daemon', text: NOT_TAKEN });
      throw new Error(NOT_TAKEN);
    } finally { inFlight.delete(id); }
  }

  const READ_ONLY = 'session started without ledge, read only';
  const NO_PROMPT = 'no prompt visible in the terminal, open the tab';
  const NOT_TAKEN = 'the terminal did not take it';
  const FREE_TEXT = 'free-text answers are not supported yet, answer in the terminal';
  const NOT_OFFERED = 'this answer is not offered for this request, answer in the terminal';

  /** session.reply's checks and typing (shared with the chat's relay): null once typed, the refusal otherwise; rejects when the injection fails. */
  async function replyTo(id: string, text: string): Promise<string | null> {
    const s = store.get(id); if (!s) return 'unknown session';
    if (s.source === 'hook_only') return READ_ONLY;
    // A select dialog ignores typed text and Enter would pick option 1: those take decide only.
    if (s.pending && s.pending.kind !== 'question') return `a ${s.pending.kind} prompt takes accept or deny, not a reply`;
    if (text.trim() === '') return 'empty reply';
    // A question dialog is a select: typed text then Enter would silently pick the highlighted option, unless the
    // adapter knows the dialog's own free-text field.
    const pending = s.pending; const adapter = adapterFor(s.tool);
    if (pending?.kind === 'question' && !/^[1-9]$/.test(text.trim()) && !adapter.freeText) return FREE_TEXT;
    // With no pending (idle, your turn) the text goes to the input line: no prompt to check for.
    await injectAndVerify(id, pane => adapter.replyPlan(text, pending, pane || undefined), !!pending);
    return null;
  }

  /** The chat cards being launched: a second click, or another overlay, is refused until the first one has answered. */
  const chatLaunches = new Set<string>();
  /** Spawns the agent as `ledge <tool>` would and records it; throws the reason (bad folder, tmux). */
  async function launch(req: { tool: Tool; cwd: string; name?: string; prompt?: string; continue?: boolean; dirs?: string[] }): Promise<Session> {
    if (req.dirs?.length && !MULTI_DIR_ARGS[req.tool]) throw new Error(`launch: ${req.tool} takes one folder`);
    const cwd = await resolveFolder(req.cwd, opts.home);
    const dirs = req.dirs?.length ? await Promise.all(req.dirs.map(d => resolveFolder(d, opts.home))) : undefined;
    const live = store.all();
    const env = await agentEnv();
    const session = await spawnSession({ tool: req.tool, args: launchArgs({ ...req, dirs }), name: req.name, cwd, tmux, now, env, taken: { names: live.filter(s => s.state !== 'exited').map(s => s.name), ids: live.map(s => s.id) } });
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
  async function handle(ws: WebSocket, msg: ClientMessage): Promise<void> {
    /** A refusal names the request it answers, so a front can tell a refused reply from a refused decision. */
    const refuse = (message: string, id?: string) => send(ws, { type: 'error', ...(id !== undefined ? { id } : {}), message, request: msg.type });
    switch (msg.type) {
      case 'document.read': {
        const session = msg.sessionId ? store.get(msg.sessionId) : undefined;
        if (msg.sessionId && !session) return send(ws, { type: 'document.error', requestId: msg.requestId, path: msg.path, code: 'session_missing' });
        return send(ws, await readDocument(msg, { cwd: session?.cwd, home: opts.home ?? process.env.HOME ?? '' }));
      }
      case 'repos.inspect': return send(ws, { type: 'repos.info', requestId: msg.requestId, repos: await inspectRepos(msg.paths, { home: opts.home }) });
      // Lot 11: home, then the parents of the recent and live folders outside it. Answered even when it fails: an `error` for
      // repos.scan reads, to the fleet, as a daemon too old to know it. The remotes it carries are never logged.
      case 'repos.scan': {
        try { return send(ws, { type: 'repos.found', requestId: msg.requestId, ...await sharedScan() }); }
        catch (e) { log(`repos.scan failed: ${(e as Error).message}`); return send(ws, { type: 'repos.found', requestId: msg.requestId, repos: [], truncated: false, error: 'scan failed' }); }
      }
      case 'snapshot.request': return sendSnapshot(ws);
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
        if (msg.qid === undefined) return send(ws, { type: 'session.launched', id: (await launch(msg)).id });
        // A chat card (spec 2026-10-12 §4): the proposal's own fields, never the message's.
        const qid = msg.qid; const p = chat.proposal(qid);
        if (!p) return refuse('unknown proposal');
        if (p.launchedId || chatLaunches.has(qid)) return refuse('already launched');
        chatLaunches.add(qid);
        try {
          const session = await launch({ tool: p.tool, cwd: p.cwd, prompt: p.prompt });
          send(ws, { type: 'session.launched', id: session.id });
          chat.markLaunched(qid, session.id, broadcast);
        } catch (e) { chat.markFailed(qid, (e as Error).message, broadcast); throw e; }
        finally { chatLaunches.delete(qid); }
        return;
      }
      case 'folder.list': return send(ws, await listFolder(msg.path, opts.home, msg.requestId));
      case 'folder.create': {
        const listing = await createFolder(msg.parent, msg.name, opts.home);
        if (!listing.error) log(`created folder ${listing.path}`);
        return send(ws, listing);
      }
      case 'session.event': {
        const ev = msg.event;
        // The agent's text precedes the action it announces: sync the parent's transcript before the row lands.
        const ownTurn = !ev.helperId && (ev.name === 'PreToolUse' || ev.name === 'PermissionRequest' || ev.name === 'Stop');
        const helperEnd = ev.name === 'SubagentStop' && !!ev.helperId;
        if (history && ev.transcriptPath && (ownTurn || helperEnd)) {
          try { history.sync(msg.id, ev.transcriptPath, { helperId: helperEnd ? ev.helperId : undefined, force: ev.name === 'Stop' || helperEnd }); }
          catch (e) { log(`transcript not read for ${msg.id}: ${(e as Error).message}`); }
        }
        const before = store.get(msg.id);
        if (!before) {
          const taken = store.all().map(s => s.name);
          const cwd = msg.cwd ?? '';
          const base: Session = { id: msg.id, name: pickName(taken), tool: msg.agent ?? 'claude', cwd, project: basename(cwd) || 'unknown', title: 'untracked session', tmuxSession: null, state: 'working', helpers: [], startedAt: msg.event.at, lastActivityAt: msg.event.at, source: 'hook_only' };
          store.upsert(base);
          store.apply(msg.id, msg.event); // through apply, so the history sees the session's first event too
        } else store.apply(msg.id, msg.event);
        logDroppedRequest(msg.id, msg.event, before, store.get(msg.id));
        return;
      }
      case 'session.thread':
        return send(ws, { type: 'session.thread', id: msg.id, items: history?.items(msg.id) ?? [] });
      case 'session.rename': {
        if (!store.get(msg.id)) return refuse('unknown session', msg.id);
        store.apply(msg.id, { name: 'Renamed', at: now(), source: 'daemon', text: msg.topic });
        return;
      }
      case 'session.unregister':
        store.apply(msg.id, { name: 'SessionEnd', at: now(), source: 'hook', exitCode: msg.exitCode });
        return;
      case 'session.decide': {
        const s = store.get(msg.id); if (!s) return refuse('unknown session', msg.id);
        if (s.source === 'hook_only') return refuse(READ_ONLY, msg.id);
        // A decision is for the request the user saw: another one (or none) since is refused before any key.
        if (msg.expect && (s.pending?.kind !== msg.expect.kind || s.pending.text !== msg.expect.text)) return refuse(STALE, msg.id);
        if (!s.pending) return refuse('nothing to decide', msg.id);
        const pending = s.pending; const adapter = adapterFor(s.tool);
        // What the harness cannot do is refused before any key (a question never takes `always` or a note).
        if (msg.decision === 'always' && !offers(s.tool, pending.kind, 'always')) return refuse(NOT_OFFERED, msg.id);
        if (msg.note !== undefined && (msg.decision !== 'deny' || !offers(s.tool, pending.kind, 'note'))) return refuse(NOT_OFFERED, msg.id);
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
        if (s?.source === 'hook_only') return refuse(READ_ONLY, msg.id);
        if (!s?.tmuxSession) return;
        await tmux.sendKeys(s.tmuxSession, adapterFor(s.tool).interruptKeys());
        return;
      }
      case 'session.kill': {
        const s = store.get(msg.id); if (!s) return;
        if (s.source === 'hook_only') return refuse(READ_ONLY, msg.id);
        if (s.tmuxSession) await tmux.killSession(s.tmuxSession);
        store.apply(msg.id, { name: 'PaneGone', at: now(), source: 'daemon' });
        return;
      }
      case 'session.dismiss': {
        const s = store.get(msg.id); if (!s) return refuse('unknown session', msg.id);
        if (s.state !== 'exited' && s.source !== 'hook_only') return refuse('the session is still running, kill it first', msg.id);
        // Removal broadcasts session.removed, drops the remembered preview and is saved to the journal.
        // A dismissed hook_only session that is in fact still alive comes back on its next hook (the
        // hook-before-register path in session.event recreates it): acceptable, it is still running.
        store.remove(msg.id);
        return;
      }
      // A chat card's instruction: a refusal reaches the requester as an `error`, the card's state everyone through chat.history.
      case 'session.relay': return relay.request(msg.qid);
      case 'session.relay.cancel': return relay.cancel(msg.qid);
      // Broadcast: every overlay shows the same progress, and the one that asked may be the one that reconnects.
      // A busy refusal goes to the asker only: it must not fail the flow the other overlays follow.
      case 'update.daemon':
        if (!opts.updater) return send(ws, { type: 'update.failed', version: msg.version, reason: 'no-systemd' });
        return opts.updater.update(msg.version, broadcast, m => send(ws, m));
      case 'chat.ask': return chat.ask(msg.qid, msg.text, broadcast, msg.tool);
      case 'chat.route':
        try { send(ws, { type: 'chat.routed', qid: msg.qid, result: await router.route(msg) }); }
        catch (e) { send(ws, { type: 'chat.error', qid: msg.qid, message: (e as Error).message }); }
        return;
      case 'chat.cancel': router.cancel(msg.qid); return chat.cancel(msg.qid);
      case 'chat.reset': return chat.reset(broadcast);
      case 'session.focus':
        return; // handled by the overlay plan via wt.exe; the daemon only acknowledges
    }
  }

  wss.on('connection', (ws, req) => {
    ws.on('error', e => log(`socket error: ${e.message}`));
    if (req.url?.startsWith('/ssh/')) {
      if (remoteClients.size >= 20) { ws.close(1013, 'Too many remote connections'); return; }
      remoteClients.add(ws); ws.once('close', () => remoteClients.delete(ws));
      const parsed = SshAliasSchema.safeParse(req.url.slice(5));
      if (!parsed.success) { ws.close(1008, 'Invalid SSH alias'); remoteClients.delete(ws); return; }
      const alias = parsed.data;
      void agentEnv().then(env => { if (ws.readyState === WebSocket.OPEN) (opts.ssh ?? serveSsh)(ws, alias, { env }); })
        .catch(e => { send(ws, { type: 'error', message: (e as Error).message }); ws.close(1011); });
      return;
    }
    localClients.add(ws); ws.once('close', () => localClients.delete(ws));
    sendSnapshot(ws);
    ws.on('message', data => {
      let msg: ClientMessage;
      let raw: unknown;
      try { raw = JSON.parse(String(data)); msg = parseClientMessage(raw); }
      catch (e) {
        log(`invalid message: ${(e as Error).message}`);
        // The type and the id it carried, when it has them: a newer front's value this daemon does not know is refused by
        // name, for that very session, at once (not left to the front's own timeout).
        const { type, id } = (raw ?? {}) as { type?: unknown; id?: unknown };
        return send(ws, { type: 'error', message: 'invalid message', ...(typeof id === 'string' && id.length <= 200 ? { id } : {}), ...(typeof type === 'string' && type.length <= 64 ? { request: type } : {}) });
      }
      handle(ws, msg).catch(e => {
        if (msg.type === 'document.read') return send(ws, { type: 'document.error', requestId: msg.requestId, path: msg.path, code: 'read_failed' });
        log(`${msg.type} failed: ${(e as Error).message}`);
        send(ws, { type: 'error', id: 'id' in msg ? msg.id : undefined, message: (e as Error).message, request: msg.type, ...(e instanceof NoteNotTyped ? { code: NOTE_NOT_TYPED } : {}) });
      });
    });
  });

  return {
    port,
    broadcast,
    preview,
    close: () => new Promise(res => { unsubscribe(); for (const u of unsubscribeHistory) u(); relay.close(); for (const c of wss.clients) c.terminate(); wss.close(() => res()); })
  };
}
