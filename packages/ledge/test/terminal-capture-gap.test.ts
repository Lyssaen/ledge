// #296: the output tmux emits right after the screen is captured must not be lost. tmux can send the capture's reply and the
// pane's next `%output` in one block of stdout; the host must keep that output and send it after `term.opened`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneServerMessage, ServerMessage } from '@ledge/protocol';
import { createPaneHost } from '../src/term/pane.js';
import { createTerminalHost, type ControlProcess } from '../src/mobile/terminal.js';

/** A control client like tmux, except that the capture's reply comes in one block with the pane's next output (`after`). */
function tmuxWithOutputAfterCapture(after: string, info: string, trailer = (a: string) => `%output %0 ${a}\n`) {
  const procs: Array<ControlProcess & { written: string[] }> = [];
  const spawn = vi.fn((_argv: string[]) => {
    let onData: (b: Buffer) => void = () => {};
    let n = 0;
    const reply = (lines: string[], trailer = '') => {
      n++;
      const block = `%begin 1 ${n} 1\n${lines.map(l => `${l}\n`).join('')}%end 1 ${n} 1\n${trailer}`;
      setTimeout(() => onData(Buffer.from(block)), 0);
    };
    const p = {
      written: [] as string[],
      write(text: string) {
        const line = text.trim();
        p.written.push(line);
        if (line.startsWith('capture-pane')) reply(['$ ls'], trailer(after));
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

describe('#296: output right after the capture', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('Desktop: the output that follows the capture in the same block comes after term.opened', async () => {
    vi.useFakeTimers();
    const tmux = tmuxWithOutputAfterCapture('AFTER\\015\\012', '%0 80 24 1 2 0010000010');
    const sent: ServerMessage[] = [];
    const h = createPaneHost({ controlArgs: () => ['-C', 'attach-session'], spawn: tmux.spawn, log: () => {} });
    h.watch(m => { sent.push(m as ServerMessage); }, { id: 'a', tmuxName: 'ledge-a' }, null);
    await settle();
    const types = sent.map(m => m.type);
    const opened = types.indexOf('term.opened');
    expect(opened).toBeGreaterThanOrEqual(0);
    const out = sent.flatMap(m => (m.type === 'term.output' ? [Buffer.from(m.data, 'base64').toString('utf8')] : []));
    expect(out.join('')).toBe('AFTER\r\n');
    expect(types.indexOf('term.output')).toBeGreaterThan(opened);
    h.stop();
  });

  it('Phone: the same, and the cursor is read with the capture, in one write', async () => {
    vi.useFakeTimers();
    const tmux = tmuxWithOutputAfterCapture('AFTER\\015\\012', '%0 200 50 3 4');
    const sent: PhoneServerMessage[] = [];
    const h = createTerminalHost({
      controlArgs: () => ['-C', 'attach-session'], spawn: tmux.spawn, log: () => {},
      send: (_d, m) => { sent.push(m); }, queued: () => false
    });
    h.open('dev1', '6f1c3a52-2f0b-4c1e-9d3a-0a1b2c3d4e5f', { id: 's1', tmuxName: 'ledge-s1' });
    await settle();
    const types = sent.map(m => m.type);
    const opened = types.indexOf('term.opened');
    expect(opened).toBeGreaterThanOrEqual(0);
    const out = sent.flatMap(m => (m.type === 'term.output' ? [m.data] : []));
    expect(out.join('')).toBe('AFTER\r\n');
    expect(types.indexOf('term.output')).toBeGreaterThan(opened);
    // The capture and the cursor go together, the capture first: the cursor is the captured screen's.
    const w = tmux.procs[0]!.written;
    expect(w.findIndex(l => l.startsWith('capture-pane'))).toBeLessThan(w.findIndex(l => l.startsWith('display-message')));
    h.stop();
  });

  // Review of 6210bc77: before display-message answers, the watched pane is not known; another pane of the window may write then.
  const otherPane = (a: string) => `%output %1 OTHER\n%output %0 ${a}\n%output %1 MORE\n`;

  it('Desktop: another pane\'s output in that block never reaches the watched pane', async () => {
    vi.useFakeTimers();
    const tmux = tmuxWithOutputAfterCapture('AFTER\\015\\012', '%0 80 24 1 2 0010000010', otherPane);
    const sent: ServerMessage[] = [];
    const h = createPaneHost({ controlArgs: () => ['-C', 'attach-session'], spawn: tmux.spawn, log: () => {} });
    h.watch(m => { sent.push(m as ServerMessage); }, { id: 'a', tmuxName: 'ledge-a' }, null);
    await settle();
    const out = sent.flatMap(m => (m.type === 'term.output' ? [Buffer.from(m.data, 'base64').toString('utf8')] : []));
    expect(out.join('')).toBe('AFTER\r\n');
    h.stop();
  });

  it('Phone: the same', async () => {
    vi.useFakeTimers();
    const tmux = tmuxWithOutputAfterCapture('AFTER\\015\\012', '%0 200 50 3 4', otherPane);
    const sent: PhoneServerMessage[] = [];
    const h = createTerminalHost({ controlArgs: () => ['-C', 'attach-session'], spawn: tmux.spawn, log: () => {}, send: (_d, m) => { sent.push(m); }, queued: () => false });
    h.open('dev1', '6f1c3a52-2f0b-4c1e-9d3a-0a1b2c3d4e5f', { id: 's1', tmuxName: 'ledge-s1' });
    await settle();
    expect(sent.flatMap(m => (m.type === 'term.output' ? [m.data] : [])).join('')).toBe('AFTER\r\n');
    h.stop();
  });
});
