// #298: a terminal opens with the pane's history above the visible screen, outside the alternate screen, bounded; in the alternate
// screen (a full-screen program) only the visible lines, as before. Desktop and phone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TERM_PANE_SCREEN_MAX, TERM_SCREEN_MAX, type PhoneServerMessage, type ServerMessage } from '@ledge/protocol';
import { createPaneHost, PANE_HISTORY_LINES } from '../src/term/pane.js';
import { createTerminalHost, PHONE_HISTORY_LINES, type ControlProcess } from '../src/mobile/terminal.js';

/** tmux with a 4-row pane: `capture` answers its lines (history then visible), `info` its display-message line. */
function fakeTmux(capture: string[], info: string) {
  const procs: Array<ControlProcess & { written: string[] }> = [];
  const spawn = vi.fn((_argv: string[]) => {
    let onData: (b: Buffer) => void = () => {};
    let n = 0;
    const reply = (lines: string[]) => {
      n++;
      setTimeout(() => onData(Buffer.from(`%begin 1 ${n} 1\n${lines.map(l => `${l}\n`).join('')}%end 1 ${n} 1\n`)), 0);
    };
    const p = {
      written: [] as string[],
      write(text: string) {
        const line = text.trim();
        p.written.push(line);
        if (line.startsWith('capture-pane')) reply(capture);
        else if (line.startsWith('display-message')) reply([info]);
        else reply([]);
      },
      kill() {},
      onData(fn: (b: Buffer) => void) { onData = fn; setTimeout(() => fn(Buffer.from('%begin 0 0 0\n%end 0 0 0\n')), 0); },
      onExit() {}
    };
    procs.push(p);
    return p;
  });
  return { spawn, procs };
}

const settle = async () => { for (let i = 0; i < 20; i++) await vi.runOnlyPendingTimersAsync(); };
const HISTORY = ['h1', 'h2', 'h3'];
const VISIBLE = ['v1', 'v2', '$ ', ''];

async function desktop(capture: string[], alt: '0' | '1') {
  vi.useFakeTimers();
  const tmux = fakeTmux(capture, `%0 20 4 2 2 ${alt}010000010`);
  const sent: ServerMessage[] = [];
  const h = createPaneHost({ controlArgs: () => ['-C', 'attach-session'], spawn: tmux.spawn, log: () => {} });
  h.watch(m => { sent.push(m as ServerMessage); }, { id: 'a', tmuxName: 'ledge-a' }, null);
  await settle();
  h.stop();
  const opened = sent.find(m => m.type === 'term.opened');
  if (opened?.type !== 'term.opened') throw new Error('not opened');
  return { opened, written: tmux.procs[0]!.written };
}

async function phone(capture: string[], alt: '0' | '1') {
  vi.useFakeTimers();
  const tmux = fakeTmux(capture, `%0 20 4 2 2 ${alt}`);
  const sent: PhoneServerMessage[] = [];
  const h = createTerminalHost({ controlArgs: () => ['-C', 'attach-session'], spawn: tmux.spawn, log: () => {}, send: (_d, m) => { sent.push(m); }, queued: () => false });
  h.open('dev1', '6f1c3a52-2f0b-4c1e-9d3a-0a1b2c3d4e5f', { id: 's1', tmuxName: 'ledge-s1' });
  await settle();
  h.stop();
  const opened = sent.find(m => m.type === 'term.opened');
  if (opened?.type !== 'term.opened') throw new Error('not opened');
  return { opened, written: tmux.procs[0]!.written };
}

describe('#298: the history when a terminal opens', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('Desktop: outside the alternate screen, the history above the visible lines; the cursor stays the visible screen\'s', async () => {
    const { opened, written } = await desktop([...HISTORY, ...VISIBLE], '0');
    expect(written.find(l => l.startsWith('capture-pane'))).toContain(`-S -${PANE_HISTORY_LINES}`);
    expect(opened.screen).toBe([...HISTORY, ...VISIBLE].join('\n'));
    expect(opened.cursor).toEqual({ x: 2, y: 2 });
  });

  it('Desktop: in the alternate screen, only the visible lines', async () => {
    const { opened } = await desktop([...HISTORY, ...VISIBLE], '1');
    expect(opened.screen).toBe(VISIBLE.join('\n'));
  });

  it('Desktop: bounded, cut from the top, the visible lines kept', async () => {
    const long = Array.from({ length: PANE_HISTORY_LINES }, (_, i) => `${i}`.padEnd(60, '.'));
    const { opened } = await desktop([...long, ...VISIBLE], '0');
    expect(opened.screen.length).toBeLessThanOrEqual(TERM_PANE_SCREEN_MAX);
    expect(opened.screen.endsWith(VISIBLE.join('\n'))).toBe(true);
    expect(opened.screen.split('\n')[0]).toMatch(/^\d+\.+$/); // whole lines
  });

  it('phone: the same, with its smaller history', async () => {
    const { opened, written } = await phone([...HISTORY, ...VISIBLE], '0');
    expect(written.find(l => l.startsWith('capture-pane'))).toContain(`-S -${PHONE_HISTORY_LINES}`);
    expect(PHONE_HISTORY_LINES).toBeLessThan(PANE_HISTORY_LINES);
    expect(opened.screen).toBe([...HISTORY, ...VISIBLE].join('\n'));
    expect(opened.cursor).toEqual({ x: 2, y: 2 });
    expect((await phone([...HISTORY, ...VISIBLE], '1')).opened.screen).toBe(VISIBLE.join('\n'));
    const long = Array.from({ length: PHONE_HISTORY_LINES }, () => 'x'.repeat(400));
    const big = (await phone([...long, ...VISIBLE], '0')).opened.screen;
    expect(big.length).toBeLessThanOrEqual(TERM_SCREEN_MAX);
    expect(big.endsWith(VISIBLE.join('\n'))).toBe(true);
  });
});
