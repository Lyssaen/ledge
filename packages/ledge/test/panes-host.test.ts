import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPaneHost } from '../src/panes/host.js';
import { frameLines, panehostPath, PANEHOST_PROTOCOL, proof } from '../src/panes/protocol.js';

// A real pseudo-terminal under the host: as test/panes-conpty.test.ts, these run where node-pty loads.
const pty = await import('node-pty').then(() => true, () => false);
const node = process.execPath;
const TOKEN = 'a'.repeat(64);
const hosts: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { for (const h of hosts.splice(0)) await h.close(); });

const until = async (pred: () => boolean | Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return; await new Promise(r => setTimeout(r, 30)); }
  throw new Error('timeout');
};

/** A bare protocol client: `req` sends one request and resolves its response; `frames` holds everything received. */
function client(path: string) {
  const sock: Socket = connect(path);
  const frames: Array<Record<string, unknown>> = [];
  let closed = false; sock.on('close', () => { closed = true; });
  sock.on('data', frameLines(l => frames.push(JSON.parse(l))));
  let id = 0;
  const req = async (body: Record<string, unknown>) => {
    const my = ++id;
    sock.write(JSON.stringify({ id: my, ...body }) + '\n');
    await until(() => frames.some(f => f.id === my) || closed);
    return frames.find(f => f.id === my);
  };
  return { sock, frames, req, closed: () => closed, send: (o: object) => sock.write(JSON.stringify(o) + '\n') };
}
async function host(idleExitMs?: number, helloMs?: number) {
  const path = panehostPath(process.platform, mkdtempSync(join(tmpdir(), 'ledge-host-')), TOKEN);
  const h = await startPaneHost({ path, token: TOKEN, ...(idleExitMs ? { idleExitMs } : {}), ...(helloMs ? { helloMs } : {}) });
  hosts.push(h);
  return h;
}
/** The handshake: the host proves the token first, then the client; the token itself never crosses the socket. */
async function hello(c: ReturnType<typeof client>, token = TOKEN) {
  const nonce = 'n'.repeat(32);
  const h = await c.req({ op: 'hello', protocol: PANEHOST_PROTOCOL, nonce }) as { ok: boolean; value?: { nonce: string; proof: string } };
  if (!h?.ok) return h;
  expect(h.value!.proof).toBe(proof(TOKEN, 'host', nonce, h.value!.nonce));
  return c.req({ op: 'auth', proof: proof(token, 'client', nonce, h.value!.nonce) });
}
const agent = (script: string) => ({ name: `p${Math.random().toString(36).slice(2, 8)}`, cwd: tmpdir(), env: process.env as Record<string, string>, command: [node, '-e', script] });
const ECHO = "process.stdin.setRawMode(true); let b=''; process.stdin.on('data', d => { b += d; if (b.includes('\\r')) { console.log('\\ngot:' + b.trim()); b=''; } }); console.log('ready')";

describe.skipIf(!pty)('pane host', () => {
  it('refuses a connection without the token', async () => {
    const h = await host();
    const a = client(h.path);
    expect(await a.req({ op: 'listSessions' })).toMatchObject({ ok: false, error: 'unauthorized' });
    await until(() => a.closed());
    const b = client(h.path);
    expect(await hello(b, 'b'.repeat(64))).toMatchObject({ ok: false, error: 'unauthorized' });
    await until(() => b.closed());
    const c = client(h.path);
    expect(await c.req({ op: 'hello', protocol: 99, nonce: 'x'.repeat(32) })).toMatchObject({ ok: false, error: `protocol ${PANEHOST_PROTOCOL}` });
    await until(() => c.closed());
    expect(a.frames.concat(b.frames, c.frames).map(f => JSON.stringify(f)).join('')).not.toContain(TOKEN);
  });

  it('closes a connection that does not authenticate in time, and does not stay up for it', async () => {
    const h = await host(300, 200);
    const silent = client(h.path);
    await until(() => silent.closed(), 2000);
    const half = client(h.path);
    await half.req({ op: 'hello', protocol: PANEHOST_PROTOCOL, nonce: 'n'.repeat(32) });
    await until(() => half.closed(), 2000);
    await until(() => h.isClosed(), 3000);
  });

  it('drops a malformed frame and keeps serving', async () => {
    const h = await host(); const c = client(h.path); await hello(c);
    for (const bad of ['null', '[]', '42', '"x"', '{"op":"capture"}']) c.sock.write(bad + '\n');
    await new Promise(r => setTimeout(r, 300));
    const d = client(h.path); await hello(d);
    expect(await d.req({ op: 'listSessions' })).toMatchObject({ ok: true, value: [] });
  });

  it('serves the Tmux ops', async () => {
    const h = await host(); const c = client(h.path);
    expect(await hello(c)).toMatchObject({ ok: true });
    const opts = agent(ECHO);
    expect(await c.req({ op: 'newSession', opts })).toMatchObject({ ok: true });
    await until(async () => String((await c.req({ op: 'capture', name: opts.name, lines: 20 }))!.value ?? '').includes('ready'));
    await c.req({ op: 'sendText', name: opts.name, text: 'hello' });
    await c.req({ op: 'sendKeys', name: opts.name, keys: ['Enter'] });
    await until(async () => String((await c.req({ op: 'capture', name: opts.name, lines: 20 }))!.value ?? '').includes('got:hello'));
    expect(await c.req({ op: 'hasSession', name: opts.name })).toMatchObject({ ok: true, value: true });
    expect(await c.req({ op: 'listSessions' })).toMatchObject({ ok: true, value: [opts.name] });
    expect(await c.req({ op: 'width', name: opts.name })).toMatchObject({ ok: true, value: 200 });
    expect(await c.req({ op: 'sendText', name: 'nope', text: 'x' })).toMatchObject({ ok: false, error: 'no pane nope' });
    await c.req({ op: 'killSession', name: opts.name });
    expect(await c.req({ op: 'hasSession', name: opts.name })).toMatchObject({ ok: true, value: false });
    const self = agent('process.exit(3)');
    await c.req({ op: 'newSession', opts: self });
    await until(async () => (await c.req({ op: 'exitCode', name: self.name }))!.value === 3);
  });

  it('answers on a pane that exits mid-request', async () => {
    const h = await host(); const c = client(h.path); await hello(c);
    const opts = agent('setTimeout(() => process.exit(0), 300)');
    await c.req({ op: 'newSession', opts });
    const t = Date.now();
    for (let i = 0; i < 40; i++) { const r = await c.req({ op: 'capture', name: opts.name, lines: 10 }); expect(r).toBeDefined(); }
    expect(Date.now() - t).toBeLessThan(8000);
  });

  it('attach streams the screen then the output, and input unless read-only', async () => {
    const h = await host(); const c = client(h.path); await hello(c);
    const opts = agent(ECHO);
    await c.req({ op: 'newSession', opts });
    await until(async () => String((await c.req({ op: 'capture', name: opts.name, lines: 20 }))!.value ?? '').includes('ready'));
    const a = client(h.path); await hello(a);
    expect(await a.req({ op: 'attach', name: opts.name, readOnly: false })).toMatchObject({ ok: true });
    await until(() => a.frames.some(f => f.attach === 'screen'));
    expect(String(a.frames.find(f => f.attach === 'screen')!.data)).toContain('ready');
    a.send({ input: 'typed\r' });
    await until(() => a.frames.some(f => f.attach === 'data' && String(f.data).includes('got:typed')));
    const r = client(h.path); await hello(r);
    await r.req({ op: 'attach', name: opts.name, readOnly: true });
    r.send({ input: 'ignored\r' });
    await new Promise(res => setTimeout(res, 500));
    expect(String((await c.req({ op: 'capture', name: opts.name, lines: 20 }))!.value)).not.toContain('got:ignored');
    await c.req({ op: 'killSession', name: opts.name });
    await until(() => a.frames.some(f => f.attach === 'end'));
    await until(() => a.closed());
  }, 20_000);

  it('exits when idle: no pane and no client for idleExitMs', async () => {
    const h = await host(300);
    const c = client(h.path); await hello(c);
    c.sock.end();
    await until(() => h.isClosed(), 3000);
  });
});
