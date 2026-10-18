import type { Page, WebSocketRoute } from '@playwright/test';
import type { ClientMessage, DaemonInfo, IslandPrefs, Recent, Session } from '@ledge/protocol';

export const T0 = new Date(Date.now() - 5 * 60_000).toISOString();
export function session(id: string, extra: Partial<Session> = {}): Session {
  return { id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra };
}

/** Simulates the ledge daemon inside the page: answers the overlay's WebSocket with a snapshot and lets the test push updates. */
export async function fakeDaemon(page: Page, initial: Session[], { island: islandPrefs, ...extras }: { recents?: Recent[]; launcher?: string[]; daemon?: DaemonInfo; /** The island's settings it holds (null: none yet); absent, a daemon that never speaks of them. */ island?: IslandPrefs | null } = {}) {
  const sessions = new Map(initial.map(s => [s.id, s]));
  let island = islandPrefs;
  const received: ClientMessage[] = [];
  let socket: WebSocketRoute | null = null;
  await page.routeWebSocket(/127\.0\.0\.1:47831/, ws => {
    socket = ws;
    ws.send(JSON.stringify({ type: 'snapshot', sessions: [...sessions.values()], ...extras }));
    if (island !== undefined) ws.send(JSON.stringify({ type: 'island', prefs: island }));
    ws.onMessage(m => {
      let msg: ClientMessage; try { msg = JSON.parse(String(m)); } catch { return; }
      received.push(msg);
      // Like the daemon: keep the island's settings and broadcast them.
      if (msg.type === 'island.set') { island = msg.prefs; ws.send(JSON.stringify({ type: 'island', prefs: island })); }
    });
  });
  const send = (m: unknown) => socket?.send(JSON.stringify(m));
  return {
    received,
    /** Any server message, as is (update.progress, update.failed, …). */
    send,
    upsert(s: Session) { sessions.set(s.id, s); send({ type: 'session.updated', session: s }); },
    remove(id: string) { sessions.delete(id); send({ type: 'session.removed', id }); },
    preview(id: string, lines: string[]) { send({ type: 'session.preview', id, lines }); },
    error(id: string, message: string) { send({ type: 'error', id, message }); },
    /** Answers a `session.launch`: the new session, then the `session.launched` reply. */
    launched(s: Session) { sessions.set(s.id, s); send({ type: 'session.updated', session: s }); send({ type: 'session.launched', id: s.id }); },
    /** Answers a `folder.list` or `folder.create`. */
    listing(l: { path: string; parent: string | null; entries: string[]; error?: string }) { send({ type: 'folder.listing', ...l }); },
    /** A launch refused: an `error` with no id. */
    refuse(message: string) { send({ type: 'error', message }); },
    /** The island's settings changed in Desktop: kept and broadcast. */
    island(p: IslandPrefs) { island = p; send({ type: 'island', prefs: p }); },
    /** Any other server message (chat.done, chat.history, …). */
    emit(m: unknown) { send(m); }
  };
}
