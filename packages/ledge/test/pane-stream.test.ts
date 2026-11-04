import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@ledge/protocol';
import { createPaneHost, modesOf, takeBytes, type PaneDeps } from '../src/term/pane.js';
import type { ControlProcess } from '../src/mobile/terminal.js';

describe('takeBytes', () => {
  it('keeps a short buffer and does not split a UTF-8 character', () => {
    expect(takeBytes(Buffer.from('hi'))).toEqual(Buffer.from('hi'));
    const buf = Buffer.concat([Buffer.alloc(16_383, 0x61), Buffer.from('é')]);
    const head = takeBytes(buf);
    expect(head.length).toBe(16_383);
    expect(Buffer.concat([head, buf.subarray(head.length)]).equals(buf)).toBe(true);
  });
});

/** A control client that answers like tmux: the attach's reply, then one reply per command. */
function fakeSpawn() {
  const procs: Array<ControlProcess & { written: string[]; killed: boolean; emit(s: string): void }> = [];
  const spawn = vi.fn((_argv: string[]) => {
    let onData: (b: Buffer) => void = () => {};
    let onExit: () => void = () => {};
    let n = 0;
    const reply = (lines: string[]) => {
      n++;
      setTimeout(() => onData(Buffer.from(`%begin 1 ${n} 1\n${lines.map(l => `${l}\n`).join('')}%end 1 ${n} 1\n`)), 0);
    };
    const p = {
      written: [] as string[], killed: false,
      write(text: string) {
        const line = text.trim();
        p.written.push(line);
        if (line.startsWith('display-message')) reply(['%0 80 24 1 2 0010000010']);
        else if (line.startsWith('capture-pane')) reply(['hello', 'there']);
        else reply([]);
      },
      kill() { p.killed = true; onExit(); },
      emit(s: string) { onData(Buffer.from(s)); },
      onData(fn: (b: Buffer) => void) { onData = fn; },
      onExit(fn: () => void) { onExit = fn; }
    };
    setTimeout(() => onData(Buffer.from('%begin 1 0 0\n%end 1 0 0\n')), 0);
    procs.push(p);
    return p;
  });
  return { spawn, procs };
}

function host(over: Partial<PaneDeps> = {}) {
  const sent: ServerMessage[] = [];
  const reply = (m: ServerMessage) => { sent.push(m); };
  const tmux = fakeSpawn();
  const h = createPaneHost({ controlArgs: name => ['-L', 'x', '-C', 'attach-session', '-t', `=${name}`], spawn: tmux.spawn, log: () => {}, ...over });
  return { h, sent, reply, tmux };
}

describe('modesOf', () => {
  it('reads the flags in order, the widest mouse mode winning, and leaves an older answer without modes', () => {
    expect(modesOf('1100111100', false)).toEqual({ alt: true, cursor: true, appCursor: false, appKeypad: false, mouse: 'any', sgr: true, wrap: false, insert: false });
    expect(modesOf('0000100000', true)?.mouse).toBe('standard');
    expect(modesOf(undefined, true)).toBeUndefined();
  });
});

describe('pane host', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('resizes the window, then sends the captured screen and the pane bytes', async () => {
    vi.useFakeTimers();
    const { h, sent, reply, tmux } = host();
    h.watch(reply, { id: 'a', tmuxName: 'ledge-a' }, { cols: 100, rows: 30 });
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
    const proc = tmux.procs[0]!;
    expect(proc.written.filter(l => l.startsWith('set-option') || l.startsWith('resize-window'))).toEqual([
      "set-option -w -t '=ledge-a:' window-size manual",
      "resize-window -x 100 -y 30 -t '=ledge-a:'"
    ]);
    expect(sent[0]).toMatchObject({ type: 'term.opened', id: 'a', cols: 80, rows: 24, screen: 'hello\nthere', cursor: { x: 1, y: 2 },
      // The modes the agent set before the watch, and bracketed paste for the harness pane.
      modes: { alt: false, cursor: false, appCursor: true, appKeypad: false, mouse: 'none', sgr: false, wrap: true, insert: false, paste: true } });
    proc.emit('%output %0 hi\\015\\012\n');
    await vi.advanceTimersByTimeAsync(16);
    expect(sent.at(-1)).toEqual({ type: 'term.output', id: 'a', data: Buffer.from('hi\r\n').toString('base64') });
    h.input(reply, 'a', 'x');
    await vi.runOnlyPendingTimersAsync();
    expect(proc.written.at(-1)).toBe('send-keys -t %0 -H 78');
  });

  it('a read-only watch neither resizes nor types, and the last sizing watch gives the window back', async () => {
    vi.useFakeTimers();
    const { h, reply, tmux } = host();
    h.watch(reply, { id: 'a', tmuxName: 'ledge-a' }, null);
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
    const proc = tmux.procs[0]!;
    expect(proc.written.some(l => l.startsWith('resize-window') || l.includes('window-size'))).toBe(false);
    h.input(reply, 'a', 'x');
    expect(proc.written.some(l => l.startsWith('send-keys'))).toBe(false);
    h.unwatch(reply, 'a');
    expect(proc.written.some(l => l.includes('window-size latest'))).toBe(false);

    const again = host();
    again.h.watch(again.reply, { id: 'b', tmuxName: 'ledge-b' }, { cols: 80, rows: 24 });
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
    again.h.unwatch(again.reply, 'b');
    expect(again.tmux.procs[0]!.written.at(-1)).toContain('set-option -wu');
    expect(again.tmux.procs[0]!.killed).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(again.tmux.procs[0]!.killed).toBe(true);
  });

  it('refuses a name a command line could misread', () => {
    const { h, sent, reply, tmux } = host();
    h.watch(reply, { id: 'a', tmuxName: 'ledge a' }, { cols: 80, rows: 24 });
    expect(sent).toEqual([{ type: 'term.exit', id: 'a', why: 'failed' }]);
    expect(tmux.procs).toHaveLength(0);
  });

  it('keeps the agent watch beside a shell, and kills the shell session without the typing lock', async () => {
    vi.useFakeTimers();
    const killed: string[] = [];
    const typing = new Set<string>();
    const seen: string[] = [];
    const lock = {
      has: (id: string) => typing.has(id),
      add: (id: string) => { seen.push(id); return typing.add(id); },
      delete: (id: string) => typing.delete(id)
    } as unknown as Set<string>;
    const { h, sent, reply, tmux } = host({ typing: lock, killSession: n => { killed.push(n); } });
    h.watch(reply, { id: 'a', tmuxName: 'ledge-a' }, { cols: 80, rows: 24 });
    h.watch(reply, { id: 'a', tmuxName: 'sh-abc', shell: 's1', owned: true }, { cols: 40, rows: 12 });
    h.watch(reply, { id: 'b', tmuxName: 'sh-def', shell: 's1', owned: true }, { cols: 40, rows: 12 });
    for (let i = 0; i < 12; i++) await vi.runOnlyPendingTimersAsync();
    expect(tmux.procs.filter(p => !p.killed)).toHaveLength(3);
    const shell = sent.filter((m): m is Extract<ServerMessage, { type: 'term.opened' }> => m.type === 'term.opened' && m.shell === 's1');
    expect(shell.map(m => m.id)).toEqual(['a', 'b']);
    // A shell's own program sets bracketed paste at its prompt: the daemon does not force it.
    expect(shell[0]!.modes?.paste).toBeUndefined();
    h.input(reply, 'a', 'z', 's1');
    await vi.runOnlyPendingTimersAsync();
    expect(seen).toEqual([]);
    expect(tmux.procs[1]!.written.at(-1)).toBe('send-keys -t %0 -H 7a');
    h.unwatch(reply, 'a');
    expect(tmux.procs[0]!.written.at(-1)).toContain('set-option -wu');
    expect(tmux.procs[1]!.killed).toBe(false);
    h.unwatch(reply, 'a', 's1');
    expect(killed).toEqual(['sh-abc']);
    expect(tmux.procs[1]!.written.some(l => l.includes('window-size latest'))).toBe(false);
    expect(tmux.procs[1]!.killed).toBe(true);
    h.release(reply);
    expect(killed).toEqual(['sh-abc', 'sh-def']);
    expect(sent.filter(m => m.type === 'term.exit')).toEqual([{ type: 'term.exit', id: 'b', shell: 's1', why: 'gone' }]);
  });
});
