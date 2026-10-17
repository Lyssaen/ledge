import type { Page, WebSocketRoute } from '@playwright/test';
import type { ClientMessage, DaemonInfo, Machines, Projects, Recent, Session, ThreadItem } from '@ledge/protocol';

/** How long a launched session stays `starting` in the fake daemon before it is `working`. */
export const LAUNCH_SETTLE_MS = 1500;
export const T0 = new Date(Date.now() - 5 * 60_000).toISOString();
/** A local daemon that can route the chat between machines (spec 2026-10-14 §5.3): the fleet coordinates through it. */
export const ROUTING: DaemonInfo = { version: '0.6.0', install: 'npm', systemd: true, routing: true };
export function session(id: string, extra: Partial<Session> = {}): Session {
  return { id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra };
}

/** Simulates the local ledge daemon inside the page: a snapshot, then the machines list, and a `push` for later updates.
 *  Like the daemon (spec §5.3) it keeps the machines list: `machines.set` replaces it and is broadcast back as `machines`,
 *  and every new connection (reload, reconnect) gets the current list. A `document.read` is answered from `extras.documents` by its path
 *  (`document.content`), or `document.error` `not_found`. A `repos.inspect` is answered from `extras.repoInfo` by path (default: the folder exists, on
 *  `main`). A `session.launch` is answered as the daemon does: a `starting` session (`launched-<n>`, the message's name, harness and folder) is listed,
 *  then `session.launched`, and LAUNCH_SETTLE_MS later it is `working`; `launches: 'manual'` leaves the answer to the test (`launched`, `refuse`).
 *  The route is anchored so it never catches `/ssh/<alias>` (see `fakeRemote`). Register before `page.goto`. */
export async function fakeDaemon(page: Page, initial: Session[], extras: { machines?: Machines; launcher?: string[]; recents?: Recent[]; daemon?: DaemonInfo; projects?: Projects; threads?: Record<string, ThreadItem[]>; documents?: Record<string, string>; repoInfo?: Record<string, { exists: boolean; branch: string | null }>; launches?: 'auto' | 'manual' } = {}) {
  const threads = new Map(Object.entries(extras.threads ?? {}).map(([id, items]) => [id, [...items]]));
  const sessions = new Map(initial.map(s => [s.id, s]));
  const received: ClientMessage[] = [];
  let machines: Machines = extras.machines ?? [{ id: 'local', label: 'Local' }];
  let projects: Projects | undefined = extras.projects;
  let socket: WebSocketRoute | null = null;
  let up = true;
  let launches = 0;
  await page.routeWebSocket(/127\.0\.0\.1:47831\/?$/, ws => {
    if (!up) { ws.close(); return; }
    socket = ws;
    ws.send(JSON.stringify({ type: 'snapshot', sessions: [...sessions.values()], ...(extras.launcher ? { launcher: extras.launcher } : {}), ...(extras.recents ? { recents: extras.recents } : {}), ...(extras.daemon ? { daemon: extras.daemon } : {}) }));
    ws.send(JSON.stringify({ type: 'machines', machines }));
    if (projects) ws.send(JSON.stringify({ type: 'projects', projects }));
    ws.onMessage(m => {
      let msg: ClientMessage;
      try { msg = JSON.parse(String(m)); } catch { return; }
      received.push(msg);
      if (msg.type === 'projects.set') { projects = msg.projects; ws.send(JSON.stringify({ type: 'projects', projects })); }
      if (msg.type === 'session.decide') { const s = sessions.get(msg.id); if (s) { const { pending: _p, ...rest } = s; const next = { ...rest, state: 'working' as const }; sessions.set(s.id, next); ws.send(JSON.stringify({ type: 'session.updated', session: next })); } }
      if (msg.type === 'session.thread') { const items = threads.get(msg.id); if (items) ws.send(JSON.stringify({ type: 'session.thread', id: msg.id, items })); }
      if (msg.type === 'document.read') {
        const text = extras.documents?.[msg.path];
        ws.send(JSON.stringify(text === undefined
          ? { type: 'document.error', requestId: msg.requestId, path: msg.path, code: 'not_found' }
          : { type: 'document.content', requestId: msg.requestId, path: msg.path, text, bytes: new TextEncoder().encode(text).length, modifiedAt: T0 }));
      }
      if (msg.type === 'machines.set') { machines = msg.machines; ws.send(JSON.stringify({ type: 'machines', machines })); }
      if (msg.type === 'repos.inspect') {
        ws.send(JSON.stringify({ type: 'repos.info', requestId: msg.requestId, repos: msg.paths.map(path => ({ path, ...(extras.repoInfo?.[path] ?? { exists: true, branch: 'main' }) })) }));
      }
      if (msg.type === 'session.launch' && extras.launches !== 'manual') {
        const id = `launched-${++launches}`;
        const project = msg.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || msg.cwd;
        const name = msg.name ?? `Agent ${launches}`;
        const s = session(id, { name, tool: msg.tool, cwd: msg.cwd, project, title: `${name} · ${project}`, state: 'starting', startedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() });
        sessions.set(id, s);
        ws.send(JSON.stringify({ type: 'session.updated', session: s }));
        ws.send(JSON.stringify({ type: 'session.launched', id }));
        setTimeout(() => {
          if (sessions.get(id)?.state !== 'starting') return;
          const next = { ...s, state: 'working' as const, lastActivityAt: new Date().toISOString() };
          sessions.set(id, next);
          try { socket?.send(JSON.stringify({ type: 'session.updated', session: next })); } catch { /* the page is gone */ }
        }, LAUNCH_SETTLE_MS);
      }
    });
  });
  const push = (m: unknown) => socket?.send(JSON.stringify(m));
  return {
    received,
    push,
    upsert(s: Session) { sessions.set(s.id, s); push({ type: 'session.updated', session: s }); },
    remove(id: string) { sessions.delete(id); push({ type: 'session.removed', id }); },
    /** Answers a `session.launch` as the daemon does: the session is broadcast first, then `session.launched` with its raw id. */
    launched(s: Session) { sessions.set(s.id, s); push({ type: 'session.updated', session: s }); push({ type: 'session.launched', id: s.id }); },
    /** Refuses a launch: an `error` with no id (spec §9.2). */
    refuse(message: string) { push({ type: 'error', message }); },
    /** Answers a `folder.list` / `folder.create`. */
    listing(path: string, parent: string | null, entries: string[], error?: string) { push({ type: 'folder.listing', path, parent, entries, ...(error ? { error } : {}) }); },
    /** Stores an item in the session's thread and broadcasts it as `session.thread.item`. */
    item(id: string, item: ThreadItem) { const items = threads.get(id) ?? []; const at = items.findIndex(i => i.id === item.id); if (at >= 0) items[at] = item; else items.push(item); threads.set(id, items); push({ type: 'session.thread.item', id, item }); },
    /** Pushes a session's terminal preview. */
    preview(id: string, lines: string[]) { push({ type: 'session.preview', id, lines }); },
    /** Drops the local daemon and refuses new connections, so the fleet's own reconnect cannot quietly bring it back (see `fakeRemote`). */
    close() { up = false; socket?.close(); socket = null; }
  };
}

/** A second machine reached through the daemon's `/ssh/<alias>` relay. `close()` drops it and refuses new connections until `reopen()`,
 *  after which the fleet's own retry gets through. */
export async function fakeRemote(page: Page, alias: string, initial: Session[], extras: { recents?: Recent[] } = {}) {
  let sessions = initial;
  let up = true;
  let socket: WebSocketRoute | null = null;
  const received: ClientMessage[] = [];
  await page.routeWebSocket(new RegExp(`127\\.0\\.0\\.1:47831/ssh/${alias}$`), ws => {
    if (!up) { ws.close(); return; }
    socket = ws;
    ws.send(JSON.stringify({ type: 'snapshot', sshAlias: alias, sessions, ...(extras.recents ? { recents: extras.recents } : {}) }));
    ws.onMessage(m => { try { received.push(JSON.parse(String(m))); } catch { /* ignore */ } });
  });
  const push = (m: unknown) => socket?.send(JSON.stringify(m));
  return {
    received,
    push,
    /** Answers a `session.launch` sent to this machine (raw id; the fleet qualifies it with the machine). */
    launched(s: Session) { sessions = [...sessions.filter(x => x.id !== s.id), s]; push({ type: 'session.updated', session: s }); push({ type: 'session.launched', id: s.id }); },
    close() { up = false; socket?.close(); socket = null; },
    reopen(next: Session[] = sessions) { sessions = next; up = true; }
  };
}

export const twoProjects: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
    { id: 'website', name: 'Website', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/website' }] }
  ],
  rules: []
};

/** Eight agents on two projects, three LEDGE-42, three WEB-18, two with a request waiting. */
export const eight = [
  session('otto', { name: 'Otto', project: 'ledge', cwd: '/w/ledge', state: 'waiting_permission', branch: 'release/LEDGE-42-v0.5.0' }),
  session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'working', branch: 'fix/LEDGE-42-ssh-reconnect' }),
  session('pim', { name: 'Pim', project: 'ledge', cwd: '/w/ledge', state: 'working', branch: 'feat/bot-motion' }),
  session('bix', { name: 'Bix', project: 'ledge', cwd: '/w/ledge', state: 'idle', topic: 'LEDGE-42 · Documenter le protocole', branch: 'docs/protocol' }),
  session('luna', { name: 'Luna', project: 'website', cwd: '/w/website', state: 'waiting_input', branch: 'feat/WEB-18-homepage' }),
  session('milo', { name: 'Milo', project: 'website', cwd: '/w/website', state: 'working', branch: 'fix/WEB-18-mobile-layout' }),
  session('echo', { name: 'Echo', project: 'ledge', cwd: '/w/ledge', state: 'working', branch: 'test/LEDGE-42-notifications' }),
  session('rio', { name: 'Rio', project: 'website', cwd: '/w/website', state: 'working', branch: 'feat/WEB-18-accessibility' })
];
