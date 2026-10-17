import { WebSocketServer, WebSocket } from 'ws';
import { parseClientMessage, type ClientMessage, type DaemonInfo, type FoundRepo, type Machines, type Projects, type Recent, type RepoInfo, type ServerMessage, type Session, type ThreadItem } from '@ledge/protocol';

export async function createMockDaemon(opts: { port?: number } = {}) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: opts.port ?? 0 });
  await new Promise<void>(r => wss.once('listening', r));
  const port = (wss.address() as { port: number }).port;
  const sessions = new Map<string, Session>();
  const received: ClientMessage[] = [];
  const threads = new Map<string, ThreadItem[]>();
  /** The documents `document.read` finds, by the path asked for: `document.content` when the path is there, `document.error` 'not_found' otherwise. */
  const documents = new Map<string, string>();
  /** What `repos.inspect` answers by path; a path not listed exists, on `main`. */
  const repoInfo = new Map<string, RepoInfo>();
  /** What `folder.list` answers by path: its subfolders and the repositories among them; an unknown path is `error: 'not found'`. */
  const folders = new Map<string, { entries: string[]; repos?: { name: string; branch: string }[] }>();
  /** What `repos.scan` answers (lot 11), complete (`truncated: false`); none by default. Mutated in place, never replaced. */
  const found: FoundRepo[] = [];
  /** `autoLaunch`: answer every `session.launch` with a `starting` session and `session.launched`. Off by default: the overlay's tests answer a launch themselves (`launched`, `refuse`).
   *  `home`: what `folder.list` resolves `~` to (no path, `~` or `~/…`), as the daemon expands it; `~` itself by default. */
  const options = { autoLaunch: false, home: '~' };
  let launchCount = 0;
  /** `holdLaunch`: the launches wait here until `releaseLaunch` answers them. `refuseLaunch`: the next launch's refusal. */
  let holding = false;
  const held: { ws: WebSocket; m: Extract<ClientMessage, { type: 'session.launch' }> }[] = [];
  let refusal: string | null = null;
  /** `holdProjects`: the `projects.set` received wait here (in `received` too) until `releaseProjects` applies and broadcasts them. */
  let holdingProjects = false;
  const heldProjects: Projects[] = [];
  /** What `autoLaunch` does: a `starting` session, broadcast, then `session.launched` to the sender. */
  const answerLaunch = (ws: WebSocket, m: Extract<ClientMessage, { type: 'session.launch' }>) => {
    const id = `launch-${++launchCount}`;
    const s: Session = { id, name: m.name ?? `Agent${launchCount}`, tool: m.tool, cwd: m.cwd, project: m.cwd.split('/').filter(Boolean).at(-1) ?? m.cwd, title: m.name ?? `Agent${launchCount}`, tmuxSession: `ledge-${id}`, state: 'starting', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher' };
    sessions.set(id, s); bc({ type: 'session.updated', session: s });
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'session.launched', id }));
  };
  /** What the snapshot carries beside the sessions (the launch form's inputs); set before a client connects. */
  const extras: { recents?: Recent[]; launcher?: string[]; daemon?: DaemonInfo } = {};
  const bc = (m: ServerMessage) => { for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(m)); };
  let machinesList: Machines | undefined;
  let projectsState: Projects | undefined;
  const snapshot = (): ServerMessage => ({ type: 'snapshot', sessions: [...sessions.values()], ...extras });
  /** The last client to send anything: a reply (`session.launched`, an `error` for a launch) goes to it alone. */
  let last: WebSocket | null = null;
  wss.on('connection', ws => {
    ws.send(JSON.stringify(snapshot()));
    if (machinesList) ws.send(JSON.stringify({ type: 'machines', machines: machinesList })); // like the daemon, right after the snapshot
    if (projectsState) ws.send(JSON.stringify({ type: 'projects', projects: projectsState })); // then the projects
    ws.on('message', d => { last = ws; try { const m = parseClientMessage(JSON.parse(String(d))); received.push(m); if (m.type === 'snapshot.request') ws.send(JSON.stringify(snapshot())); if (m.type === 'session.thread') { const items = threads.get(m.id); if (items) ws.send(JSON.stringify({ type: 'session.thread', id: m.id, items })); } if (m.type === 'document.read') { const text = documents.get(m.path); ws.send(JSON.stringify(text === undefined ? { type: 'document.error', requestId: m.requestId, path: m.path, code: 'not_found' } : { type: 'document.content', requestId: m.requestId, path: m.path, text, bytes: Buffer.byteLength(text), modifiedAt: T0 })); } if (m.type === 'repos.inspect') ws.send(JSON.stringify({ type: 'repos.info', requestId: m.requestId, repos: m.paths.map(path => repoInfo.get(path) ?? { path, exists: true, branch: 'main' }) })); if (m.type === 'repos.scan') ws.send(JSON.stringify({ type: 'repos.found', requestId: m.requestId, repos: found, truncated: false })); if (m.type === 'folder.list') { const path = m.path ? m.path.replace(/^~(?=\/|$)/, options.home) : options.home; const f = folders.get(path); const tag = m.requestId === undefined ? {} : { requestId: m.requestId }; ws.send(JSON.stringify(f ? { type: 'folder.listing', ...tag, path, parent: path === '/' ? null : path.replace(/\/[^/]*$/, '') || '/', entries: f.entries, ...(f.repos ? { repos: f.repos } : {}) } : { type: 'folder.listing', ...tag, path, parent: null, entries: [], error: 'not found' })); } if (m.type === 'session.launch') { if (refusal !== null) { ws.send(JSON.stringify({ type: 'error', message: refusal, request: 'session.launch' })); refusal = null; } else if (holding) held.push({ ws, m }); else if (options.autoLaunch) answerLaunch(ws, m); } if (m.type === 'projects.set') { if (holdingProjects) heldProjects.push(m.projects); else { projectsState = m.projects; bc({ type: 'projects', projects: m.projects }); } } } catch { /* ignore */ } });
  });
  return {
    get clientCount() { return [...wss.clients].filter(c => c.readyState === WebSocket.OPEN).length; },
    port, url: `ws://127.0.0.1:${port}`, sessions, received, extras, threads, documents, repoInfo, folders, found, options,
    upsert(s: Session) { sessions.set(s.id, s); bc({ type: 'session.updated', session: s }); },
    remove(id: string) { sessions.delete(id); bc({ type: 'session.removed', id }); },
    preview(id: string, lines: string[]) { bc({ type: 'session.preview', id, lines }); },
    /** The thread `session.thread` returns for `id` (raw); an id without one gets no reply, so the page stays loading. */
    thread(id: string, items: ThreadItem[]) { threads.set(id, items); },
    /** A live item: stored and broadcast as `session.thread.item`; a re-sent id (a tool's result) replaces its row in place, as the daemon's store does. */
    threadItem(id: string, item: ThreadItem) {
      const cur = threads.get(id) ?? [];
      const at = cur.findIndex(i => i.id === item.id);
      threads.set(id, at >= 0 ? cur.map((i, k) => (k === at ? item : i)) : [...cur, item]);
      bc({ type: 'session.thread.item', id, item });
    },
    /** The daemon's machines list (spec 2026-10-14 §5.2), pushed to every client. */
    machines(list: Machines) { machinesList = list; bc({ type: 'machines', machines: list }); },
    /** The local daemon's projects (build spec §5), pushed to every client; a client's projects.set is stored and broadcast back. */
    projects(state: Projects) { projectsState = state; bc({ type: 'projects', projects: state }); },
    recents(recents: Recent[]) { extras.recents = recents; bc({ type: 'recents', recents }); },
    /** Answers the last requester's `session.launch`: the new session is broadcast, then `session.launched` is replied. */
    launched(s: Session) { sessions.set(s.id, s); bc({ type: 'session.updated', session: s }); last?.send(JSON.stringify({ type: 'session.launched', id: s.id })); },
    /** Any reply to the last requester alone, e.g. a `session.launched` for a session that is never listed. */
    reply(m: ServerMessage) { last?.send(JSON.stringify(m)); },
    /** A launch refused: an `error` with no id, to the last requester. */
    refuse(message: string) { last?.send(JSON.stringify({ type: 'error', message })); },
    /** The next launches get no answer until `releaseLaunch` (whatever `autoLaunch` says). */
    holdLaunch() { holding = true; },
    /** Answers the held launches as `autoLaunch` does (a `starting` session, then `session.launched` to each sender); later ones are answered by `autoLaunch` again.
     *  With `count`, only the first `count` held launches are answered, in the order sent, and the next ones are still held. */
    releaseLaunch(count?: number) { if (count === undefined) holding = false; for (const { ws, m } of held.splice(0, count ?? held.length)) answerLaunch(ws, m); },
    /** The next launch is refused as the daemon does: an `error` without id, `request: 'session.launch'`, to its sender. */
    refuseLaunch(message: string) { refusal = message; },
    /** The next `projects.set` are received but neither applied nor broadcast (a daemon that never confirms) until `releaseProjects`. */
    holdProjects() { holdingProjects = true; },
    /** Applies and broadcasts the held `projects.set`, in the order received; later ones are broadcast at once again. */
    releaseProjects() { holdingProjects = false; for (const p of heldProjects.splice(0)) { projectsState = p; bc({ type: 'projects', projects: p }); } },
    /** Any daemon message, to every client (the chat's steps, answers and history in Desktop's tests). */
    push(m: ServerMessage) { bc(m); },
    /** Cuts every open socket, as a daemon restart does; the client reconnects and gets a fresh snapshot. */
    dropClients: async () => { for (const c of wss.clients) c.terminate(); },
    close: () => new Promise<void>(r => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); })
  };
}

export const T0 = '2026-10-09T18:00:00.000Z';
export function fakeSession(id: string, extra: Partial<Session> = {}): Session {
  return { id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra };
}
