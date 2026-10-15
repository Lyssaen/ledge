import type { Page, WebSocketRoute } from '@playwright/test';
import type { ClientMessage, DaemonInfo, Machines, Recent, Session } from '@ledge/protocol';

export const T0 = new Date(Date.now() - 5 * 60_000).toISOString();
/** A local daemon that can route the chat between machines (spec 2026-10-14 §5.3): the fleet coordinates through it. */
export const ROUTING: DaemonInfo = { version: '0.6.0', install: 'npm', systemd: true, routing: true };
export function session(id: string, extra: Partial<Session> = {}): Session {
  return { id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra };
}

/** Simulates the local ledge daemon inside the page: a snapshot, then the machines list, and a `push` for later updates.
 *  The route is anchored so it never catches `/ssh/<alias>` (see `fakeRemote`). Register before `page.goto`. */
export async function fakeDaemon(page: Page, initial: Session[], extras: { machines?: Machines; launcher?: string[]; recents?: Recent[]; daemon?: DaemonInfo } = {}) {
  const sessions = new Map(initial.map(s => [s.id, s]));
  const received: ClientMessage[] = [];
  let socket: WebSocketRoute | null = null;
  let up = true;
  await page.routeWebSocket(/127\.0\.0\.1:47831\/?$/, ws => {
    if (!up) { ws.close(); return; }
    socket = ws;
    ws.send(JSON.stringify({ type: 'snapshot', sessions: [...sessions.values()], ...(extras.launcher ? { launcher: extras.launcher } : {}), ...(extras.recents ? { recents: extras.recents } : {}), ...(extras.daemon ? { daemon: extras.daemon } : {}) }));
    ws.send(JSON.stringify({ type: 'machines', machines: extras.machines ?? [{ id: 'local', label: 'Local' }] }));
    ws.onMessage(m => { try { received.push(JSON.parse(String(m))); } catch { /* ignore */ } });
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
