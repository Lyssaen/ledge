import type { IncomingMessage } from 'node:http';
import { basename } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { PROTOCOL_PORT, REMOTE_CLOSE, parseClientMessage, type ClientMessage, type DaemonInfo, type ServerMessage, type Session, type SessionEvent, type Tool } from '@ledge/protocol';
import type { Store } from './store.js';
import type { Tmux } from '../tmux.js';
import { adapterFor, type KeyPlan } from '../adapters/index.js';
import { verifyGone } from '../adapters/verify.js';
import { reduce } from './state.js';
import { DETECT_LINES } from './poller.js';
import { pickName } from '../names.js';
import { spawnSession } from '../spawn.js';
import { createFolder, listFolder, resolveFolder } from './folders.js';
import { loginShellEnv } from '../shell-path.js';
import { log } from '../log.js';
import { createChat, type Chat } from '../chat/service.js';
import { paths } from '../paths.js';
import { readDocument } from './documents.js';
import type { createDaemonUpdater } from '../update/run-update.js';
import { createPeers, type Peer, type PeerContext, type PeerSocket } from './peers.js';
import { toRemote } from './remote/project.js';
import { remoteMayRun } from './remote/rights.js';
import type { MobileControl } from './devices.js';

/** How each agent resumes the folder's last conversation, all three verified (Cursor Agent: `--continue`). */
export const CONTINUE_ARGS: Record<Tool, string[]> = { claude: ['--continue'], codex: ['resume', '--last'], cursor: ['--continue'] };

/** The agent's arguments for a `session.launch`: the resume flag, then the first instruction as the positional prompt. */
export function launchArgs(msg: { tool: Tool; prompt?: string; continue?: boolean }): string[] {
  const prompt = msg.prompt?.trim();
  return [...(msg.continue ? CONTINUE_ARGS[msg.tool] : []), ...(prompt ? [prompt] : [])];
}

export { resolveFolder };

/**
 * Origins allowed to open a WebSocket: the Tauri overlay (packaged and dev server). A browser always
 * sends Origin, so any web page is refused; Node clients (hook, launcher, status) send none and pass.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
  'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:1420', 'http://127.0.0.1:1420'
];

export function originAllowed(origin: string | undefined): boolean {
  return origin === undefined || ALLOWED_ORIGINS.includes(origin);
}

/**
 * Headers a reverse proxy (`tailscale serve` and the like) adds. The local port is never published (decision D3): an upgrade
 * carrying one of them is refused. A refusal on top of the origin check, never a proof of identity.
 */
export const FORWARDED_HEADERS: readonly string[] = ['tailscale-user-login', 'x-forwarded-for', 'forwarded'];

export interface ServerHandle {
  port: number; close(): Promise<void>; broadcast(msg: ServerMessage): void;
  /** Remembers a session's terminal preview and broadcasts it; a client that connects later gets it after the snapshot. */
  preview(id: string, lines: string[]): void;
  /** Registers a socket accepted elsewhere (the remote entry) as a peer: sends it the projected snapshot and wires its messages. */
  attach(socket: PeerSocket, ctx: PeerContext): void;
  peers: ReturnType<typeof createPeers>;
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
export async function startServer(opts: { store: Store; tmux: Tmux; port?: number; host?: string; now?: () => string; verify?: { attempts?: number; intervalMs?: number }; untilMs?: number; launcher?: string[]; home?: string; agentEnv?: () => Promise<NodeJS.ProcessEnv>; chat?: Chat; claudeBin?: string[]; daemon?: DaemonInfo; updater?: ReturnType<typeof createDaemonUpdater>; mobile?: MobileControl }): Promise<ServerHandle> {
  const { store, tmux } = opts;
  const now = opts.now ?? (() => new Date().toISOString());
  const launcher = opts.launcher ?? [process.execPath, process.argv[1] ?? 'ledge'];
  // Under systemd the daemon has the bare system environment (no PATH to the agents, no proxy): a launched agent gets
  // the login shell's on top of it, as a terminal would.
  const agentEnv = opts.agentEnv ?? (async () => ({ ...process.env, ...(await loginShellEnv()) }));
  const chat = opts.chat ?? createChat({ store, tmux, home: paths().dir, env: agentEnv, bin: opts.claudeBin, now });
  const wss = new WebSocketServer({
    host: opts.host ?? '127.0.0.1', port: opts.port ?? PROTOCOL_PORT,
    verifyClient: ({ req }: { req: IncomingMessage }) => {
      const forwarded = FORWARDED_HEADERS.find(h => req.headers[h] !== undefined);
      if (forwarded) { log(`refused a forwarded connection (${forwarded}) on the local port`); return false; }
      const ok = originAllowed(req.headers.origin);
      if (!ok) log(`refused a connection from origin ${String(req.headers.origin)}`);
      return ok;
    }
  });
  await new Promise<void>((res, rej) => { wss.once('listening', res); wss.once('error', rej); });
  const port = (wss.address() as { port: number }).port;

  const peers = createPeers();
  const broadcast = (msg: ServerMessage) => peers.broadcast(msg);
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
  const devicesMessage = (m: MobileControl): ServerMessage => ({ type: 'devices', devices: m.devices.list(), ...m.state() });
  const sendSnapshot = (peer: Peer) => {
    peer.send({ type: 'snapshot', sessions: store.all(), recents: store.recents(), launcher, ...(opts.daemon ? { daemon: opts.daemon } : {}) });
    for (const [id, lines] of previews) if (store.get(id)) peer.send({ type: 'session.preview', id, lines });
    peer.send({ type: 'chat.history', turns: chat.history() });
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
          if (Date.now() >= end) throw new Error(NOT_TAKEN);
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
   * same capture, so the keys match the dialog actually on screen.
   */
  async function injectAndVerify(id: string, planFor: KeyPlan | ((pane: string) => KeyPlan), requirePrompt: boolean): Promise<void> {
    const s = store.get(id);
    if (!s) throw new Error(`unknown session ${id}`);
    if (inFlight.has(id)) throw new Error('a decision is already in progress');
    inFlight.add(id);
    try {
      const adapter = adapterFor(s.tool);
      let before: string | null = null;
      if (requirePrompt) {
        before = s.tmuxSession ? await tmux.capture(s.tmuxSession, DETECT_LINES) : null;
        if (before === null || !adapter.promptStillVisible(before.split('\n').slice(-5).join('\n'))) throw new Error(NO_PROMPT);
      }
      const plan = typeof planFor === 'function' ? planFor(before ?? '') : planFor;
      const decided = s.pending;
      const stillTheSame = () => {
        const cur = store.get(id)?.pending;
        return cur === decided || (!!cur && !!decided && cur.kind === decided.kind && cur.text === decided.text);
      };
      try { await runPlan(s, plan); }
      catch (e) {
        store.apply(id, { name: 'InjectFailed', at: now(), source: 'daemon', text: (e as Error).message });
        throw e;
      }
      // An adapter that can tell one prompt from the next reads more of the pane: a new prompt is not a failed answer.
      const gone = decided && adapter.promptGone
        ? await verifyGone(() => tmux.capture(s.tmuxSession!, DETECT_LINES), p => !adapter.promptGone!(p, decided), opts.verify)
        : await verifyGone(() => tmux.capture(s.tmuxSession!, 5), p => adapter.promptStillVisible(p), opts.verify);
      if (!stillTheSame()) return; // a newer prompt arrived meanwhile: leave it alone
      if (gone) { store.apply(id, { name: 'Decided', at: now(), source: 'daemon' }); return; }
      // The client gets an `error` reply for that id (via the caller's catch), so a retry from `error` reads as failed.
      store.apply(id, { name: 'InjectFailed', at: now(), source: 'daemon', text: NOT_TAKEN });
      throw new Error(NOT_TAKEN);
    } finally { inFlight.delete(id); }
  }

  const READ_ONLY = 'session started without ledge, read only';
  const NO_PROMPT = 'no prompt visible in the terminal, open the tab';
  const NOT_TAKEN = 'the terminal did not take it';
  const NO_MOBILE = 'mobile not available';
  const FREE_TEXT = 'free-text answers are not supported yet, answer in the terminal';

  async function handle(peer: Peer, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'document.read': {
        const session = msg.sessionId ? store.get(msg.sessionId) : undefined;
        if (msg.sessionId && !session) return peer.send({ type: 'document.error', requestId: msg.requestId, path: msg.path, code: 'session_missing' });
        return peer.send(await readDocument(msg, { cwd: session?.cwd, home: opts.home ?? process.env.HOME ?? '' }));
      }
      case 'snapshot.request': return sendSnapshot(peer);
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
        const cwd = await resolveFolder(msg.cwd, opts.home);
        const live = store.all();
        const env = await agentEnv();
        const session = await spawnSession({ tool: msg.tool, args: launchArgs(msg), name: msg.name, cwd, tmux, now, env, taken: { names: live.filter(s => s.state !== 'exited').map(s => s.name), ids: live.map(s => s.id) } });
        store.upsert(session);
        store.touchRecent(session.cwd, session.project, session.startedAt);
        log(`launched ${session.name} (${session.tool}) in ${session.cwd} as ${session.id}`);
        return peer.send({ type: 'session.launched', id: session.id });
      }
      case 'folder.list': return peer.send(await listFolder(msg.path, opts.home));
      case 'folder.create': {
        const listing = await createFolder(msg.parent, msg.name, opts.home);
        if (!listing.error) log(`created folder ${listing.path}`);
        return peer.send(listing);
      }
      case 'session.event': {
        const before = store.get(msg.id);
        if (!before) {
          const taken = store.all().map(s => s.name);
          const cwd = msg.cwd ?? '';
          const base: Session = { id: msg.id, name: pickName(taken), tool: msg.agent ?? 'claude', cwd, project: basename(cwd) || 'unknown', title: 'untracked session', tmuxSession: null, state: 'working', helpers: [], startedAt: msg.event.at, lastActivityAt: msg.event.at, source: 'hook_only' };
          store.upsert(reduce(base, msg.event));
        } else store.apply(msg.id, msg.event);
        logDroppedRequest(msg.id, msg.event, before, store.get(msg.id));
        return;
      }
      case 'session.rename': {
        if (!store.get(msg.id)) return peer.send({ type: 'error', id: msg.id, message: 'unknown session' });
        store.apply(msg.id, { name: 'Renamed', at: now(), source: 'daemon', text: msg.topic });
        return;
      }
      case 'session.unregister':
        store.apply(msg.id, { name: 'SessionEnd', at: now(), source: 'hook', exitCode: msg.exitCode });
        return;
      case 'session.decide': {
        const s = store.get(msg.id); if (!s) return peer.send({ type: 'error', id: msg.id, message: 'unknown session' });
        if (s.source === 'hook_only') return peer.send({ type: 'error', id: msg.id, message: READ_ONLY });
        if (!s.pending) return peer.send({ type: 'error', id: msg.id, message: 'nothing to decide' });
        const pending = s.pending; const adapter = adapterFor(s.tool);
        return injectAndVerify(msg.id, pane => adapter.keysFor(msg.decision, pending, pane), true);
      }
      case 'session.reply': {
        const s = store.get(msg.id); if (!s) return peer.send({ type: 'error', id: msg.id, message: 'unknown session' });
        if (s.source === 'hook_only') return peer.send({ type: 'error', id: msg.id, message: READ_ONLY });
        // A select dialog ignores typed text and Enter would pick option 1: those take decide only.
        if (s.pending && s.pending.kind !== 'question') return peer.send({ type: 'error', id: msg.id, message: `a ${s.pending.kind} prompt takes accept or deny, not a reply` });
        if (msg.text.trim() === '') return peer.send({ type: 'error', id: msg.id, message: 'empty reply' });
        // The 2.x question dialog is a select: typed text then Enter would silently pick the highlighted option.
        if (s.pending?.kind === 'question' && !/^[1-9]$/.test(msg.text.trim())) return peer.send({ type: 'error', id: msg.id, message: FREE_TEXT });
        // With no pending (idle, your turn) the text goes to the input line: no prompt to check for.
        const pending = s.pending; const adapter = adapterFor(s.tool);
        return injectAndVerify(msg.id, pane => adapter.replyPlan(msg.text, pending, pane || undefined), !!pending);
      }
      case 'session.interrupt': {
        const s = store.get(msg.id);
        if (s?.source === 'hook_only') return peer.send({ type: 'error', id: msg.id, message: READ_ONLY });
        if (!s?.tmuxSession) return;
        await tmux.sendKeys(s.tmuxSession, adapterFor(s.tool).interruptKeys());
        return;
      }
      case 'session.kill': {
        const s = store.get(msg.id); if (!s) return;
        if (s.source === 'hook_only') return peer.send({ type: 'error', id: msg.id, message: READ_ONLY });
        if (s.tmuxSession) await tmux.killSession(s.tmuxSession);
        store.apply(msg.id, { name: 'PaneGone', at: now(), source: 'daemon' });
        return;
      }
      case 'session.dismiss': {
        const s = store.get(msg.id); if (!s) return peer.send({ type: 'error', id: msg.id, message: 'unknown session' });
        if (s.state !== 'exited' && s.source !== 'hook_only') return peer.send({ type: 'error', id: msg.id, message: 'the session is still running, kill it first' });
        // Removal broadcasts session.removed, drops the remembered preview and is saved to the journal.
        // A dismissed hook_only session that is in fact still alive comes back on its next hook (the
        // hook-before-register path in session.event recreates it): acceptable, it is still running.
        store.remove(msg.id);
        return;
      }
      // Broadcast: every overlay shows the same progress, and the one that asked may be the one that reconnects.
      // A busy refusal goes to the asker only: it must not fail the flow the other overlays follow.
      case 'update.daemon':
        if (!opts.updater) return peer.send({ type: 'update.failed', version: msg.version, reason: 'no-systemd' });
        return opts.updater.update(msg.version, broadcast, m => peer.send(m));
      case 'devices':
        return peer.send(opts.mobile ? devicesMessage(opts.mobile) : { type: 'error', message: NO_MOBILE });
      case 'device.revoke': {
        if (!opts.mobile) return peer.send({ type: 'error', message: NO_MOBILE });
        if (!(await opts.mobile.devices.revoke(msg.id))) return peer.send({ type: 'error', id: msg.id, message: 'unknown device' });
        const closed = peers.closeDevice(msg.id, REMOTE_CLOSE.revoked);
        log(`revoked device ${msg.id} (${closed} open connection${closed === 1 ? '' : 's'} closed)`);
        return broadcast(devicesMessage(opts.mobile));
      }
      case 'mobile.configure':
        if (!opts.mobile) return peer.send({ type: 'error', message: NO_MOBILE });
        await opts.mobile.configure(msg.origin);
        return broadcast(devicesMessage(opts.mobile));
      case 'chat.ask': return chat.ask(msg.qid, msg.text, broadcast, msg.tool);
      case 'chat.cancel': return chat.cancel(msg.qid);
      case 'chat.reset': return chat.reset(broadcast);
      case 'session.focus':
        return; // handled by the overlay plan via wt.exe; the daemon only acknowledges
    }
  }

  /** A local peer gets every message as before; a remote one only what `toRemote` lets through. */
  function peerFor(socket: PeerSocket, ctx: PeerContext): Peer {
    const write = (msg: ServerMessage) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); };
    return {
      ctx,
      send: ctx.kind === 'local' ? write : msg => { const m = toRemote(msg, { deviceId: ctx.deviceId }); if (m) write(m); },
      close: code => socket.close(code)
    };
  }

  function attach(socket: PeerSocket, ctx: PeerContext): void {
    const peer = peerFor(socket, ctx);
    const remove = peers.add(peer);
    socket.on('close', remove);
    socket.on('error', (e: Error) => log(`socket error: ${e.message}`));
    sendSnapshot(peer);
    socket.on('message', (data: unknown) => {
      let msg: ClientMessage;
      try { msg = parseClientMessage(JSON.parse(String(data))); }
      catch (e) { log(`invalid message: ${(e as Error).message}`); return peer.send({ type: 'error', message: 'invalid message' }); }
      if (ctx.kind === 'remote' && !remoteMayRun(msg)) {
        log(`remote ${ctx.deviceId} refused ${msg.type}`);
        return peer.send({ type: 'error', message: 'forbidden' });
      }
      handle(peer, msg).catch(e => {
        if (msg.type === 'document.read') return peer.send({ type: 'document.error', requestId: msg.requestId, path: msg.path, code: 'read_failed' });
        log(`${msg.type} failed: ${(e as Error).message}`);
        peer.send({ type: 'error', id: 'id' in msg ? msg.id : undefined, message: (e as Error).message });
      });
    });
  }

  wss.on('connection', ws => attach(ws, { kind: 'local' }));

  return {
    port,
    broadcast,
    preview,
    attach,
    peers,
    close: () => new Promise(res => { unsubscribe(); for (const c of wss.clients) c.terminate(); wss.close(() => res()); })
  };
}
