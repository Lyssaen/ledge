import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLaunchArgs, ensureDaemon, attachEnv, launch } from '../src/cli/launch.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { realTmux, run, type Tmux } from '../src/tmux.js';

const agent = fileURLToPath(new URL('./fake-agent.mjs', import.meta.url));
const noop: Tmux = { async newSession() {}, async sendText() {}, async sendKeys() {}, async capture() { return ''; }, async hasSession() { return false; }, async listSessions() { return []; }, async killSession() {}, attachArgs: () => [] };
/** Kill a throwaway tmux server and remove its socket file (tmux leaves it behind). */
const killTestServer = async (socket: string) => { await run(['-L', socket, 'kill-server']); rmSync(join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${process.getuid!()}`, socket), { force: true }); };
const until = async (pred: () => boolean | Promise<boolean>, ms = 4000) => { const t0 = Date.now(); while (!(await pred())) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 50)); } };
const freePort = async () => { const s = createServer(); await new Promise<void>(r => s.listen(0, '127.0.0.1', r)); const p = (s.address() as { port: number }).port; await new Promise(r => s.close(r)); return p; };

/** Runs the real `tmux attach` inside a pseudo-terminal (util-linux `script`), like a user's terminal tab. */
const ptyAttach = (args: string[], env: NodeJS.ProcessEnv) => new Promise<number>(resolve => {
  const cmd = ['tmux', ...args].map(a => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  const c = spawn('script', ['-qec', cmd, '/dev/null'], { stdio: 'ignore', env });
  c.on('exit', code => resolve(code ?? 1));
});

beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); });

describe('parseLaunchArgs', () => {
  it('extracts --name and passes the rest to the agent', () => {
    expect(parseLaunchArgs(['--name', 'otto', '--', '-p', 'hello'])).toEqual({ name: 'otto', args: ['-p', 'hello'] });
    expect(parseLaunchArgs(['--resume'])).toEqual({ name: undefined, args: ['--resume'] });
    expect(parseLaunchArgs([])).toEqual({ name: undefined, args: [] });
  });
});

describe('ensureDaemon', () => {
  it('connects to a live Ledge daemon instead of spawning a second one', async () => {
    const srv = await startServer({ store: new Store(), tmux: noop, port: 0 });
    const spawnDaemon = vi.fn();
    const r = await ensureDaemon({ port: srv.port, spawnDaemon });
    expect(r.client).not.toBeNull();
    expect(spawnDaemon).not.toHaveBeenCalled();
    await r.client!.close(); await srv.close();
  });
  it('returns null and logs when the port is held by a foreign process, without spawning', async () => {
    const foreign = createServer(sock => sock.end());
    await new Promise<void>(r => foreign.listen(0, '127.0.0.1', r));
    const port = (foreign.address() as { port: number }).port;
    const spawnDaemon = vi.fn();
    const r = await ensureDaemon({ port, spawnDaemon });
    expect(r).toEqual({ client: null, reason: 'foreign' });
    expect(spawnDaemon).not.toHaveBeenCalled();
    expect(readFileSync(join(process.env.LEDGE_HOME!, 'daemon.log'), 'utf8')).toMatch(/does not speak the Ledge protocol/);
    foreign.close();
  });
  it('spawns the daemon when nothing listens, and connects once it is up', async () => {
    const port = await freePort();
    let srv: ServerHandle | undefined;
    const spawnDaemon = vi.fn(() => { void startServer({ store: new Store(), tmux: noop, port }).then(s => { srv = s; }); });
    const r = await ensureDaemon({ port, spawnDaemon, retryDelayMs: 50 });
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
    expect(r.client).not.toBeNull();
    await r.client!.close(); await srv!.close();
  });
  it('gives up with "unreachable" after three retries', async () => {
    const port = await freePort();
    const spawnDaemon = vi.fn();
    expect(await ensureDaemon({ port, spawnDaemon, retryDelayMs: 20 })).toEqual({ client: null, reason: 'unreachable' });
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
  });
});

describe('attachEnv', () => {
  it('drops $TMUX so attaching from inside another tmux is not refused as nested', () => {
    const env = attachEnv({ TMUX: '/tmp/tmux-1000/default,123,0', PATH: '/usr/bin' });
    expect(env.TMUX).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });
});

describe('launch', () => {
  // One throwaway tmux server per test: reusing a socket races with the previous kill-server.
  let n = 0; let socket: string; let tmux: Tmux;
  let store: Store; let srv: ServerHandle;
  beforeEach(async () => {
    socket = `ledge-launch-${process.pid}-${Date.now()}-${n++}`; tmux = realTmux(socket);
    store = new Store(); srv = await startServer({ store, tmux, port: 0 });
  });
  afterEach(async () => { await srv.close(); await killTestServer(socket); vi.restoreAllMocks(); });
  const only = () => { const all = store.all(); expect(all).toHaveLength(1); return all[0]!; };

  it("returns the agent's exit code (not tmux attach's) and unregisters with it", async () => {
    const code = await launch('claude', ['--name', 'otto'], { port: srv.port, tmuxSocket: socket, cwd: '/tmp', command: ['node', agent, 'work', '400', 'exit', '7'], attach: ptyAttach });
    expect(code).toBe(7);
    await until(() => store.all()[0]?.state === 'exited');
    expect(only()).toMatchObject({ name: 'Otto', state: 'exited', exitCode: 7 });
    expect(await tmux.listSessions()).toEqual([]);
  });

  it('unregisters through a fresh connection, so a daemon restart meanwhile is survived', async () => {
    const code = await launch('claude', [], {
      port: srv.port, tmuxSocket: socket, cwd: '/tmp', command: ['node', agent, 'work', '600', 'exit', '3'],
      attach: async (args, env) => {
        const port = srv.port; await store.save(); await srv.close();
        store = new Store(); await store.load(); srv = await startServer({ store, tmux, port });
        return ptyAttach(args, env);
      }
    });
    expect(code).toBe(3);
    await until(() => store.all()[0]?.state === 'exited');
    expect(only().exitCode).toBe(3);
  });

  it('a detach leaves the agent running and registered, and returns 0', async () => {
    const code = await launch('claude', [], { port: srv.port, tmuxSocket: socket, cwd: '/tmp', command: ['node', agent, 'work', '60000'], attach: async () => 0 });
    expect(code).toBe(0);
    await until(() => store.all().length === 1);
    expect(only().state).toBe('starting');
    expect(await tmux.hasSession(only().tmuxSession!)).toBe(true);
  });

  it('a failed attach never unregisters a live agent', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await launch('claude', [], { port: srv.port, tmuxSocket: socket, cwd: '/tmp', command: ['node', agent, 'work', '60000'], attach: async () => 1 });
    expect(code).toBe(1);
    await until(() => store.all().length === 1);
    expect(only().state).toBe('starting');
    expect(err.mock.calls.flat().join('\n')).toMatch(/could not attach/);
  });

  it('when the port belongs to another program, says so and still runs the agent untracked', async () => {
    const foreign = createServer(sock => sock.end());
    await new Promise<void>(r => foreign.listen(0, '127.0.0.1', r));
    const port = (foreign.address() as { port: number }).port;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spawnDaemon = vi.fn();
    try {
      const code = await launch('claude', [], { port, tmuxSocket: socket, cwd: '/tmp', command: ['node', agent, 'exit', '5'], attach: ptyAttach, spawnDaemon });
      expect(code).toBe(5);
      expect(err).toHaveBeenCalledWith(`ledge: port ${port} is used by another program, session not tracked`);
      expect(spawnDaemon).not.toHaveBeenCalled();
    } finally { foreign.close(); }
  });

  it('when no daemon can be reached, says so and still runs the agent', async () => {
    const port = await freePort();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await launch('claude', [], { port, tmuxSocket: socket, cwd: '/tmp', command: ['node', agent, 'exit', '0'], attach: ptyAttach, spawnDaemon: () => {}, retryDelayMs: 20 });
    expect(code).toBe(0);
    expect(err).toHaveBeenCalledWith('ledge: daemon not running, session not tracked');
  });
});
