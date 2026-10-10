import { WebSocketServer, WebSocket } from 'ws';
import { parseClientMessage, type ClientMessage, type ServerMessage, type Session } from '@ledge/protocol';

export async function createMockDaemon(opts: { port?: number } = {}) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: opts.port ?? 0 });
  await new Promise<void>(r => wss.once('listening', r));
  const port = (wss.address() as { port: number }).port;
  const sessions = new Map<string, Session>();
  const received: ClientMessage[] = [];
  const bc = (m: ServerMessage) => { for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(m)); };
  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'snapshot', sessions: [...sessions.values()] }));
    ws.on('message', d => { try { const m = parseClientMessage(JSON.parse(String(d))); received.push(m); if (m.type === 'snapshot.request') ws.send(JSON.stringify({ type: 'snapshot', sessions: [...sessions.values()] })); } catch { /* ignore */ } });
  });
  return {
    get clientCount() { return [...wss.clients].filter(c => c.readyState === WebSocket.OPEN).length; },
    port, url: `ws://127.0.0.1:${port}`, sessions, received,
    upsert(s: Session) { sessions.set(s.id, s); bc({ type: 'session.updated', session: s }); },
    remove(id: string) { sessions.delete(id); bc({ type: 'session.removed', id }); },
    preview(id: string, lines: string[]) { bc({ type: 'session.preview', id, lines }); },
    close: () => new Promise<void>(r => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); })
  };
}

export const T0 = '2026-10-09T18:00:00.000Z';
export function fakeSession(id: string, extra: Partial<Session> = {}): Session {
  return { id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra };
}
