import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { attach } from '../src/cli/attach.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { realTmux, type Tmux } from '../src/tmux.js';
import { killTestServer } from './helpers.js';

const T0 = '2026-10-10T09:00:00.000Z';
const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: 'Juno', tool: 'claude', cwd: '/tmp', project: 'tmp', title: 'Juno · api-gateway', tmuxSession: `ledge-${id}`,
  state: 'starting', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});

describe('ledge attach', () => {
  let socket: string; let tmux: Tmux; let store: Store; let srv: ServerHandle; let n = 0;
  beforeEach(async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
    socket = `ledge-attach-${process.pid}-${Date.now()}-${n++}`; tmux = realTmux(socket);
    store = new Store(); srv = await startServer({ store, tmux, port: 0 });
  });
  afterEach(async () => { await srv.close(); await killTestServer(socket); vi.restoreAllMocks(); });

  it('renames the tab after the session and attaches this terminal to its pane', async () => {
    await tmux.newSession({ name: 'ledge-ab12', cwd: '/tmp', env: {}, command: ['sleep', '60'] });
    store.upsert(mk('ab12'));
    const written: string[] = []; const attachFn = vi.fn(async () => 0);
    expect(await attach('ab12', { port: srv.port, tmuxSocket: socket, attach: attachFn, write: s => written.push(s) })).toBe(0);
    expect(written).toEqual(['\u001b]0;Juno · api-gateway\u0007']);
    expect(attachFn).toHaveBeenCalledTimes(1);
    const [args, env] = attachFn.mock.calls[0] as unknown as [string[], NodeJS.ProcessEnv];
    expect(args).toEqual(tmux.attachArgs('ledge-ab12'));
    expect(env.TMUX).toBeUndefined();
  });
  it('still attaches without a daemon, under the pane name', async () => {
    await tmux.newSession({ name: 'ledge-cd34', cwd: '/tmp', env: {}, command: ['sleep', '60'] });
    const written: string[] = [];
    expect(await attach('cd34', { port: 1, tmuxSocket: socket, attach: async () => 3, write: s => written.push(s) })).toBe(3);
    expect(written).toEqual(['\u001b]0;ledge-cd34\u0007']);
  });
  it('fails cleanly on an unknown or missing id', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const attachFn = vi.fn(async () => 0);
    expect(await attach('nope', { port: srv.port, tmuxSocket: socket, attach: attachFn })).toBe(1);
    expect(await attach('', { port: srv.port, tmuxSocket: socket, attach: attachFn })).toBe(2);
    expect(attachFn).not.toHaveBeenCalled();
    expect(quiet).toHaveBeenCalledWith('ledge attach: no session nope');
  });
});
