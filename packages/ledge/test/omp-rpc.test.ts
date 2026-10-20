import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { OmpRpc, RpcError, lineReader } from '../src/daemon/omp/rpc.js';

const FAKE = [process.execPath, fileURLToPath(new URL('./fake-omp.mjs', import.meta.url))];
const start = (args: string[] = [], env: NodeJS.ProcessEnv = {}) => OmpRpc.start({ command: FAKE, args: ['--session-dir', '/tmp/ledge-fake-omp', ...args], cwd: '/tmp', env: { ...process.env, ...env } });

describe('lineReader', () => {
  const read = (max: number, chunks: Array<string | Buffer>) => {
    const lines: string[] = []; const bad: string[] = [];
    const feed = lineReader(max, l => lines.push(l), r => bad.push(r));
    for (const c of chunks) feed(Buffer.from(c));
    return { lines, bad };
  };
  it('joins a line split across chunks, tolerates \\r\\n and skips blank lines', () => {
    expect(read(100, ['{"a":', '1}\r\n\n{"b":2}\n']).lines).toEqual(['{"a":1}', '{"b":2}']);
  });
  it('keeps a multi-byte character split across chunks', () => {
    const bytes = Buffer.from('{"t":"é"}\n'); const cut = bytes.indexOf(0xc3) + 1;
    expect(read(100, [bytes.subarray(0, cut), bytes.subarray(cut)]).lines).toEqual(['{"t":"é"}']);
  });
  it('drops a line over the limit whole, reports it once, and carries on with the next', () => {
    const r = read(10, ['x'.repeat(8), 'x'.repeat(8), 'yyy\n', '{"ok":1}\n']);
    expect(r.lines).toEqual(['{"ok":1}']); expect(r.bad).toHaveLength(1);
  });
  it('reports invalid UTF-8 instead of delivering replacement characters', () => {
    const r = read(100, [Buffer.from([0x7b, 0xff, 0x7d, 0x0a])]);
    expect(r.lines).toEqual([]); expect(r.bad).toEqual(['invalid UTF-8']);
  });
});

describe('OmpRpc', () => {
  it('waits for ready, answers a command by its id and resolves with its data', async () => {
    const rpc = await start();
    expect(rpc.ready).toMatchObject({ protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576 });
    const state = await rpc.request<{ sessionId: string; isSettled: boolean }>('get_state');
    expect(state).toMatchObject({ sessionId: 'fake-session', isSettled: true });
    await rpc.close();
  });
  it('correlates by id: two commands in flight each get their own answer', async () => {
    const rpc = await start();
    const [a, b] = await Promise.all([rpc.request<{ models: unknown[] }>('get_available_models'), rpc.request<{ sessionId: string }>('get_state')]);
    expect(a.models).toHaveLength(3); expect(b.sessionId).toBe('fake-session');
    await rpc.close();
  });
  it('rejects with OMP\'s own text when it refuses a command, and the process stays usable', async () => {
    const rpc = await start();
    await expect(rpc.request('nope')).rejects.toMatchObject({ message: 'Unknown command: nope', code: 'refused' });
    await expect(rpc.request('get_state')).resolves.toBeTruthy();
    await rpc.close();
  });
  it('delivers events in order and keeps responses out of them', async () => {
    const rpc = await start(); const seen: string[] = [];
    rpc.onFrame(f => seen.push(f.type));
    await rpc.request('prompt', { message: 'hello' });
    await new Promise<void>(res => rpc.onFrame(f => f.type === 'session_settled' && res()));
    expect(seen).toContain('agent_start'); expect(seen).not.toContain('response');
    expect(seen.indexOf('agent_start')).toBeLessThan(seen.indexOf('agent_end'));
    expect(seen.indexOf('agent_end')).toBeLessThan(seen.indexOf('session_settled'));
    await rpc.close();
  });
  it('fails the start with the process\'s stderr when it dies before ready', async () => {
    await expect(start([], { FAKE_OMP_DIE: '3' })).rejects.toThrow(/omp: no credentials/);
  });
  it('rejects the commands in flight and reports the exit when the process ends under them', async () => {
    const rpc = await start();
    const exit = new Promise(res => rpc.onExit(res));
    await rpc.request('prompt', { message: 'slow' });
    const pending = rpc.request('get_state', {}, 0).catch(e => e);
    process.kill(rpc.pid!, 'SIGKILL');
    expect(await exit).toMatchObject({ signal: 'SIGKILL' });
    await pending; // the get_state may have been answered before the kill: either way nothing hangs
    await expect(rpc.request('get_state')).rejects.toBeInstanceOf(RpcError);
  });
  it('close() ends stdin so the process leaves by itself with code 0', async () => {
    const rpc = await start();
    expect(await rpc.close()).toMatchObject({ code: 0 });
  });
});
