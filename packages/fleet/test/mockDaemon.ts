import { WebSocketServer, WebSocket } from 'ws';
import { parseClientMessage, type ClientMessage, type DaemonInfo, type Machines, type Recent, type ServerMessage, type Session } from '@ledge/protocol';

export async function createMockDaemon(opts: { port?: number } = {}) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: opts.port ?? 0 });
  await new Promise<void>(r => wss.once('listening', r));
  const port = (wss.address() as { port: number }).port;
  const sessions = new Map<string, Session>();
  const received: ClientMessage[] = [];
  /** What the snapshot carries beside the sessions (the launch form's inputs); set before a client connects. */
  const extras: { recents?: Recent[]; launcher?: string[]; daemon?: DaemonInfo } = {};
  const bc = (m: ServerMessage) => { for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(m)); };
  let machinesList: Machines | undefined;
  const snapshot = (): ServerMessage => ({ type: 'snapshot', sessions: [...sessions.values()], ...extras });
  /** The last client to send anything: a reply (`session.launched`, an `error` for a launch) goes to it alone. */
  let last: WebSocket | null = null;
  wss.on('connection', ws => {
    ws.send(JSON.stringify(snapshot()));
    if (machinesList) ws.send(JSON.stringify({ type: 'machines', machines: machinesList })); // like the daemon, right after the snapshot
    ws.on('message', d => { last = ws; try { const m = parseClientMessage(JSON.parse(String(d))); received.push(m); if (m.type === 'snapshot.request') ws.send(JSON.stringify(snapshot())); } catch { /* ignore */ } });
  });
  return {
    get clientCount() { return [...wss.clients].filter(c => c.readyState === WebSocket.OPEN).length; },
    port, url: `ws://127.0.0.1:${port}`, sessions, received, extras,
    upsert(s: Session) { sessions.set(s.id, s); bc({ type: 'session.updated', session: s }); },
    remove(id: string) { sessions.delete(id); bc({ type: 'session.removed', id }); },
    preview(id: string, lines: string[]) { bc({ type: 'session.preview', id, lines }); },
    /** The daemon's machines list (spec 2026-10-14 §5.2), pushed to every client. */
    machines(list: Machines) { machinesList = list; bc({ type: 'machines', machines: list }); },
    recents(recents: Recent[]) { extras.recents = recents; bc({ type: 'recents', recents }); },
    /** Answers the last requester's `session.launch`: the new session is broadcast, then `session.launched` is replied. */
    launched(s: Session) { sessions.set(s.id, s); bc({ type: 'session.updated', session: s }); last?.send(JSON.stringify({ type: 'session.launched', id: s.id })); },
    /** Any reply to the last requester alone, e.g. a `session.launched` for a session that is never listed. */
    reply(m: ServerMessage) { last?.send(JSON.stringify(m)); },
    /** A launch refused: an `error` with no id, to the last requester. */
    refuse(message: string) { last?.send(JSON.stringify({ type: 'error', message })); },
    /** Cuts every open socket, as a daemon restart does; the client reconnects and gets a fresh snapshot. */
    dropClients: async () => { for (const c of wss.clients) c.terminate(); },
    close: () => new Promise<void>(r => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); })
  };
}

export const T0 = '2026-10-09T18:00:00.000Z';
export function fakeSession(id: string, extra: Partial<Session> = {}): Session {
  return { id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra };
}
