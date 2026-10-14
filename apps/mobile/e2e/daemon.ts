import type { Page, WebSocketRoute } from '@playwright/test';
import type { Session } from '@ledge/protocol';

export const T0 = new Date(Date.now() - 5 * 60_000).toISOString();
export function session(id: string, extra: Partial<Session> = {}): Session {
  return { id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra };
}

/**
 * Simulates the ledge daemon inside the page: any WebSocket answers `auth.ok`, then a `snapshot` of `initial`.
 * Tests push further server messages with `send`/`upsert`/`remove`.
 */
export async function fakeDaemon(page: Page, initial: Session[] = [], extras: Record<string, unknown> = {}) {
  const sessions = new Map(initial.map(s => [s.id, s]));
  const received: unknown[] = [];
  let socket: WebSocketRoute | null = null;
  /** Scripted behaviour: called with every message the phone sends. */
  let handler: (m: Record<string, unknown>) => void = () => {};
  await page.routeWebSocket(/.*/, ws => {
    socket = ws;
    ws.send(JSON.stringify({ type: 'auth.ok', deviceId: 'dev-1', deviceName: 'iPhone', pcName: 'PC-Joffrey' }));
    ws.send(JSON.stringify({ type: 'snapshot', sessions: [...sessions.values()], ...extras }));
    ws.onMessage(m => {
      try { const msg = JSON.parse(String(m)) as Record<string, unknown>; received.push(msg); handler(msg); } catch { /* ignore */ }
    });
  });
  const send = (m: unknown) => socket?.send(JSON.stringify(m));
  return {
    received,
    send,
    /** Answer the phone's messages. */
    onMessage(fn: (m: Record<string, unknown>) => void) { handler = fn; },
    /** Cut the connection as a lost network would. */
    drop() { void socket?.close({ code: 1001 }); },
    upsert(s: Session) { sessions.set(s.id, s); send({ type: 'session.updated', session: s }); },
    remove(id: string) { sessions.delete(id); send({ type: 'session.removed', id }); }
  };
}
