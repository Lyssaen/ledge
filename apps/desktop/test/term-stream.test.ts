import { describe, expect, it } from 'vitest';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import { agentRoute, createAgentStream, createShellStream, decodeChunk, inputPieces, isReport } from '../src/term/stream';
import { paintScreen } from '../src/term/paint';

describe('agentRoute', () => {
  const session = { tmuxSession: 'ledge-a' };
  it('waits until the machine has answered, then follows the flag', () => {
    expect(agentRoute(undefined, undefined)).toBe('wait');
    expect(agentRoute(session, { ready: false })).toBe('wait');
    expect(agentRoute(session, { ready: true })).toBe('pty');
    expect(agentRoute(session, { ready: true, daemon: { terminalStream: true } })).toBe('stream');
  });
  it('keeps a seat on the pseudo-terminal', () => {
    expect(agentRoute({ tmuxSession: 'pod@rig' }, { ready: true, daemon: { terminalStream: true } })).toBe('pty');
    expect(agentRoute({ tmuxSession: null }, { ready: true, daemon: { terminalStream: true } })).toBe('pty');
  });
});

describe('the stream client', () => {
  it('paints the first screen, writes bytes, and does not forward a cursor report', () => {
    const sent: ClientMessage[] = [];
    let deliver: (m: ServerMessage) => void = () => {};
    const client = {
      send: (m: ClientMessage) => { sent.push(m); },
      onMessage: (fn: (m: ServerMessage) => void) => { deliver = fn; return () => { deliver = () => {}; }; }
    };
    const screens: string[] = []; const bytes: Uint8Array[] = [];
    const handle = createAgentStream(client, paintScreen).open('local:a', false, { cols: 80, rows: 24 }, {
      screen: t => screens.push(t), data: b => bytes.push(b), exit: () => {}
    });
    expect(sent[0]).toMatchObject({ type: 'term.watch', id: 'local:a', cols: 80, rows: 24 });
    deliver({ type: 'term.opened', id: 'local:a', cols: 80, rows: 24, screen: 'hi', cursor: { x: 1, y: 0 } });
    expect(screens[0]).toBe(paintScreen('hi', { x: 1, y: 0 }));
    deliver({ type: 'term.output', id: 'local:a', data: Buffer.from('Z').toString('base64') });
    expect(bytes[0]).toEqual(new Uint8Array([0x5a]));
    deliver({ type: 'term.output', id: 'other', data: Buffer.from('no').toString('base64') });
    expect(bytes).toHaveLength(1);
    handle.write('\x1b[1;1R');
    handle.write('q');
    expect(sent.filter(m => m.type === 'term.input')).toEqual([{ type: 'term.input', id: 'local:a', data: 'q' }]);
    deliver({ type: 'term.output', id: 'local:a', shell: 's1', data: Buffer.from('no').toString('base64') });
    expect(bytes).toHaveLength(1);
    handle.close();
    expect(sent.at(-1)).toEqual({ type: 'term.unwatch', id: 'local:a' });
    expect(decodeChunk(Buffer.from('ok').toString('base64'))).toEqual(new Uint8Array([0x6f, 0x6b]));
  });

  it('opens a shell by its tag and never paints it on the agent', () => {
    const sent: ClientMessage[] = [];
    let deliver: (m: ServerMessage) => void = () => {};
    const client = {
      send: (m: ClientMessage) => { sent.push(m); },
      onMessage: (fn: (m: ServerMessage) => void) => { deliver = fn; return () => { deliver = () => {}; }; }
    };
    const bytes: Uint8Array[] = [];
    let ended = 0;
    const handle = createShellStream(client, paintScreen).open('local:a', 's1', { cols: 80, rows: 24 }, {
      screen: () => {}, data: b => bytes.push(b), exit: () => { ended += 1; }
    });
    expect(sent[0]).toEqual({ type: 'term.shell', id: 'local:a', shell: 's1', cols: 80, rows: 24 });
    deliver({ type: 'term.output', id: 'local:a', data: Buffer.from('A').toString('base64') });
    deliver({ type: 'term.output', id: 'local:a', shell: 's1', data: Buffer.from('B').toString('base64') });
    expect(bytes).toEqual([new Uint8Array([0x42])]);
    handle.write('\x1b[1;1R');
    handle.write('q');
    expect(sent.filter(m => m.type === 'term.input')).toEqual([{ type: 'term.input', id: 'local:a', shell: 's1', data: 'q' }]);
    handle.close();
    expect(sent.at(-1)).toEqual({ type: 'term.unwatch', id: 'local:a', shell: 's1' });
    expect(ended).toBe(0);
  });
});

describe('the stream input', () => {
  it('drops what xterm answers on its own and keeps the keys that look alike', () => {
    for (const r of ['\x1b[12;1R', '\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b[?2026;2$y', '\x1bP>|xterm.js(5.5.0)\x1b\\', '\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\', '\x1b]10;rgb:ffff/ffff/ffff\x07']) expect(isReport(r)).toBe(true);
    for (const k of ['a', '\r', '\x1b[A', '\x1bOA', '\x1b[200~x\x1b[201~', '\x1b']) expect(isReport(k)).toBe(false);
  });

  it('cuts a long paste into pieces the daemon takes, never inside a character', () => {
    const text = `${'a'.repeat(4095)}😀${'b'.repeat(10)}`;
    const pieces = inputPieces(text);
    expect(pieces.join('')).toBe(text);
    expect(pieces.every(p => p.length <= 4096)).toBe(true);
    expect(pieces[0]).toBe('a'.repeat(4095));
  });

  it('paints the modes the program set before the watch', () => {
    const out = paintScreen('x', { x: 0, y: 0 }, { alt: true, cursor: false, appCursor: true, appKeypad: false, mouse: 'button', sgr: true, wrap: true, insert: false, paste: true });
    expect(out.startsWith('\x1b[?1049h\x1b[H\x1b[2J')).toBe(true);
    for (const s of ['\x1b[?25l', '\x1b[?1h', '\x1b>', '\x1b[?2004h', '\x1b[?1002h', '\x1b[?1006h']) expect(out).toContain(s);
    expect(paintScreen('x', { x: 0, y: 0 })).toBe('\x1b[H\x1b[2Jx\x1b[1;1H');
  });
});
