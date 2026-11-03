import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ISLAND_PREFS } from '@ledge/protocol';
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
import { authHeaders, until } from './helpers.js';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function wsServer() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(wss, 'listening');
  cleanup.push(() => new Promise<void>(r => { for (const ws of wss.clients) ws.terminate(); wss.close(() => r()); }));
  return { wss, port: (wss.address() as { port: number }).port };
}
/** A fake `ssh … ledge bridge`: a node child running `script`, with `out(frame)` writing one NDJSON frame and `keep()` holding it open. */
function remote(script: string): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `const out=m=>console.log(JSON.stringify(m)); const keep=()=>setInterval(()=>{},1000); ${script}`]);
  cleanup.push(() => { child.kill('SIGKILL'); }); return child;
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
  it('readFrames still stops on invalid JSON without the option, and keeps reading with it', () => {
    const input = new PassThrough(), got: unknown[] = [], errors: Error[] = [];
    readFrames(input, m => got.push(m), e => errors.push(e));
    input.write('not json\n{"a":1}\n');
    expect(got).toEqual([]); expect(errors).toHaveLength(1); expect(errors[0]).toBeInstanceOf(SyntaxError);
    const kept = new PassThrough(), seen: unknown[] = [], bad: string[] = [], fails: Error[] = [];
    readFrames(kept, m => seen.push(m), e => fails.push(e), { onBadLine: line => bad.push(line) });
    kept.write('not json\n{"a":1}\n');
    expect(bad).toEqual(['not json']); expect(seen).toEqual([{ a: 1 }]); expect(fails).toEqual([]);
    kept.write('x'.repeat(MAX_FRAME + 1)); expect(fails[0]?.message).toContain('too large');
  });
  it('bridge answers an unknown or unreadable client frame with an error, forwards nothing, and keeps going', async () => {
    const { wss, port } = await wsServer(), input = new PassThrough(), output = new PassThrough();
    const got: unknown[] = [], logged: string[] = []; let text = ''; output.on('data', b => { text += String(b); });
    wss.on('connection', ws => { ws.send(JSON.stringify({ type: 'snapshot', sessions: [] })); ws.on('message', b => got.push(JSON.parse(String(b)))); });
    const done = bridge({ input, output, port, log: line => logged.push(line) });
    let settled = false; void done.then(() => { settled = true; }, () => { settled = true; });
    await until(() => text.includes('snapshot'));
    input.write('{"type":"future.thing","x":1}\n{"type":"future.thing"}\n{"type":"run-shell","command":"anything"}\nnot json\n{"type":"snapshot.request"}\n');
    await until(() => got.length === 1); expect(got).toEqual([{ type: 'snapshot.request' }]);
    const frames = text.trim().split('\n').map(l => JSON.parse(l) as { type: string; message?: string; request?: string; code?: string });
    const errors = frames.filter(f => f.type === 'error');
    expect(errors.map(e => e.request)).toEqual(['future.thing', 'future.thing', 'run-shell', undefined]);
    expect(errors[0]).toMatchObject({ code: 'invalid' }); expect(errors[0]?.message).toMatch(/^future\.thing : inconnu de Ledge \S+ sur \S+/);
    expect(errors[3]?.message).toMatch(/^\? : inconnu de Ledge/);
    expect(logged.filter(l => l.includes('future.thing'))).toHaveLength(1); expect(logged.filter(l => l.includes('"?"'))).toHaveLength(1);
    expect(settled).toBe(false);
    input.end(); await done;
  });
  it('bridge drops a daemon frame it does not know and keeps relaying, but stops on a malformed snapshot', async () => {
    const { wss, port } = await wsServer(), input = new PassThrough(), output = new PassThrough();
    const logged: string[] = []; let text = ''; output.on('data', b => { text += String(b); });
    wss.on('connection', ws => { ws.send(JSON.stringify({ type: 'snapshot', sessions: [] })); ws.send(JSON.stringify({ type: 'future.event' })); ws.send('not json'); ws.send(JSON.stringify({ type: 'error', message: 'after' })); });
    const done = bridge({ input, output, port, log: line => logged.push(line) });
    await until(() => text.includes('after'));
    expect(text).not.toContain('future.event'); expect(logged.some(l => l.includes('future.event'))).toBe(true);
    input.end(); await done;
    const bad = await wsServer(), out2 = new PassThrough(); out2.resume();
    bad.wss.on('connection', ws => ws.send(JSON.stringify({ type: 'snapshot', sessions: 'nope' })));
    await expect(bridge({ input: new PassThrough(), output: out2, port: bad.port, log: () => {} })).rejects.toThrow();
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
  it('bridge drops the daemon machines, projects and island frames and a front machines.set, projects.set or island.set, staying up', async () => {
    const { wss, port } = await wsServer(), input = new PassThrough(), output = new PassThrough();
    const got: unknown[] = []; let text = ''; output.on('data', b => { text += String(b); });
    wss.on('connection', ws => { ws.send(JSON.stringify({ type: 'snapshot', sessions: [] })); ws.send(JSON.stringify({ type: 'machines', machines: [{ id: 'local', label: 'Local' }] })); ws.send(JSON.stringify({ type: 'projects', projects: { projects: [], rules: [] } })); ws.send(JSON.stringify({ type: 'island', prefs: null })); ws.send(JSON.stringify({ type: 'error', message: 'after' })); ws.on('message', b => got.push(JSON.parse(String(b)))); });
    const done = bridge({ input, output, port });
    await until(() => text.includes('after')); expect(text).not.toContain('machines'); expect(text).not.toContain('projects'); expect(text).not.toContain('island');
    input.write('{"type":"machines.set","machines":[{"id":"local","label":"Local"}]}\n{"type":"projects.set","projects":{"projects":[],"rules":[]}}\n{"type":"island.set","prefs":' + JSON.stringify(DEFAULT_ISLAND_PREFS) + '}\n{"type":"snapshot.request"}\n');
    await until(() => got.length === 1); expect(got).toEqual([{ type: 'snapshot.request' }]);
    input.end(); await done;
  });
  it('serveSsh drops remote machines and projects frames and a front machines.set or projects.set, link stays up', async () => {
    const { wss, port } = await wsServer(); let child!: ChildProcessWithoutNullStreams;
    wss.on('connection', ws => serveSsh(ws, 'server', { spawn: () => {
      child = spawn(process.execPath, ['--input-type=module', '-e', `console.log(JSON.stringify({type:'snapshot',sessions:[]})); console.log(JSON.stringify({type:'machines',machines:[{id:'local',label:'Local'}]})); console.log(JSON.stringify({type:'projects',projects:{projects:[],rules:[]}})); process.stdin.setEncoding('utf8'); process.stdin.on('data',data=>{for(const l of data.trim().split('\\n')){const m=JSON.parse(l);console.log(JSON.stringify({type:'error',message:m.type}));}});`]);
      cleanup.push(() => { child.kill('SIGKILL'); }); return child;
    } }));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`), got: { type: string; message?: string }[] = [];
    ws.on('message', b => got.push(JSON.parse(String(b)))); cleanup.push(() => ws.terminate());
    await until(() => got.length >= 1); expect(got[0]).toMatchObject({ type: 'snapshot' });
    ws.send(JSON.stringify({ type: 'machines.set', machines: [{ id: 'local', label: 'Local' }] }));
    ws.send(JSON.stringify({ type: 'projects.set', projects: { projects: [], rules: [] } }));
    ws.send(JSON.stringify({ type: 'snapshot.request' }));
    await until(() => got.some(m => m.type === 'error'));
    expect(got.map(m => m.type)).toEqual(['snapshot', 'error']); expect(got[1]?.message).toBe('snapshot.request');
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
  it('serveSsh drops a remote frame it does not know after the snapshot, logs it once, and stays OPEN', async () => {
    const { wss, port } = await wsServer(), logged: string[] = [];
    wss.on('connection', ws => serveSsh(ws, 'server', { log: line => logged.push(line), spawn: () => remote(`out({type:'snapshot',sessions:[]}); out({type:'future.thing'}); out({type:'future.thing',x:1}); console.log('not json'); out({type:'error',message:'after'}); keep();`) }));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`), got: { type: string; message?: string }[] = [];
    ws.on('message', b => got.push(JSON.parse(String(b)))); cleanup.push(() => ws.terminate());
    await until(() => got.some(m => m.message === 'after'));
    expect(got.map(m => m.type)).toEqual(['snapshot', 'error']);
    expect(logged.filter(l => l.includes('future.thing'))).toHaveLength(1);
    await new Promise(r => setTimeout(r, 40)); expect(ws.readyState).toBe(WebSocket.OPEN);
  });
  it('serveSsh still stops on anything unparsable before the snapshot, and on a malformed snapshot later', async () => {
    for (const script of [`out({type:'future.thing'}); out({type:'snapshot',sessions:[]}); keep();`, `console.log('not json'); out({type:'snapshot',sessions:[]}); keep();`, `out({type:'snapshot',sessions:[]}); out({type:'snapshot',sessions:'nope'}); keep();`]) {
      const { wss, port } = await wsServer();
      wss.on('connection', ws => serveSsh(ws, 'server', { log: () => {}, spawn: () => remote(script) }));
      const ws = new WebSocket(`ws://127.0.0.1:${port}`), got: { type: string; message?: string }[] = [];
      ws.on('message', b => got.push(JSON.parse(String(b)))); cleanup.push(() => ws.terminate());
      const [code] = await once(ws, 'close') as [number];
      expect(code).toBe(1011); expect(got.at(-1)).toMatchObject({ type: 'error' });
    }
  });
  it('serveSsh answers a front frame it does not know with an error, writes nothing to the remote, and stays OPEN', async () => {
    const { wss, port } = await wsServer(), logged: string[] = [];
    wss.on('connection', ws => serveSsh(ws, 'server', { log: line => logged.push(line), spawn: () => remote(`out({type:'snapshot',sessions:[]}); process.stdin.setEncoding('utf8'); process.stdin.on('data',data=>{for(const l of data.trim().split('\\n')) out({type:'error',message:'echo:'+l});});`) }));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`), got: { type: string; message?: string; request?: string; code?: string }[] = [];
    ws.on('message', b => got.push(JSON.parse(String(b)))); cleanup.push(() => ws.terminate());
    await until(() => got.length === 1);
    ws.send(JSON.stringify({ type: 'future.thing' })); ws.send(JSON.stringify({ type: 'future.thing' })); ws.send('not json');
    ws.send(JSON.stringify({ type: 'snapshot.request' }));
    await until(() => got.some(m => m.message?.startsWith('echo:')));
    const refusals = got.filter(m => m.type === 'error' && !m.message?.startsWith('echo:'));
    expect(refusals.map(m => m.request)).toEqual(['future.thing', 'future.thing', undefined]);
    expect(refusals[0]).toMatchObject({ code: 'invalid' }); expect(refusals[0]?.message).toMatch(/^future\.thing : inconnu de Ledge \S+ sur \S+/);
    expect(got.filter(m => m.message?.startsWith('echo:')).map(m => m.message)).toEqual(['echo:{"type":"snapshot.request"}']);
    expect(logged.filter(l => l.includes('future.thing'))).toHaveLength(1);
    expect(ws.readyState).toBe(WebSocket.OPEN);
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
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ssh/server`, { headers: authHeaders() }), got: unknown[] = [];
    ws.on('message', b => got.push(JSON.parse(String(b)))); cleanup.push(() => ws.terminate());
    await until(() => got.length === 1);
    srv.broadcast({ type: 'error', message: 'local-only' });
    await new Promise(r => setTimeout(r, 40)); expect(got).toEqual([{ type: 'snapshot', sessions: [] }]);
    expect(called).toEqual(['server']);
    for (const [path, origin] of [['/ssh/-flag', undefined], ['/ssh/server', 'https://evil.example']]) {
      const bad = new WebSocket(`ws://127.0.0.1:${srv.port}${path}`, { origin, headers: authHeaders() });
      await expect(once(bad, 'open')).rejects.toThrow('401');
    }
    expect(called).toEqual(['server']);
  });
});
