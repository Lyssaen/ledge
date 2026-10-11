import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, createConnection } from 'node:net';
import { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLaunchArgs, ensureDaemon, attachEnv, agentEnv, launch } from '../src/cli/launch.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { killTestServer, until } from './helpers.js';
import { realTmux, type Tmux } from '../src/tmux.js';

const agent = fileURLToPath(new URL('./fake-agent.mjs', import.meta.url));
const noop: Tmux = { async newSession() {}, async sendText() {}, async sendKeys() {}, async capture() { return ''; }, async hasSession() { return false; }, async listSessions() { return []; }, async setOption() {}, async killSession() {}, attachArgs: () => [] };
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
  it('a Ledge daemon slower than 400 ms to answer is still a Ledge daemon, not another program', async () => {
    const srv = await startServer({ store: new Store(), tmux: noop, port: 0 });
    // A proxy that holds every connection for 600 ms before reaching the daemon.
    const slow = createServer(sock => { sock.pause(); setTimeout(() => { const up = createConnection({ host: '127.0.0.1', port: srv.port }, () => { sock.pipe(up); up.pipe(sock); sock.resume(); }); up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy()); }, 600); });
    await new Promise<void>(r => slow.listen(0, '127.0.0.1', r));
    const spawnDaemon = vi.fn();
    const r = await ensureDaemon({ port: (slow.address() as { port: number }).port, spawnDaemon });
    expect(r.client).not.toBeNull();
    expect(spawnDaemon).not.toHaveBeenCalled();
    await r.client!.close(); slow.close(); await srv.close();
  });
  it('a WebSocket server that never sends a Ledge snapshot is foreign', async () => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>(r => wss.once('listening', r));
    wss.on('connection', ws => ws.send(JSON.stringify({ hello: 'world' })));
    const r = await ensureDaemon({ port: (wss.address() as { port: number }).port, spawnDaemon: vi.fn(), timeoutMs: 300 });
    expect(r).toEqual({ client: null, reason: 'foreign' });
    for (const c of wss.clients) c.terminate();
    await new Promise(r => wss.close(r));
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

describe('agentEnv', () => {
  it('keeps the launcher environment, drops TMUX and TMUX_*, and adds the Ledge variables last', () => {
    const env = agentEnv({ PATH: '/usr/bin', AWS_PROFILE: 'dev', TMUX: 'x', TMUX_PANE: '%1', TMUX_TMPDIR: '/t', LEDGE_SESSION: 'outer', GONE: undefined }, { LEDGE_SESSION: 'ab12', LEDGE_NAME: 'Otto' });
    expect(env).toEqual({ PATH: '/usr/bin', AWS_PROFILE: 'dev', LEDGE_SESSION: 'ab12', LEDGE_NAME: 'Otto' });
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

  it("gives the agent the launcher's environment, not the tmux server's", async () => {
    // Start the server first: its global environment is frozen without the probe variables.
    await tmux.newSession({ name: 'warm', cwd: '/tmp', env: {}, command: ['sleep', '60'] });
    const out = join(process.env.LEDGE_HOME!, 'env-probe');
    process.env.LEDGE_ENV_PROBE = 'from the launcher';
    process.env.TMUX_LEDGE_PROBE = 'must not pass';
    try {
      const code = await launch('claude', [], {
        port: srv.port, tmuxSocket: socket, cwd: '/tmp', attach: ptyAttach,
        command: ['sh', '-c', 'printf "%s|%s|%s" "$LEDGE_ENV_PROBE" "${TMUX_LEDGE_PROBE-unset}" "$LEDGE_NAME" > "$0"', out]
      });
      expect(code).toBe(0);
    } finally { delete process.env.LEDGE_ENV_PROBE; delete process.env.TMUX_LEDGE_PROBE; }
    expect(readFileSync(out, 'utf8')).toBe(`from the launcher|unset|${only().name}`);
  });

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

  it('returns the exit code of an agent that exits before the attach even starts', async () => {
    const code = await launch('claude', [], { port: srv.port, tmuxSocket: socket, cwd: '/tmp', command: ['sh', '-c', 'exit 9'], attach: ptyAttach });
    expect(code).toBe(9);
    await until(() => store.all()[0]?.state === 'exited');
    expect(only().exitCode).toBe(9);
    expect(readdirSync(process.env.LEDGE_HOME!).filter(f => f.startsWith('exit-'))).toEqual([]);
  });

  it('after a detach, an exit while someone else is attached still ends the session', async () => {
    const code = await launch('claude', [], { port: srv.port, tmuxSocket: socket, cwd: '/tmp', command: ['node', agent, 'work', '1000', 'exit', '0'], attach: async () => 0 });
    expect(code).toBe(0);
    const name = only().tmuxSession!;
    // The user re-attaches by hand (the launcher's own hint), then the agent exits.
    const manual = await ptyAttach(realTmux(socket).attachArgs(name), attachEnv(process.env));
    expect(manual).toBe(0);
    expect(await tmux.hasSession(name)).toBe(false);
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

  it('falls back to an untracked launch when the daemon stops answering during session creation', async () => {
    // Speaks just enough Ledge to pass ensureDaemon, then ignores snapshot.request.
    const mute = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>(r => mute.once('listening', r));
    mute.on('connection', ws => ws.send(JSON.stringify({ type: 'snapshot', sessions: [] })));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const code = await launch('claude', [], { port: (mute.address() as { port: number }).port, tmuxSocket: socket, cwd: '/tmp', command: ['node', agent, 'exit', '4'], attach: ptyAttach });
      expect(code).toBe(4);
      expect(err).toHaveBeenCalledWith('ledge: daemon not responding, session not tracked');
    } finally { for (const c of mute.clients) c.terminate(); await new Promise(r => mute.close(r)); }
  });

  it('when no daemon can be reached, says so and still runs the agent', async () => {
    const port = await freePort();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await launch('claude', [], { port, tmuxSocket: socket, cwd: '/tmp', command: ['node', agent, 'exit', '0'], attach: ptyAttach, spawnDaemon: () => {}, retryDelayMs: 20 });
    expect(code).toBe(0);
    expect(err).toHaveBeenCalledWith('ledge: daemon not running, session not tracked');
  });
});
