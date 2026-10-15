import type { IncomingMessage } from 'node:http';
import { basename } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { PROTOCOL_PORT, REMOTE_CLOSE, SshAliasSchema, parseClientMessage, type ClientMessage, type DaemonInfo, type ServerMessage, type Session, type SessionEvent, type Tool } from '@ledge/protocol';
import type { Store } from './store.js';
import type { History } from './history.js';
import type { Tmux } from '../tmux.js';
import { adapterFor, type KeyPlan } from '../adapters/index.js';
import { verifyGone } from '../adapters/verify.js';
import { DETECT_LINES } from './poller.js';
import { pickName } from '../names.js';
import { spawnSession } from '../spawn.js';
import { createFolder, listFolder, resolveFolder } from './folders.js';
import { loginShellEnv } from '../shell-path.js';
import { log } from '../log.js';
import { createChat, type Chat } from '../chat/service.js';
import { paths } from '../paths.js';
import { readDocument } from './documents.js';
import { createRelay } from './relay.js';
import type { createDaemonUpdater } from '../update/run-update.js';
import { createPeers, type Peer, type PeerContext, type PeerSocket } from './peers.js';
import { toRemote } from './remote/project.js';
import { MOBILE_COMMANDS } from './remote/rights.js';
import type { MobileControl } from './devices.js';
import { PairError } from './pairing.js';
import { OperationRegistry } from './operations.js';
import { ChallengeStore } from './challenges.js';
import { pushEndpointAllowed } from './push/vapid.js';
import { parseOrigin } from '../mobile/config.js';
import { BUSY, FREE_TEXT, NO_PROMPT, NOT_TAKEN, READ_ONLY, Refusal, operationStatus, prepareDecide, runAnswer, runDecide, runInterrupt, type DecisionDeps, type Thread } from './decisions.js';
import { phoneTurns, lastReplyAt, resolvedBy } from './turns.js';
import { createRouter } from '../chat/routing.js';
import { serveSsh } from '../transport/ssh.js';
import { MAX_FRAME } from '../transport/frames.js';

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
  /**
   * Registers a socket accepted elsewhere (the remote entry) as a peer: sends it the projected snapshot and wires its messages.
   * Such a socket stays owned by the listener that accepted it: `close()` ends the local sockets only.
   */
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
export async function startServer(opts: { store: Store; tmux: Tmux; port?: number; host?: string; now?: () => string; verify?: { attempts?: number; intervalMs?: number }; untilMs?: number; launcher?: string[]; home?: string; agentEnv?: () => Promise<NodeJS.ProcessEnv>; chat?: Chat; claudeBin?: string[]; daemon?: DaemonInfo; updater?: ReturnType<typeof createDaemonUpdater>; ssh?: typeof serveSsh; mobile?: MobileControl;
  /** Each session's thread (history.ts, `~/.ledge/history`): the overlay's thread and, mapped to turns, the phone's. */
  history?: History;
  /** What an authenticated phone may send; the plan's closed list unless a test widens it. */
  remoteCommands?: ReadonlySet<ClientMessage['type']> }): Promise<ServerHandle> {
  const { store, tmux } = opts;
  const history = opts.history;
  const now = opts.now ?? (() => new Date().toISOString());
  const launcher = opts.launcher ?? [process.execPath, process.argv[1] ?? 'ledge'];
  // Under systemd the daemon has the bare system environment (no PATH to the agents, no proxy): a launched agent gets
  // the login shell's on top of it, as a terminal would.
  const agentEnv = opts.agentEnv ?? (async () => ({ ...process.env, ...(await loginShellEnv()) }));
  const chat = opts.chat ?? createChat({ store, tmux, home: paths().dir, userHome: opts.home, env: agentEnv, bin: opts.claudeBin, now });
  const router = createRouter({ env: agentEnv });
  const wss = new WebSocketServer({
    host: opts.host ?? '127.0.0.1', port: opts.port ?? PROTOCOL_PORT, maxPayload: MAX_FRAME,
    verifyClient: ({ req }: { req: IncomingMessage }) => {
      const forwarded = FORWARDED_HEADERS.find(h => req.headers[h] !== undefined);
      if (forwarded) { log(`refused a forwarded connection (${forwarded}) on the local port`); return false; }
      const path = req.url ?? '/';
      const ok = originAllowed(req.headers.origin) && (path === '/' || (path.startsWith('/ssh/') && SshAliasSchema.safeParse(path.slice(5)).success));
      if (!ok) log(`refused a connection from origin ${String(req.headers.origin)}`);
      return ok;
    }
  });
  await new Promise<void>((res, rej) => { wss.once('listening', res); wss.once('error', rej); });
  const port = (wss.address() as { port: number }).port;

  const send = (ws: WebSocket, msg: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
  // Peers are the local overlays and the phones the remote entry attached (each through toRemote). The `/ssh/` bridges
  // below are neither: they never receive local snapshots, sessions, previews or chat broadcasts.
  const peers = createPeers();
  const broadcast = (msg: ServerMessage) => peers.broadcast(msg);
  const remoteClients = new Set<WebSocket>();
  /** The last preview per session, replayed after every snapshot so a late client does not wait for the agent to write. */
  const previews = new Map<string, string[]>();
  /** The title last pushed to each session's tmux tab, so tmux is told only when it changes. */
  const titles = new Map<string, string>();
  /** How long a phone's instruction waits for its prompt hook to come back with the same text. */
  const PHONE_PROMPT_MS = 30_000;
  /** Spaces as the adapters type them (newlines flattened) and as the hook reports them (trimmed). */
  const promptKey = (text: string) => text.replace(/\s+/g, ' ').trim();
  const phonePrompts = new Map<string, { text: string; ms: number }>();
  /** Sessions Ledge is typing an answer into (injectAndVerify's lock). */
  const inFlight = new Set<string>();
  /** The phone's instruction this prompt is, if any: same text within PHONE_PROMPT_MS of typing it. */
  const promptSource = (id: string, text: string | undefined): 'phone' | undefined => {
    const sent = phonePrompts.get(id);
    if (!sent) return undefined;
    if (Date.now() - sent.ms > PHONE_PROMPT_MS) { phonePrompts.delete(id); return undefined; }
    if (sent.text !== promptKey(text ?? '')) return undefined;
    phonePrompts.delete(id);
    return 'phone';
  };
  /** Decisions, answers and interruptions made through Ledge go to the shared thread with where they were made (decisions.ts). */
  const thread: Thread = {
    record: (id, note) => { history?.note(id, note, now()); },
    expectPrompt: (id, text) => { phonePrompts.set(id, { text: promptKey(text), ms: Date.now() }); },
    dropPrompt: id => { phonePrompts.delete(id); }
  };
  /**
   * The thread (history.ts) records every applied event, hooks, the poller and the daemon's own, before the change is
   * announced, so the unread a phone receives already counts a new reply. A prompt matching a phone's recent instruction
   * is the phone's; a request that left the terminal without Ledge deciding it is noted as resolved there. The phone-only
   * notes never reach the overlay: it neither shows nor needs them.
   */
  const unsubscribeHistory = history ? (() => {
    const offs = [
      history.onItem((id, item) => { if (item.kind !== 'note') broadcast({ type: 'session.thread.item', id, item }); }),
      // Before the reducer: `store.get` is still the session as the event found it.
      store.onEvent((id, ev) => {
        const source = ev.name === 'UserPromptSubmit' ? promptSource(id, ev.text) : undefined;
        history.record(id, ev, { ...(source ? { source } : {}), pending: store.get(id)?.pending ?? null });
      }),
      store.onApply((id, ev, before, after) => {
        // The row of a request the reducer took names it, so its decision or resolution finds exactly that row.
        if (ev.name === 'PermissionRequest' && ev.tool && ev.text && after.pending?.id && after.pending !== before.pending) history.tagPending(id, after.pending.id, ev.tool, ev.text);
        // While Ledge types an answer, a request that goes away is that answer taken (a fast tool's result can beat the check).
        if (inFlight.has(id)) return;
        const n = resolvedBy(ev, before, after); if (n) history.note(id, n, ev.at);
      }),
      store.onChange(c => { if (c.type === 'removed') history.forget(c.id); })
    ];
    return () => { for (const off of offs) off(); };
  })() : () => {};
  const unsubscribe = store.onChange(c => {
    if (c.type === 'recents') return broadcast({ type: 'recents', recents: c.recents });
    if (c.type === 'updated' && c.session.tmuxSession && titles.get(c.session.id) !== c.session.title) {
      titles.set(c.session.id, c.session.title);
      tmux.setOption(c.session.tmuxSession, '@ledge_title', c.session.title).catch(e => log(`tab title not set for ${c.session.id}: ${(e as Error).message}`));
    }
    if (c.type === 'removed') {
      previews.delete(c.id); titles.delete(c.id); phonePrompts.delete(c.id);
      opts.mobile?.devices.forgetRead(c.id).catch(e => log(`read marks of ${c.id} not removed: ${(e as Error).message}`));
    }
    broadcast(c.type === 'updated' ? { type: 'session.updated', session: c.session } : { type: 'session.removed', id: c.id });
  });
  const devicesMessage = (m: MobileControl): ServerMessage => ({ type: 'devices', devices: m.devices.list(), ...m.state() });
  // Every change to the device list (pairing, revocation) reaches the local peers once; remote peers drop `devices` in toRemote.
  const unsubscribeDevices = opts.mobile?.devices.onChange(() => broadcast(devicesMessage(opts.mobile!)));
  const sendSnapshot = (peer: Peer) => {
    peer.send({ type: 'snapshot', sessions: store.all(), recents: store.recents(), launcher, ...(opts.daemon ? { daemon: { ...opts.daemon, routing: true } } : {}) });
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
          if (Date.now() >= end) throw new Refusal('not_taken', NOT_TAKEN);
          await new Promise(r => setTimeout(r, UNTIL_POLL_MS));
        }
      }
    }
  }


  /**
   * With `requirePrompt`, fail closed: the prompt must be on screen before anything is typed, else a
   * stale pending (or a dialog the adapter cannot read) would get keys meant for something else and
   * the "prompt gone" check would then report success. A plan given as a function is built from that
   * same capture, so the keys match the dialog actually on screen. True once `Decided` is applied, false when a newer
   * prompt arrived meanwhile and was left alone.
   * With `expected`, the request decided must still be that id in that version, checked under the lock once the
   * capture is in, right before the plan is built and the first character typed.
   */
  async function injectAndVerify(id: string, planFor: KeyPlan | ((pane: string) => KeyPlan), requirePrompt: boolean, expected?: { id: string; version: number }): Promise<boolean> {
    const s = store.get(id);
    if (!s) throw new Refusal('stale', `unknown session ${id}`);
    if (inFlight.has(id)) throw new Refusal('busy', BUSY);
    inFlight.add(id);
    const checkExpected = () => {
      if (!expected) return;
      const cur = store.get(id)?.pending;
      if (!cur || cur.id !== expected.id) throw new Refusal('stale');
      if (cur.version !== expected.version) throw new Refusal('changed');
    };
    try {
      checkExpected();
      const adapter = adapterFor(s.tool);
      let before: string | null = null;
      if (requirePrompt) {
        before = s.tmuxSession ? await tmux.capture(s.tmuxSession, DETECT_LINES) : null;
        checkExpected();
        if (before === null || !adapter.promptStillVisible(before.split('\n').slice(-5).join('\n'))) throw new Refusal('no_prompt', NO_PROMPT);
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
      // The request left the session once the keys were out (its tool's hooks beat the pane check, or the next dialog is
      // already on screen): the answer was taken. The session already moved on from it, so it is left as the hooks put it.
      const answered = () => !!decided && !store.get(id)?.pending;
      if (answered()) return true;
      // An adapter that can tell one prompt from the next reads more of the pane: a new prompt is not a failed answer.
      const gone = decided && adapter.promptGone
        ? await verifyGone(() => tmux.capture(s.tmuxSession!, DETECT_LINES), p => !adapter.promptGone!(p, decided), opts.verify)
        : await verifyGone(() => tmux.capture(s.tmuxSession!, 5), p => adapter.promptStillVisible(p), opts.verify);
      if (answered()) return true;
      if (!stillTheSame()) return false; // a newer prompt arrived meanwhile: leave it alone
      if (gone) { store.apply(id, { name: 'Decided', at: now(), source: 'daemon' }); return true; }
      // The client gets an `error` reply for that id (or a phone `failed/not_taken`, decisions.ts), so a retry from `error` reads as failed.
      store.apply(id, { name: 'InjectFailed', at: now(), source: 'daemon', text: NOT_TAKEN });
      throw new Refusal('not_taken', NOT_TAKEN);
    } finally { inFlight.delete(id); }
  }

  const NO_MOBILE = 'mobile not available';

  /** Decisions and answers, from the overlay or a phone (decisions.ts): identity, idempotence, device check, then this lock. */
  const decisions: DecisionDeps = {
    store, ops: new OperationRegistry(), challenges: new ChallengeStore(), devices: opts.mobile?.devices,
    peersOf: deviceId => peers.all().filter(p => p.ctx.kind === 'remote' && p.ctx.deviceId === deviceId),
    config: () => { const origin = opts.mobile?.state().origin; return origin ? parseOrigin(origin) : null; },
    inject: injectAndVerify,
    interrupt: s => tmux.sendKeys(s.tmuxSession!, adapterFor(s.tool).interruptKeys()),
    thread
  };
  const remoteCommands = opts.remoteCommands ?? MOBILE_COMMANDS;

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
  const relay = createRelay({ chat, store, replyTo, broadcast, now });

  /** The chat cards being launched: a second click, or another overlay, is refused until the first one has answered. */
  const chatLaunches = new Set<string>();
  /** Spawns the agent as `ledge <tool>` would and records it; throws the reason (bad folder, tmux). */
  async function launch(req: { tool: Tool; cwd: string; name?: string; prompt?: string; continue?: boolean }): Promise<Session> {
    const cwd = await resolveFolder(req.cwd, opts.home);
    const live = store.all();
    const env = await agentEnv();
    const session = await spawnSession({ tool: req.tool, args: launchArgs(req), name: req.name, cwd, tmux, now, env, taken: { names: live.filter(s => s.state !== 'exited').map(s => s.name), ids: live.map(s => s.id) } });
    store.upsert(session);
    store.touchRecent(session.cwd, session.project, session.startedAt);
    log(`launched ${session.name} (${session.tool}) in ${session.cwd} as ${session.id}`);
    return session;
  }

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
        if (msg.qid === undefined) return peer.send({ type: 'session.launched', id: (await launch(msg)).id });
        // A chat card (spec 2026-10-12 §4): the proposal's own fields, never the message's.
        const qid = msg.qid; const p = chat.proposal(qid);
        if (!p) return peer.send({ type: 'error', message: 'unknown proposal' });
        if (p.launchedId || chatLaunches.has(qid)) return peer.send({ type: 'error', message: 'already launched' });
        chatLaunches.add(qid);
        try {
          const session = await launch({ tool: p.tool, cwd: p.cwd, prompt: p.prompt });
          peer.send({ type: 'session.launched', id: session.id });
          chat.markLaunched(qid, session.id, broadcast);
        } catch (e) { chat.markFailed(qid, (e as Error).message, broadcast); throw e; }
        finally { chatLaunches.delete(qid); }
        return;
      }
      case 'folder.list': return peer.send(await listFolder(msg.path, opts.home));
      case 'folder.create': {
        const listing = await createFolder(msg.parent, msg.name, opts.home);
        if (!listing.error) log(`created folder ${listing.path}`);
        return peer.send(listing);
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
        return peer.send({ type: 'session.thread', id: msg.id, items: (history?.items(msg.id) ?? []).filter(i => i.kind !== 'note') });
      case 'session.rename': {
        if (!store.get(msg.id)) return peer.send({ type: 'error', id: msg.id, message: 'unknown session' });
        store.apply(msg.id, { name: 'Renamed', at: now(), source: 'daemon', text: msg.topic });
        return;
      }
      case 'session.unregister':
        store.apply(msg.id, { name: 'SessionEnd', at: now(), source: 'hook', exitCode: msg.exitCode });
        return;
      case 'session.decide': return runDecide(peer, msg, decisions);
      case 'session.reply': return runAnswer(peer, msg, decisions);
      case 'decide.prepare': return prepareDecide(peer, msg, decisions);
      case 'operation.status': return operationStatus(peer, msg, decisions);
      case 'session.interrupt': return runInterrupt(peer, msg, decisions);
      case 'session.history': {
        if (!store.get(msg.id)) return peer.send({ type: 'error', id: msg.id, message: 'unknown session' });
        return peer.send({ type: 'session.turns', id: msg.id, turns: phoneTurns(history?.items(msg.id) ?? []) });
      }
      case 'session.read': {
        // Read marks are a phone's: the overlay has no unread.
        if (peer.ctx.kind !== 'remote') return;
        if (!store.get(msg.id)) return peer.send({ type: 'error', id: msg.id, message: 'unknown session' });
        // Never past the last turn: a reply still to come stays unread.
        // The latest time of any turn: a reply updated in place keeps its row but not its time.
        const times = phoneTurns(history?.items(msg.id) ?? []).map(t => Date.parse(t.at));
        if (times.length) {
          const latest = Math.max(...times);
          await opts.mobile?.devices.setRead(peer.ctx.deviceId, msg.id, new Date(Math.min(latest, Date.parse(msg.at))).toISOString());
        }
        const s = store.get(msg.id);
        return s ? peer.send({ type: 'session.updated', session: s }) : undefined;
      }
      case 'push.subscribe': {
        if (peer.ctx.kind !== 'remote') return peer.send({ type: 'error', message: 'push is for paired phones' });
        // The daemon posts to this endpoint: only the known push services are accepted.
        if (!pushEndpointAllowed(msg.subscription.endpoint)) return peer.send({ type: 'error', message: 'unsupported push service' });
        if (!opts.mobile) return peer.send({ type: 'error', message: NO_MOBILE });
        return opts.mobile.devices.setPush(peer.ctx.deviceId, msg.subscription);
      }
      case 'push.unsubscribe': {
        if (peer.ctx.kind !== 'remote') return peer.send({ type: 'error', message: 'push is for paired phones' });
        if (!opts.mobile) return peer.send({ type: 'error', message: NO_MOBILE });
        return opts.mobile.devices.setPush(peer.ctx.deviceId, null);
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
      // A chat card's instruction: a refusal reaches the requester as an `error`, the card's state everyone through chat.history.
      case 'session.relay': return relay.request(msg.qid);
      case 'session.relay.cancel': return relay.cancel(msg.qid);
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
        return;
      }
      // The code goes to the PC that asked, never to a broadcast (and `toRemote` drops it anyway).
      case 'pair.begin': {
        if (!opts.mobile) return peer.send({ type: 'pair.error', reason: 'not_configured' });
        let win;
        try { win = opts.mobile.pairing.begin(); }
        catch (e) { if (e instanceof PairError) return peer.send({ type: 'pair.error', reason: e.reason }); throw e; }
        log('pairing window opened');
        return peer.send({ type: 'pair.code', ...win });
      }
      case 'mobile.configure':
        if (!opts.mobile) return peer.send({ type: 'error', message: NO_MOBILE });
        await opts.mobile.configure(msg.origin);
        return broadcast(devicesMessage(opts.mobile));
      case 'chat.ask': return chat.ask(msg.qid, msg.text, broadcast, msg.tool);
      case 'chat.route':
        try { peer.send({ type: 'chat.routed', qid: msg.qid, result: await router.route(msg) }); }
        catch (e) { peer.send({ type: 'chat.error', qid: msg.qid, message: (e as Error).message }); }
        return;
      case 'chat.cancel': router.cancel(msg.qid); return chat.cancel(msg.qid);
      case 'chat.reset': return chat.reset(broadcast);
      case 'session.focus':
        return; // handled by the overlay plan via wt.exe; the daemon only acknowledges
    }
  }

  /** The thread holds a reply of the agent after the last turn this device read. */
  const unread = (deviceId: string, sessionId: string) => {
    const reply = history && lastReplyAt(history.items(sessionId));
    if (!reply) return false;
    const read = opts.mobile?.devices.get(deviceId)?.read?.[sessionId];
    return typeof read !== 'string' || Date.parse(reply) > Date.parse(read);
  };

  /** A local peer gets every message as before; a remote one only what `toRemote` lets through. */
  function peerFor(socket: PeerSocket, ctx: PeerContext): Peer {
    const write = (msg: ServerMessage) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); };
    return {
      ctx,
      send: ctx.kind === 'local' ? write : msg => { const m = toRemote(msg, { deviceId: ctx.deviceId, unread: sid => unread(ctx.deviceId, sid) }); if (m) write(m); },
      close: code => socket.close(code)
    };
  }

  function attach(socket: PeerSocket, ctx: PeerContext): void {
    // The remote entry attaches after authenticating: the phone may have gone in between, and a closed socket never emits 'close' again.
    if (socket.readyState !== WebSocket.OPEN) return;
    const peer = peerFor(socket, ctx);
    const remove = peers.add(peer);
    socket.on('close', remove);
    socket.on('error', (e: Error) => log(`socket error: ${e.message}`));
    sendSnapshot(peer);
    socket.on('message', (data: unknown) => {
      let msg: ClientMessage;
      try { msg = parseClientMessage(JSON.parse(String(data))); }
      catch (e) { log(`invalid message: ${(e as Error).message}`); return peer.send({ type: 'error', message: 'invalid message' }); }
      if (ctx.kind === 'remote' && !remoteCommands.has(msg.type)) {
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

  wss.on('connection', (ws, req) => {
    // A bridge to another machine over SSH (the overlay's fleet): bytes only, never a peer, never a broadcast.
    if (req.url?.startsWith('/ssh/')) {
      ws.on('error', e => log(`socket error: ${e.message}`));
      if (remoteClients.size >= 20) { ws.close(1013, 'Too many remote connections'); return; }
      remoteClients.add(ws); ws.once('close', () => remoteClients.delete(ws));
      const alias = SshAliasSchema.parse(req.url.slice(5));
      void agentEnv().then(env => { if (ws.readyState === WebSocket.OPEN) (opts.ssh ?? serveSsh)(ws, alias, { env }); })
        .catch(e => { send(ws, { type: 'error', message: (e as Error).message }); ws.close(1011); });
      return;
    }
    attach(ws, { kind: 'local' });
  });

  return {
    port,
    broadcast,
    preview,
    attach,
    peers,
    close: () => new Promise(res => { unsubscribe(); unsubscribeHistory(); unsubscribeDevices?.(); relay.close(); for (const c of wss.clients) c.terminate(); wss.close(() => res()); })
  };
}
