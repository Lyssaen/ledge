import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhoneServerMessageSchema, TERM_OUTPUT_MAX, TERM_SCREEN_MAX, type PhoneServerMessage } from '@ledge/protocol';
import {
  BEHIND_MS, ControlParser, HOLD_IDLE_MS, HOLD_MAX_MS, TICK_MS, createTerminalHost, fitScreen, keyCommands, takeChunk, unescapeOutput,
  type ControlProcess, type TerminalDeps
} from '../src/mobile/terminal.js';
import { realTmux, run } from '../src/tmux.js';
import { ensureLedgeDir } from '../src/paths.js';
import { killTestServer } from './helpers.js';

const OP = '6f1c3a52-2f0b-4c1e-9d3a-0a1b2c3d4e5f';

describe('control mode parsing', () => {
  it('unescapes octal bytes and keeps raw UTF-8', () => {
    const raw = Buffer.concat([Buffer.from('a\\033[31mb\\134c\\015\\012'), Buffer.from('é')]);
    expect(unescapeOutput(raw).toString('utf8')).toBe('a\x1b[31mb\\c\r\né');
  });
  it('leaves a backslash that is not an escape as it is', () => {
    expect(unescapeOutput(Buffer.from('x\\9y\\01')).toString()).toBe('x\\9y\\01');
  });
  it('reads output, layout, replies and exit, across chunk boundaries', () => {
    const p = new ControlParser();
    const text = '%begin 1 2 0\n%end 1 2 0\n%output %0 hi\\015\\012\n%layout-change @0 ba7d,100x25,0,0,0 ba7d,100x25,0,0,0 *\n%begin 3 4 1\n%0 80 24 1 2\n%end 3 4 1\n%begin 5 6 1\nbad\n%error 5 6 1\n%exit\n';
    const cut = 37;
    const events = [...p.push(Buffer.from(text.slice(0, cut))), ...p.push(Buffer.from(text.slice(cut)))];
    expect(events).toEqual([
      { kind: 'reply', ok: true, lines: [] },
      { kind: 'output', pane: '%0', data: Buffer.from('hi\r\n') },
      { kind: 'layout', cols: 100, rows: 25 },
      { kind: 'reply', ok: true, lines: ['%0 80 24 1 2'] },
      { kind: 'reply', ok: false, lines: ['bad'] },
      { kind: 'exit' }
    ]);
  });
  it('does not end a reply on a pane line that starts with %end', () => {
    const p = new ControlParser();
    expect(p.push(Buffer.from('%begin 1 2 1\n%end of story\n%end 1 2 1\n'))).toEqual([{ kind: 'reply', ok: true, lines: ['%end of story'] }]);
  });
});

describe('helpers', () => {
  it('types bytes as hex, 512 to a command', () => {
    expect(keyCommands('%3', '\x1b[Aé')).toEqual(['send-keys -t %3 -H 1b 5b 41 c3 a9']);
    const cmds = keyCommands('%3', 'x'.repeat(1_100));
    expect(cmds).toHaveLength(3);
    expect(cmds[2]!.split(' ').length - 4).toBe(76);
  });
  it('cuts the screen from the top', () => {
    const line = 'y'.repeat(1_000);
    const s = fitScreen(Array.from({ length: 100 }, () => line));
    expect(s.length).toBeLessThanOrEqual(TERM_SCREEN_MAX);
    expect(s.split('\n')).toHaveLength(65);
  });
  it('never splits a surrogate pair', () => {
    const s = 'a'.repeat(TERM_OUTPUT_MAX - 1) + '😀' + 'b';
    expect(takeChunk(s)).toBe('a'.repeat(TERM_OUTPUT_MAX - 1));
    expect(takeChunk('short')).toBe('short');
  });
});

/** A control client that answers like tmux: the attach's reply, then `display-message`, `capture-pane` and `send-keys`. */
function fakeTmux(opts: { screen?: string[]; size?: string } = {}) {
  const procs: Array<ControlProcess & { written: string[]; emit(s: string | Buffer): void; killed: boolean; exit(): void }> = [];
  const spawn = vi.fn((argv: string[]) => {
    void argv;
    let onData: (b: Buffer) => void = () => {};
    let onExit: () => void = () => {};
    let n = 0;
    const reply = (lines: string[], ok = true) => {
      n++;
      setTimeout(() => onData(Buffer.from(`%begin 1 ${n} 1\n${lines.map(l => `${l}\n`).join('')}%${ok ? 'end' : 'error'} 1 ${n} 1\n`)), 0);
    };
    const p = {
      written: [] as string[], killed: false,
      write(text: string) {
        p.written.push(text.trimEnd());
        if (text.startsWith('display-message')) reply([`%0 ${opts.size ?? '200 50'} 3 4`]);
        else if (text.startsWith('capture-pane')) reply(opts.screen ?? ['$ ls', 'a b']);
        else reply([]);
      },
      kill() { p.killed = true; },
      onData(fn: (b: Buffer) => void) { onData = fn; setTimeout(() => fn(Buffer.from('%begin 0 0 0\n%end 0 0 0\n')), 0); },
      onExit(fn: () => void) { onExit = fn; },
      emit(s: string | Buffer) { onData(Buffer.isBuffer(s) ? s : Buffer.from(s)); },
      exit() { onExit(); }
    };
    procs.push(p);
    return p;
  });
  return { spawn, procs };
}

function host(over: Partial<TerminalDeps> = {}, tmux = fakeTmux()) {
  const sent: Array<{ deviceId: string; msg: PhoneServerMessage; key: string }> = [];
  const queued = new Set<string>();
  const holders: Array<[string, string | null]> = [];
  const h = createTerminalHost({
    controlArgs: name => ['-L', 'x', '-C', 'attach-session', '-t', `=${name}`, '-f', 'ignore-size,read-only'],
    spawn: tmux.spawn,
    send: (deviceId, msg, key) => { PhoneServerMessageSchema.parse(msg); sent.push({ deviceId, msg, key }); },
    queued: (deviceId, key) => queued.has(`${deviceId}|${key}`),
    onHolder: (s, d) => holders.push([s, d]),
    log: () => {},
    ...over
  });
  const of = <T extends PhoneServerMessage['type']>(type: T) => sent.filter(s => s.msg.type === type).map(s => s.msg as Extract<PhoneServerMessage, { type: T }>);
  return { h, sent, of, queued, holders, tmux };
}

describe('terminal host', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('opens on the first screen, then streams output in batches', async () => {
    vi.useFakeTimers();
    const { h, of, tmux } = host();
    const tid = h.open('d1', OP, { id: 's1', tmuxName: 'ledge-s1' });
    await vi.advanceTimersByTimeAsync(10);
    expect(tmux.spawn.mock.calls[0]![0]).toContain('ignore-size,read-only');
    expect(of('term.opened')).toEqual([{ type: 'term.opened', op: OP, tid, id: 's1', cols: 200, rows: 50, screen: '$ ls\na b', cursor: { x: 3, y: 4 }, seq: 0 }]);
    tmux.procs[0]!.emit('%output %0 one\n%output %0 two\\015\\012\n%output %1 other pane\n');
    expect(of('term.output')).toEqual([]);
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(of('term.output')).toEqual([{ type: 'term.output', tid, seq: 0, data: 'onetwo\r\n' }]);
    tmux.procs[0]!.emit('%output %0 three\n');
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(of('term.output').map(m => m.seq)).toEqual([0, 1]);
  });

  it('keeps a UTF-8 character split across two notifications whole', async () => {
    vi.useFakeTimers();
    const { h, of, tmux } = host();
    h.open('d1', OP, { id: 's1', tmuxName: 'ledge-s1' });
    await vi.advanceTimersByTimeAsync(10);
    const head = Buffer.from('%output %0 ');
    tmux.procs[0]!.emit(Buffer.concat([head, Buffer.from([0xc3, 0x0a])]));
    tmux.procs[0]!.emit(Buffer.concat([head, Buffer.from([0xa9, 0x0a])]));
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(of('term.output').map(m => m.data)).toEqual(['é']);
  });

  it('waits for the outbox, and sends a fresh screen once too far behind', async () => {
    vi.useFakeTimers();
    const { h, of, queued, tmux } = host();
    const tid = h.open('d1', OP, { id: 's1', tmuxName: 'ledge-s1' });
    await vi.advanceTimersByTimeAsync(10);
    queued.add(`d1|term:${tid}`);
    tmux.procs[0]!.emit('%output %0 waiting\n');
    await vi.advanceTimersByTimeAsync(TICK_MS * 3);
    expect(of('term.output')).toEqual([]);
    await vi.advanceTimersByTimeAsync(BEHIND_MS);
    expect(of('term.opened')).toHaveLength(2);
    expect(of('term.opened')[1]).not.toHaveProperty('op');
    expect(of('term.output')).toEqual([]);
  });

  it('follows the pane size and passes the exit on', async () => {
    vi.useFakeTimers();
    const { h, of, tmux } = host({ exitWhy: () => 'ended' });
    const tid = h.open('d1', OP, { id: 's1', tmuxName: 'ledge-s1' });
    await vi.advanceTimersByTimeAsync(10);
    tmux.procs[0]!.emit('%layout-change @0 ba7d,120x40,0,0,0 ba7d,120x40,0,0,0 *\n');
    expect(of('term.size')).toEqual([{ type: 'term.size', tid, cols: 120, rows: 40 }]);
    tmux.procs[0]!.emit('%exit\n');
    expect(of('term.exit')).toEqual([{ type: 'term.exit', tid, why: 'ended' }]);
    expect(tmux.procs[0]!.killed).toBe(true);
  });

  it('types only while held, in order, as hex, and drops a duplicate', async () => {
    vi.useFakeTimers();
    const { h, of, tmux, holders } = host();
    const tid = h.open('d1', OP, { id: 's1', tmuxName: 'ledge-s1' });
    await vi.advanceTimersByTimeAsync(10);
    const keys = () => tmux.procs[0]!.written.filter(w => w.startsWith('send-keys'));
    h.input('d1', tid, 0, 'ls');
    await vi.advanceTimersByTimeAsync(10);
    expect(keys()).toEqual([]);
    expect(h.hold('d1', tid)).toBeNull();
    expect(of('term.held')).toHaveLength(1);
    expect(holders).toEqual([['s1', 'd1']]);
    h.input('d1', tid, 0, 'ls');
    h.input('d1', tid, 0, 'ls');
    h.input('d1', tid, 1, '\r');
    await vi.advanceTimersByTimeAsync(10);
    expect(keys()).toEqual(['send-keys -t %0 -H 6c 73', 'send-keys -t %0 -H 0d']);
    h.release('d1', tid);
    expect(of('term.released')).toEqual([{ type: 'term.released', tid, why: 'asked' }]);
    expect(holders.at(-1)).toEqual(['s1', null]);
  });

  it('waits for a delivery typing into the same session', async () => {
    vi.useFakeTimers();
    const typing = new Set<string>(['s1']);
    const { h, tmux } = host({ typing });
    const tid = h.open('d1', OP, { id: 's1', tmuxName: 'ledge-s1' });
    await vi.advanceTimersByTimeAsync(10);
    h.hold('d1', tid);
    h.input('d1', tid, 0, 'x');
    await vi.advanceTimersByTimeAsync(200);
    expect(tmux.procs[0]!.written.some(w => w.startsWith('send-keys'))).toBe(false);
    typing.delete('s1');
    await vi.advanceTimersByTimeAsync(100);
    expect(tmux.procs[0]!.written.filter(w => w.startsWith('send-keys'))).toEqual(['send-keys -t %0 -H 78']);
    expect(typing.has('s1')).toBe(false);
  });

  it('ends a hold after 5 minutes without a key, and after 30 minutes in all', async () => {
    vi.useFakeTimers();
    const { h, of } = host();
    const tid = h.open('d1', OP, { id: 's1', tmuxName: 'ledge-s1' });
    await vi.advanceTimersByTimeAsync(10);
    h.hold('d1', tid);
    await vi.advanceTimersByTimeAsync(HOLD_IDLE_MS + TICK_MS);
    expect(of('term.released').map(m => m.why)).toEqual(['idle']);
    h.hold('d1', tid);
    for (let t = 0; t < HOLD_MAX_MS; t += 60_000) { h.input('d1', tid, t / 60_000 + 100, 'k'); await vi.advanceTimersByTimeAsync(60_000); }
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(of('term.released').map(m => m.why)).toEqual(['idle', 'expired']);
  });

  it('refuses a hold on a read-only page, a second holder, and another device\'s terminal', async () => {
    vi.useFakeTimers();
    const { h } = host();
    const a = h.open('d1', OP, { id: 's1', tmuxName: 'ledge-s1' });
    const b = h.open('d2', OP, { id: 's1', tmuxName: 'ledge-s1' });
    const c = h.open('d3', OP, { id: 's2', tmuxName: 'ledge-s2', readOnly: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(h.hold('d2', a)).toBe('unknown');
    expect(h.hold('d1', a)).toBeNull();
    expect(h.hold('d2', b)).toBe('conflict');
    expect(h.hold('d3', c)).toBe('read_only');
    expect(h.holder('s1')).toBe('d1');
  });

  it('ends the device\'s previous terminal when it opens another, and releases on background and from the PC', async () => {
    vi.useFakeTimers();
    const { h, of } = host();
    const a = h.open('d1', OP, { id: 's1', tmuxName: 'ledge-s1' });
    const b = h.open('d1', OP, { id: 's2', tmuxName: 'ledge-s2' });
    await vi.advanceTimersByTimeAsync(10);
    expect(of('term.exit')).toEqual([{ type: 'term.exit', tid: a, why: 'superseded' }]);
    h.hold('d1', b);
    h.deviceHidden('d1');
    h.hold('d1', b);
    h.releaseSession('s2');
    expect(of('term.released').map(m => m.why)).toEqual(['background', 'pc']);
    h.deviceGone('d1');
    expect(h.sessionOf('d1', b)).toBeUndefined();
    expect(of('term.exit')).toHaveLength(1);
  });

  it('refuses a session it cannot attach safely', () => {
    const { h } = host({ controlArgs: () => null });
    expect(() => h.open('d1', OP, { id: 's1', tmuxName: 'ledge-s1' })).toThrow();
    const { h: h2 } = host();
    expect(() => h2.open('d1', OP, { id: 's1', tmuxName: "x'; kill-server" })).toThrow();
  });
});

describe('terminal host on a real tmux', () => {
  const socket = `ledge-term-${process.pid}-${Date.now()}`;
  const tmux = realTmux(socket, { scope: async () => false });
  const name = 'ledge-term1';
  beforeAll(async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
    await ensureLedgeDir();
    await tmux.newSession({ name, cwd: '/tmp', env: {}, command: ['sh', '-c', 'printf "ready\\n"; exec cat'] });
    for (let i = 0; i < 50 && !(await tmux.capture(name, 5))?.includes('ready'); i++) await new Promise(r => setTimeout(r, 50));
  });
  afterAll(async () => { await killTestServer(socket); });

  it('streams the pane, types into it, and never resizes the window', async () => {
    const sent: PhoneServerMessage[] = [];
    const h = createTerminalHost({ controlArgs: n => tmux.controlArgs!(n), send: (_d, m) => sent.push(m), queued: () => false, log: () => {} });
    const tid = h.open('d1', OP, { id: 's1', tmuxName: name });
    const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise(r => setTimeout(r, 50)); };
    await until(() => sent.some(m => m.type === 'term.opened'));
    const opened = sent.find(m => m.type === 'term.opened') as Extract<PhoneServerMessage, { type: 'term.opened' }>;
    expect(opened.screen).toContain('ready');
    expect([opened.cols, opened.rows]).toEqual([200, 50]);
    expect(h.hold('d1', tid)).toBeNull();
    h.input('d1', tid, 0, 'pong é\r');
    await until(() => sent.some(m => m.type === 'term.output' && m.data.includes('pong é')));
    expect(sent.some(m => m.type === 'term.output' && m.data.includes('pong é'))).toBe(true);
    const size = await run(['-L', socket, 'display-message', '-p', '-t', `=${name}:`, '#{window_width}x#{window_height}']);
    expect(size.stdout.trim()).toBe('200x50');
    h.stop();
  });
});
