// #297: a Desktop screen whose pane writes faster than it can be sent asks tmux to pause it (`pause-after`, `%pause`) instead of
// reading and dropping its output; after a short while the pane continues and a fresh screen is taken, so nothing written during the
// pause is lost (it is in the screen) and nothing is sent twice (what came before the pause was dropped, what follows the capture is
// sent once).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@ledge/protocol';
import { createPaneHost } from '../src/term/pane.js';
import { ControlParser, type ControlProcess } from '../src/mobile/terminal.js';

describe('#297: the control parser', () => {
  it('reads %extended-output (pause-after set) as output, and %pause / %continue', () => {
    const p = new ControlParser();
    expect(p.push(Buffer.from('%extended-output %3 1234 : hi\\015\\012\n%extended-output %3 0 future : a : b\n%pause %3\n%continue %3\n'))).toEqual([
      { kind: 'output', pane: '%3', data: Buffer.from('hi\r\n') },
      // Only the first « : » ends the fields: the rest is the pane's.
      { kind: 'output', pane: '%3', data: Buffer.from('a : b') },
      { kind: 'pause', pane: '%3' },
      { kind: 'continue', pane: '%3' }
    ]);
  });
});

/** A tmux control client: each capture answers the current `screen`; `emit` sends what tmux would on its own. */
function fakeTmux() {
  const state = { screen: 'one', pane: '%0', pauseNext: false, procs: [] as Array<ControlProcess & { written: string[]; emit(s: string): void }> };
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
        if (line.startsWith('capture-pane')) { const trailer = state.pauseNext ? `%pause ${state.pane}\n` : ''; state.pauseNext = false; reply([state.screen], trailer); }
        else if (line.startsWith('display-message')) reply([`${state.pane} 80 24 0 0 0010000010`]);
        else reply([]);
      },
      kill() {},
      emit(text: string) { onData(Buffer.from(text)); },
      onData(fn: (b: Buffer) => void) { onData = fn; setTimeout(() => fn(Buffer.from('%begin 0 0 0\n%end 0 0 0\n')), 0); },
      onExit() {}
    };
    state.procs.push(p);
    return p;
  });
  return { spawn, state };
}

const settle = async (ms = 50) => { await vi.advanceTimersByTimeAsync(ms); };
const outputs = (sent: ServerMessage[]) => sent.flatMap(m => (m.type === 'term.output' ? [Buffer.from(m.data, 'base64').toString('utf8')] : []));
const screens = (sent: ServerMessage[]) => sent.flatMap(m => (m.type === 'term.opened' ? [m.screen] : []));

function open() {
  vi.useFakeTimers();
  const tmux = fakeTmux();
  const sent: ServerMessage[] = [];
  const h = createPaneHost({ controlArgs: () => ['-C', 'attach-session'], spawn: tmux.spawn, log: () => {} });
  h.watch(m => { sent.push(m as ServerMessage); }, { id: 'a', tmuxName: 'ledge-a' }, null);
  return { tmux, sent, h, proc: () => tmux.state.procs[0]! };
}

describe('#297: Desktop pauses a pane that falls behind', () => {
  afterEach(() => { vi.useRealTimers(); });

  // Review of fe6eb349: the pane switched since the last screen pauses while the new one is captured.
  it('resumes the new pane if it pauses while its new screen is captured', async () => {
    const { proc, h, tmux } = open();
    await settle();
    proc().emit(`%extended-output %0 0 : ${'x'.repeat(300_000)}\n`);
    await settle(16);
    tmux.state.pane = '%1';
    tmux.state.pauseNext = true;
    await settle(700);
    expect(proc().written).toContain("refresh-client -A '%1:continue'");
    h.stop();
  });
  // Review of fe6eb349: keys typed around a pause reach the pane (a pause holds output, not input).
  it('keeps keystrokes queued while a captured screen immediately pauses again', async () => {
    vi.useFakeTimers();
    const tmux = fakeTmux();
    const sent: ServerMessage[] = [];
    const h = createPaneHost({ controlArgs: () => ['-C', 'attach-session'], spawn: tmux.spawn, log: () => {} });
    const reply = (m: unknown) => { sent.push(m as ServerMessage); };
    h.watch(reply, { id: 'a', tmuxName: 'ledge-a', owned: true }, { cols: 80, rows: 24 });
    h.input(reply, 'a', 'hello');
    tmux.state.procs[0]!.emit('%pause %0\n');
    await settle(700);
    expect(tmux.state.procs[0]!.written.some(l => l.includes('send-keys'))).toBe(true);
    h.stop();
  });

  it('a key typed while the pane is paused reaches it at once, and nothing is typed twice', async () => {
    vi.useFakeTimers();
    const tmux = fakeTmux();
    const h = createPaneHost({ controlArgs: () => ['-C', 'attach-session'], spawn: tmux.spawn, log: () => {} });
    const reply = () => {};
    h.watch(reply, { id: 'a', tmuxName: 'ledge-a', owned: true }, { cols: 80, rows: 24 });
    await settle();
    tmux.state.procs[0]!.emit('%pause %0\n');
    await settle(20);
    h.input(reply, 'a', 'x');
    await settle(50); // the resume is 200 ms away
    const keys = () => tmux.state.procs[0]!.written.filter(l => l.includes('send-keys'));
    expect(keys()).toHaveLength(1);
    await settle(700);
    expect(keys()).toHaveLength(1);
    h.stop();
  });
  it('another pane paused before it is watched is resumed once a screen shows it is the one', async () => {
    const { proc, h, tmux } = open();
    await settle();
    proc().emit('%pause %1\n');
    // A resync (behind) whose screen is now of %1.
    tmux.state.pane = '%1';
    proc().emit(`%extended-output %0 0 : ${'x'.repeat(300_000)}\n`);
    await settle(700);
    expect(proc().written).toContain("refresh-client -A '%1:continue'");
    h.stop();
  });
  it('asks tmux to pause the pane once it is two seconds behind', async () => {
    const { proc, h } = open();
    await settle();
    expect(proc().written[0]).toBe('refresh-client -f pause-after=2');
    h.stop();
  });

  it('%pause: what waits is dropped, nothing flows, then the pane continues before a fresh screen, and what follows comes once', async () => {
    const { proc, sent, h, tmux } = open();
    await settle();
    expect(screens(sent)).toEqual(['one']);
    proc().emit('%extended-output %0 0 : before\n%pause %0\n');
    // Anything tmux still had in the pipe is not sent: the next screen has it.
    proc().emit('%extended-output %0 0 : late\n');
    await settle(20);
    expect(outputs(sent)).toEqual([]);
    tmux.state.screen = 'two';
    await settle(300);
    const w = proc().written;
    const cont = w.indexOf("refresh-client -A '%0:continue'");
    expect(cont).toBeGreaterThan(0);
    expect(w.findIndex((l, i) => i > cont && l.startsWith('capture-pane'))).toBeGreaterThan(cont);
    expect(screens(sent)).toEqual(['one', 'two']);
    proc().emit('%continue %0\n%extended-output %0 0 : after\n');
    await settle();
    expect(outputs(sent)).toEqual(['after']);
    h.stop();
  });

  it('behind on its own side: tmux is asked to pause the pane instead of Ledge reading and dropping, then a fresh screen', async () => {
    const { proc, sent, h, tmux } = open();
    await settle();
    // Output that waits more than two seconds (here: the frames are not taken because the timer does not run in between).
    const big = 'x'.repeat(300_000);
    proc().emit(`%extended-output %0 0 : ${big}\n`);
    await vi.advanceTimersByTimeAsync(0);
    await settle(16);
    expect(proc().written).toContain("refresh-client -A '%0:pause'");
    const before = outputs(sent).join('').length;
    expect(before).toBeLessThan(big.length);
    tmux.state.screen = 'fresh';
    await settle(300);
    expect(screens(sent)).toEqual(['one', 'fresh']);
    h.stop();
  });

  it('paused while its screen was taken: the pane is resumed through another screen once that one is sent', async () => {
    vi.useFakeTimers();
    const tmux = fakeTmux();
    const sent: ServerMessage[] = [];
    const h = createPaneHost({ controlArgs: () => ['-C', 'attach-session'], spawn: tmux.spawn, log: () => {} });
    h.watch(m => { sent.push(m as ServerMessage); }, { id: 'a', tmuxName: 'ledge-a' }, null);
    // Before any reply: the watch is capturing.
    tmux.state.procs[0]!.emit('%pause %0\n');
    await settle();
    tmux.state.screen = 'two';
    await settle(300);
    expect(screens(sent)).toEqual(['one', 'two']);
    expect(tmux.state.procs[0]!.written).toContain("refresh-client -A '%0:continue'");
    h.stop();
  });

  it('another pane of the window paused is not the watched one\'s', async () => {
    const { proc, sent, h } = open();
    await settle();
    proc().emit('%pause %7\n%extended-output %0 0 : still\n');
    await settle();
    expect(outputs(sent)).toEqual(['still']);
    expect(screens(sent)).toEqual(['one']);
    h.stop();
  });
});
