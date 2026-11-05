import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerMessage } from '@ledge/protocol';
import { realTmux, routedTmux, run } from '../src/tmux.js';
import { createPaneHost } from '../src/term/pane.js';
import { ensureLedgeDir } from '../src/paths.js';
import { killTestServer, until } from './helpers.js';

// A real tmux on two servers, as on a machine with OpenRig: Ledge's socket for its own sessions, another for the seats (OpenRig's
// default server in production, a test socket here). The seat's screen, keys and size go through a control client on the seat's
// server; Ledge's server never sees the seat.
const own = `ledge-test-own-${process.pid}-${Date.now()}`;
const seats = `ledge-test-seats-${process.pid}-${Date.now()}`;
const seat = 'dev-build@starter';
const opt = { scope: async () => false };

beforeAll(async () => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); await ensureLedgeDir(); });
afterAll(async () => { await killTestServer(own); await killTestServer(seats); });

describe('an OpenRig seat streamed from its own tmux server', () => {
  it('opens on the seat\'s server, types there, sizes the window while watched and gives it back', async () => {
    const seatServer = realTmux(seats, opt);
    // The pane echoes what it reads, so a key typed through the stream shows on its screen.
    await seatServer.newSession({ name: seat, cwd: '/tmp', env: {}, command: ['sh', '-c', 'echo seat-ready; cat'] });
    await until(async () => (await seatServer.capture(seat, 5))?.includes('seat-ready') ?? false);
    const tmux = routedTmux(realTmux(own, opt), seatServer);
    // Ledge's own server has no such session: only the routing can find it.
    expect((await run(['-L', own, 'has-session', '-t', `=${seat}`])).code).not.toBe(0);

    const sent: ServerMessage[] = [];
    // One reply per socket: the host finds a watch by the reply that opened it.
    const reply = (m: ServerMessage) => { sent.push(m); };
    const host = createPaneHost({ controlArgs: n => tmux.controlArgs?.(n) ?? null, log: () => {} });
    host.watch(reply, { id: 'rig-dev-build-starter', tmuxName: seat }, { cols: 90, rows: 20 });
    await until(() => sent.some(m => m.type === 'term.opened'), 8000);
    const opened = sent.find(m => m.type === 'term.opened');
    expect(opened).toMatchObject({ type: 'term.opened', id: 'rig-dev-build-starter', cols: 90, rows: 20 });
    expect(opened && 'screen' in opened ? opened.screen : '').toContain('seat-ready');
    expect((await run(['-L', seats, 'show-options', '-w', '-v', '-t', `=${seat}:`, 'window-size'])).stdout.trim()).toBe('manual');

    host.input(reply, 'rig-dev-build-starter', 'hello-seat\r');
    // The tty echoes the line, then cat prints it back: twice on the seat's screen, and the bytes come back through the stream.
    await until(async () => ((await seatServer.capture(seat, 10)) ?? '').split('\n').filter(l => l.includes('hello-seat')).length >= 2, 8000);
    await until(() => sent.some(m => m.type === 'term.output'), 8000);

    host.unwatch(reply, 'rig-dev-build-starter');
    // The window option is unset again: the seat follows its server's own setting, as before the watch, and the mark is gone.
    await until(async () => (await sizeOf(seat)) === '' && (await markOf(seat)) === '', 8000);
    expect(await seatServer.hasSession(seat)).toBe(true);
  }, 30_000);

  it('a seat\'s own window-size comes back exactly, after two watches at once', async () => {
    const seatServer = realTmux(seats, opt);
    const name = 'dev-review@starter';
    await seatServer.newSession({ name, cwd: '/tmp', env: {}, command: ['sh', '-c', 'cat'] });
    // The person's (or OpenRig's) own choice for this window.
    await run(['-L', seats, 'set-option', '-w', '-t', `=${name}:`, 'window-size', 'smallest']);
    const tmux = routedTmux(realTmux(own, opt), seatServer);
    const host = createPaneHost({ controlArgs: n => tmux.controlArgs?.(n) ?? null, log: () => {} });
    const a: ServerMessage[] = [], b: ServerMessage[] = [];
    const ra = (m: ServerMessage) => { a.push(m); }, rb = (m: ServerMessage) => { b.push(m); };
    host.watch(ra, { id: 'r', tmuxName: name }, { cols: 90, rows: 20 });
    host.watch(rb, { id: 'r', tmuxName: name }, { cols: 100, rows: 30 });
    await until(() => a.some(m => m.type === 'term.opened') && b.some(m => m.type === 'term.opened'), 8000);
    expect(await sizeOf(name)).toBe('manual');
    expect(await markOf(name)).toMatch(/^smallest:\d+x\d+$/);
    host.unwatch(ra, 'r');
    await new Promise(r => setTimeout(r, 300));
    // The other watch still holds it.
    expect(await sizeOf(name)).toBe('manual');
    host.unwatch(rb, 'r');
    await until(async () => (await sizeOf(name)) === 'smallest' && (await markOf(name)) === '', 8000);
  }, 30_000);

  it('a seat in manual, its own or the server\'s, gets its dimensions back', async () => {
    const seatServer = realTmux(seats, opt);
    const tmux = routedTmux(realTmux(own, opt), seatServer);
    const host = createPaneHost({ controlArgs: n => tmux.controlArgs?.(n) ?? null, log: () => {} });
    // Its own `manual` at 115x30, then a server whose global value is `manual` (the window has none of its own).
    for (const [name, global] of [['dev-plan@starter', false], ['dev-docs@starter', true]] as const) {
      await seatServer.newSession({ name, cwd: '/tmp', env: {}, command: ['sh', '-c', 'cat'] });
      if (global) await run(['-L', seats, 'set-option', '-gw', 'window-size', 'manual']);
      else await run(['-L', seats, 'set-option', '-w', '-t', `=${name}:`, 'window-size', 'manual']);
      await run(['-L', seats, 'resize-window', '-x', '115', '-y', '30', '-t', `=${name}:`]);
      if (global) await run(['-L', seats, 'set-option', '-wu', '-t', `=${name}:`, 'window-size']);
      expect(await dimsOf(name)).toBe('115x30');
      const sent: ServerMessage[] = [];
      const reply = (m: ServerMessage) => { sent.push(m); };
      host.watch(reply, { id: name, tmuxName: name }, { cols: 90, rows: 20 });
      await until(() => sent.some(m => m.type === 'term.opened'), 8000);
      expect(await dimsOf(name)).toBe('90x20');
      host.unwatch(reply, name);
      await until(async () => (await markOf(name)) === '', 8000);
      expect(await dimsOf(name)).toBe('115x30');
      expect(await sizeOf(name)).toBe(global ? '' : 'manual');
      if (global) await run(['-L', seats, 'set-option', '-gw', 'window-size', 'latest']);
    }
  }, 30_000);

  it('a daemon that died while a seat was held: the next start gives the window its own size back, and touches no other', async () => {
    const seatServer = realTmux(seats, opt);
    const held = 'dev-qa@starter', other = 'dev-design@starter';
    await seatServer.newSession({ name: held, cwd: '/tmp', env: {}, command: ['sh', '-c', 'cat'] });
    await seatServer.newSession({ name: other, cwd: '/tmp', env: {}, command: ['sh', '-c', 'cat'] });
    await run(['-L', seats, 'set-option', '-w', '-t', `=${held}:`, 'window-size', 'manual']);
    await run(['-L', seats, 'resize-window', '-x', '115', '-y', '30', '-t', `=${held}:`]);
    // A window Ledge never held keeps whatever it has, even `manual`.
    await run(['-L', seats, 'set-option', '-w', '-t', `=${other}:`, 'window-size', 'manual']);
    const tmux = routedTmux(realTmux(own, opt), seatServer);
    const sent: ServerMessage[] = [];
    const reply = (m: ServerMessage) => { sent.push(m); };
    const host = createPaneHost({ controlArgs: n => tmux.controlArgs?.(n) ?? null, log: () => {} });
    host.watch(reply, { id: 'q', tmuxName: held }, { cols: 90, rows: 20 });
    await until(() => sent.some(m => m.type === 'term.opened'), 8000);
    expect(await sizeOf(held)).toBe('manual');
    expect(await markOf(held)).toBe('manual:115x30');
    expect(await dimsOf(held)).toBe('90x20');
    // The daemon dies: its control client is killed outright, nothing is written back (the host's own close finds it dead).
    const pids = (await run(['-L', seats, 'list-clients', '-t', `=${held}`, '-F', '#{client_pid}'])).stdout.trim().split('\n').filter(Boolean);
    expect(pids).toHaveLength(1);
    process.kill(Number(pids[0]), 'SIGKILL');
    await until(async () => (await run(['-L', seats, 'list-clients', '-t', `=${held}`, '-F', '#{client_pid}'])).stdout.trim() === '', 8000);
    await new Promise(r => setTimeout(r, 200));
    // Left as the dead daemon had it: held at the desktop's size, the window's own value kept in the mark.
    expect(await sizeOf(held)).toBe('manual');
    expect(await markOf(held)).toBe('manual:115x30');
    expect(await dimsOf(held)).toBe('90x20');
    const { settleTerminals } = await import('../src/daemon/index.js');
    await settleTerminals(tmux, new Set(await tmux.listSessions()), [{ tmuxSession: held }, { tmuxSession: other }]);
    expect(await sizeOf(held)).toBe('manual');
    expect(await dimsOf(held)).toBe('115x30');
    expect(await markOf(held)).toBe('');
    expect(await sizeOf(other)).toBe('manual');
  }, 30_000);
});

const sizeOf = async (name: string) => (await run(['-L', seats, 'show-options', '-w', '-v', '-t', `=${name}:`, 'window-size'])).stdout.trim();
const dimsOf = async (name: string) => (await run(['-L', seats, 'display-message', '-p', '-t', `=${name}:`, '#{window_width}x#{window_height}'])).stdout.trim();
const markOf = async (name: string) => (await run(['-L', seats, 'show-options', '-wq', '-v', '-t', `=${name}:`, '@ledge_window_size'])).stdout.trim();
