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
    // The window option is unset again: the seat follows its server's own setting, as before the watch.
    await until(async () => (await run(['-L', seats, 'show-options', '-w', '-v', '-t', `=${seat}:`, 'window-size'])).stdout.trim() === '', 8000);
    expect(await seatServer.hasSession(seat)).toBe(true);
  }, 30_000);
});
