import { afterEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { bridge } from '../src/cli/bridge.js';
import { readFrames, MAX_FRAME } from '../src/transport/frames.js';
import { serveSsh, sshArgs } from '../src/transport/ssh.js';
import { startServer } from '../src/daemon/server.js';
import { Store } from '../src/daemon/store.js';
import type { Tmux } from '../src/tmux.js';
import { until } from './helpers.js';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function wsServer() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(wss, 'listening');
  cleanup.push(() => new Promise<void>(r => { for (const ws of wss.clients) ws.terminate(); wss.close(() => r()); }));
  return { wss, port: (wss.address() as { port: number }).port };
}
describe('SSH application transport', () => {
  it('uses a fixed application command with SSH aliases, never port forwarding or injected flags', () => {
    const args = sshArgs('my-other-server');
    expect(args).toContain('StrictHostKeyChecking=yes');
    expect(args.slice(-3)).toEqual(['--', 'my-other-server', "bash -lc 'exec ledge bridge'"]);
    expect(args).not.toContain('-L'); expect(args).not.toContain('-R');
    for (const alias of ['-oProxyCommand=evil', 'server; whoami', 'a\nb', 'user@host', 'a/../../b']) expect(() => sshArgs(alias)).toThrow();
  });
  it('reads fragmented UTF-8 frames and rejects unbounded or malformed input', () => {
    const input = new PassThrough(), got: unknown[] = [], errors: Error[] = [];
    const off = readFrames(input, m => got.push(m), e => errors.push(e));
    const bytes = Buffer.from('{"text":"é"}\n');
    input.write(bytes.subarray(0, 10)); input.write(bytes.subarray(10));
    expect(got).toEqual([{ text: 'é' }]);
    input.write('x'.repeat(MAX_FRAME + 1)); expect(errors[0]?.message).toContain('too large'); off();
  });
  it('exchanges validated daemon messages over stdin/stdout and exits on EOF', async () => {
    const { wss, port } = await wsServer();
    const got: unknown[] = [], input = new PassThrough(), output = new PassThrough();
    let text = ''; output.on('data', b => { text += String(b); });
    wss.on('connection', ws => { ws.send(JSON.stringify({ type: 'snapshot', sessions: [] })); ws.on('message', b => got.push(JSON.parse(String(b)))); });
    const done = bridge({ input, output, port });
    await until(() => text.includes('snapshot'));
    input.write('{"type":"snapshot.request"}\n');
    await until(() => got.length === 1); expect(got).toEqual([{ type: 'snapshot.request' }]);
    input.end(); await done;
  });
  it('rejects invalid application commands instead of forwarding arbitrary payloads', async () => {
    const { wss, port } = await wsServer(), input = new PassThrough(), output = new PassThrough();
    const got: unknown[] = []; output.resume();
    wss.on('connection', ws => ws.on('message', m => got.push(m)));
    const done = bridge({ input, output, port });
    const failed = expect(done).rejects.toThrow();
    input.write('{"type":"run-shell","command":"anything"}\n');
    await failed; expect(got).toEqual([]);
  });
  it('relays the remote snapshot only, forwards commands, and kills its child when the front closes', async () => {
    const { wss, port } = await wsServer(); let child!: ChildProcessWithoutNullStreams;
    wss.on('connection', ws => serveSsh(ws, 'server', { spawn: () => {
      child = spawn(process.execPath, ['--input-type=module', '-e', `console.log(JSON.stringify({type:'snapshot',sessions:[]})); process.stdin.setEncoding('utf8'); process.stdin.on('data',data=>{for(const l of data.trim().split('\\n')){const m=JSON.parse(l);console.log(JSON.stringify({type:'error',message:m.type}));}});`]);
      cleanup.push(() => { child.kill('SIGKILL'); }); return child;
    } }));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`), got: { type: string; message?: string }[] = [];
    ws.on('message', b => got.push(JSON.parse(String(b)))); cleanup.push(() => ws.terminate());
    await until(() => got.length === 1); expect(got[0]).toMatchObject({ type: 'snapshot', sshAlias: 'server' });
    ws.send(JSON.stringify({ type: 'snapshot.request' }));
    await until(() => got.length === 2); expect(got[1]?.message).toBe('snapshot.request');
    ws.close(); await until(() => child.exitCode !== null || child.signalCode !== null);
  });
  it('reports a missing remote bridge without marking the host ready', async () => {
    const { wss, port } = await wsServer();
    wss.on('connection', ws => serveSsh(ws, 'server', { spawn: () => spawn(process.execPath, ['-e', 'console.error("ledge: command not found"); process.exit(127)']) }));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`), got: { type: string; message: string }[] = [];
    ws.on('message', b => got.push(JSON.parse(String(b))));
    await once(ws, 'close');
    expect(got).toHaveLength(1); expect(got[0]).toMatchObject({ type: 'error' }); expect(got[0]?.message).toContain('command not found');
  });
  it('isolates SSH peers from local broadcasts and applies origin and path validation', async () => {
    const tmux = { setOption: async () => {} } as unknown as Tmux;
    const called: string[] = [];
    const srv = await startServer({ store: new Store(), tmux, port: 0, ssh: (ws, alias) => { called.push(alias); ws.send(JSON.stringify({ type: 'snapshot', sessions: [] })); } });
    cleanup.push(() => srv.close());
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ssh/server`), got: unknown[] = [];
    ws.on('message', b => got.push(JSON.parse(String(b)))); cleanup.push(() => ws.terminate());
    await until(() => got.length === 1);
    srv.broadcast({ type: 'error', message: 'local-only' });
    await new Promise(r => setTimeout(r, 40)); expect(got).toEqual([{ type: 'snapshot', sessions: [] }]);
    expect(called).toEqual(['server']);
    for (const [path, origin] of [['/ssh/-flag', undefined], ['/ssh/server', 'https://evil.example']]) {
      const bad = new WebSocket(`ws://127.0.0.1:${srv.port}${path}`, { origin });
      await expect(once(bad, 'open')).rejects.toThrow('401');
    }
    expect(called).toEqual(['server']);
  });
});
