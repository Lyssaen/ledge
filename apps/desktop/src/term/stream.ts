// The agent screen's side of the daemon's control stream (spec 2026-11-04). One xterm, no pseudo-terminal.
import type { DaemonClient } from '@ledge/fleet';
import { PANE_INPUT_MAX, type DaemonInfo, type ServerMessage, type Session, type TermModes } from '@ledge/protocol';

/** Where the shown agent's screen attaches. `wait`: the machine has not answered yet, so neither path may start. */
export type AgentRoute = 'stream' | 'pty' | 'wait';

/** `ready` is the machine's snapshot having arrived. A seat (`@` in its tmux name) streams only from a daemon that says it can
 *  (`terminalStreamSeats`): an older one has no control client on the seat's server, so it stays on the pseudo-terminal. */
export function agentRoute(session: Pick<Session, 'tmuxSession'> | undefined, machine: { ready: boolean; daemon?: Pick<DaemonInfo, 'terminalStream' | 'terminalStreamSeats'> } | undefined): AgentRoute {
  if (!session || !machine?.ready) return 'wait';
  if (!session.tmuxSession) return 'pty';
  if (session.tmuxSession.includes('@') && !machine.daemon?.terminalStreamSeats) return 'pty';
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
/** A shell born beside the daemon. `shellId` is the wire tag (`s1`), never the tab id. */
export interface ShellStream { open(sessionId: string, shellId: string, size: { cols: number; rows: number }, on: StreamEvents): StreamHandle }

/**
 * What xterm answers on its own: tmux already answered the program, so a second answer would arrive as typed keys.
 * Cursor position, device attributes, mode reports (DECRQM), status strings (DECRQSS, XTVERSION) and colours (OSC).
 * A person's keys are never a DCS or an OSC.
 */
const REPORT = /^(?:\x1b\[\??\d+;\d+R|\x1b\[[?>=][\d;]*c|\x1b\[\??[\d;]+\$y|\x1bP[\s\S]*\x1b\\|\x1b\][\s\S]*(?:\x07|\x1b\\))$/;
export const isReport = (data: string): boolean => REPORT.test(data);

/** `data` in pieces the daemon takes (`PANE_INPUT_MAX`), never splitting a surrogate pair. A long paste is several. */
export function inputPieces(data: string, max = PANE_INPUT_MAX): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < data.length) {
    let end = Math.min(i + max, data.length);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) end--;
    out.push(data.slice(i, end));
    i = end;
  }
  return out;
}

type Paint = (screen: string, cursor: { x: number; y: number }, modes?: TermModes) => string;

export function decodeChunk(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function createAgentStream(client: Pick<DaemonClient, 'send' | 'onMessage'>, paint: Paint): AgentStream {
  return {
    open(sessionId, readOnly, size, on) {
      let alive = true;
      let cols = size.cols, rows = size.rows;
      const off = client.onMessage((m: ServerMessage) => {
        if (!alive || !('id' in m) || m.id !== sessionId) return;
        // A shell of the same session shares the socket: its bytes belong to that tab, never the harness pane.
        if ('shell' in m && m.shell) return;
        if (m.type === 'term.opened') on.screen(paint(m.screen, m.cursor, m.modes));
        else if (m.type === 'term.output') on.data(decodeChunk(m.data));
        else if (m.type === 'term.exit') { alive = false; off(); on.exit(); }
        else if (m.type === 'error' && m.request?.startsWith('term.')) { alive = false; off(); on.exit(); }
      });
      client.send({ type: 'term.watch', id: sessionId, cols, rows, ...(readOnly ? { readOnly: true as const } : {}) });
      return {
        write(data) { if (alive && !readOnly && data && !isReport(data)) for (const piece of inputPieces(data)) client.send({ type: 'term.input', id: sessionId, data: piece }); },
        resize(c, r) { cols = c; rows = r; if (alive && !readOnly) client.send({ type: 'term.resize', id: sessionId, cols: c, rows: r }); },
        close() { if (!alive) return; alive = false; off(); client.send({ type: 'term.unwatch', id: sessionId }); }
      };
    }
  };
}

export function createShellStream(client: Pick<DaemonClient, 'send' | 'onMessage'>, paint: Paint): ShellStream {
  return {
    open(sessionId, shellId, size, on) {
      let alive = true;
      const off = client.onMessage((m: ServerMessage) => {
        if (!alive || !('id' in m) || m.id !== sessionId) return;
        if (m.type === 'error') { if (m.request?.startsWith('term.')) { alive = false; off(); on.exit(); } return; }
        if (!('shell' in m) || m.shell !== shellId) return;
        if (m.type === 'term.opened') on.screen(paint(m.screen, m.cursor, m.modes));
        else if (m.type === 'term.output') on.data(decodeChunk(m.data));
        else if (m.type === 'term.exit') { alive = false; off(); on.exit(); }
      });
      client.send({ type: 'term.shell', id: sessionId, shell: shellId, cols: size.cols, rows: size.rows });
      return {
        write(data) { if (alive && data && !isReport(data)) for (const piece of inputPieces(data)) client.send({ type: 'term.input', id: sessionId, shell: shellId, data: piece }); },
        resize(c, r) { if (alive) client.send({ type: 'term.resize', id: sessionId, shell: shellId, cols: c, rows: r }); },
        close() { if (!alive) return; alive = false; off(); client.send({ type: 'term.unwatch', id: sessionId, shell: shellId }); }
      };
    }
  };
}
