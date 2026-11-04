// The agent screen's side of the daemon's control stream (spec 2026-11-04). One xterm, no pseudo-terminal.
import type { DaemonClient } from '@ledge/fleet';
import type { DaemonInfo, ServerMessage, Session } from '@ledge/protocol';

/** Where the shown agent's screen attaches. `wait`: the machine has not answered yet, so neither path may start. */
export type AgentRoute = 'stream' | 'pty' | 'wait';

/** `ready` is the machine's snapshot having arrived. A seat (`@` in its tmux name) has no control client. */
export function agentRoute(session: Pick<Session, 'tmuxSession'> | undefined, machine: { ready: boolean; daemon?: Pick<DaemonInfo, 'terminalStream'> } | undefined): AgentRoute {
  if (!session || !machine?.ready) return 'wait';
  if (!session.tmuxSession || session.tmuxSession.includes('@')) return 'pty';
  return machine.daemon?.terminalStream ? 'stream' : 'pty';
}

export interface StreamEvents {
  /** The first screen, already a sequence xterm can write. */
  screen(text: string): void;
  data(bytes: Uint8Array): void;
  exit(): void;
}
export interface StreamHandle { write(data: string): void; resize(cols: number, rows: number): void; close(): void }
export interface AgentStream { open(sessionId: string, readOnly: boolean, size: { cols: number; rows: number }, on: StreamEvents): StreamHandle }

/** What xterm answers on its own. ConPTY waited for it; the pane must never see it. */
const REPORT = /^\x1b\[(?:\d+;\d+R|[?>][\d;]*c)$/;

export function decodeChunk(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function createAgentStream(client: Pick<DaemonClient, 'send' | 'onMessage'>, paint: (screen: string, cursor: { x: number; y: number }) => string): AgentStream {
  return {
    open(sessionId, readOnly, size, on) {
      let alive = true;
      let cols = size.cols, rows = size.rows;
      const off = client.onMessage((m: ServerMessage) => {
        if (!alive || !('id' in m) || m.id !== sessionId) return;
        if (m.type === 'term.opened') on.screen(paint(m.screen, m.cursor));
        else if (m.type === 'term.output') on.data(decodeChunk(m.data));
        else if (m.type === 'term.exit') { alive = false; off(); on.exit(); }
        else if (m.type === 'error' && m.request?.startsWith('term.')) { alive = false; off(); on.exit(); }
      });
      client.send({ type: 'term.watch', id: sessionId, cols, rows, ...(readOnly ? { readOnly: true as const } : {}) });
      return {
        write(data) { if (alive && !readOnly && data && !REPORT.test(data)) client.send({ type: 'term.input', id: sessionId, data }); },
        resize(c, r) { cols = c; rows = r; if (alive && !readOnly) client.send({ type: 'term.resize', id: sessionId, cols: c, rows: r }); },
        close() { if (!alive) return; alive = false; off(); client.send({ type: 'term.unwatch', id: sessionId }); }
      };
    }
  };
}
