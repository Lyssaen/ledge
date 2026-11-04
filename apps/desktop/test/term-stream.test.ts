import { describe, expect, it } from 'vitest';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import { agentRoute, createAgentStream, decodeChunk } from '../src/term/stream';
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
    handle.close();
    expect(sent.at(-1)).toEqual({ type: 'term.unwatch', id: 'local:a' });
    expect(decodeChunk(Buffer.from('ok').toString('base64'))).toEqual(new Uint8Array([0x6f, 0x6b]));
  });
});
