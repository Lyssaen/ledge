import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDaemonToken, hostAllowed, readDaemonToken, requestAuthorized, selectDaemonProtocol, tokenEquals } from '../src/auth.js';
import { paths } from '../src/paths.js';
import WebSocket from 'ws';
import { startServer } from '../src/daemon/server.js';
import { connect } from '../src/client.js';
import { Store } from '../src/daemon/store.js';
import type { Tmux } from '../src/tmux.js';
import { authHeaders } from './helpers.js';


describe('daemon token file', () => {
  beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-auth-')); });

  it('creates a 0600 token of 64 hex chars', async () => {
    await ensureDaemonToken();
    expect(statSync(paths().token).mode & 0o777).toBe(0o600);
    expect(readFileSync(paths().token, 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
  });

  it('keeps the same secret across starts', async () => {
    expect(await ensureDaemonToken()).toBe(await ensureDaemonToken());
  });

  it('replaces a malformed file', async () => {
    writeFileSync(paths().token, 'nope\n');
    const token = await ensureDaemonToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toBe('nope');
  });

  it('two concurrent starts publish one secret', async () => {
    const [a, b] = await Promise.all([ensureDaemonToken(), ensureDaemonToken()]);
    expect(a).toBe(b);
    expect(readFileSync(paths().token, 'utf8').trim()).toBe(a);
  });

  it('reads nothing from a bad file', () => {
    expect(readDaemonToken()).toBeUndefined();
    writeFileSync(paths().token, '');
    expect(readDaemonToken()).toBeUndefined();
    writeFileSync(paths().token, `${'a'.repeat(63)}\n`);
    expect(readDaemonToken()).toBeUndefined();
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-auth-'));
    mkdirSync(paths().token);
    expect(readDaemonToken()).toBeUndefined();
  });
});

describe('token comparison, host and request', () => {
  const t = 'cd'.repeat(32);

  it('compares tokens', () => {
    expect(tokenEquals(t, t)).toBe(true);
    expect(tokenEquals(t.slice(1), t)).toBe(false);
    expect(tokenEquals('', t)).toBe(false);
    expect(tokenEquals('x'.repeat(10_000), t)).toBe(false);
  });

  it('accepts loopback hosts only', () => {
    for (const h of ['localhost', '127.0.0.1:47831', '[::1]:47831', 'LOCALHOST']) expect(hostAllowed(h)).toBe(true);
    for (const h of [undefined, '', 'evil.example', '127.0.0.1.evil.example', 'localhost.', '[::1]x', '127.0.0.1:abc']) expect(hostAllowed(h)).toBe(false);
  });

  it('authorizes Bearer or subprotocol', () => {
    expect(requestAuthorized({ authorization: `Bearer ${t}` }, t)).toBe(true);
    expect(requestAuthorized({ 'sec-websocket-protocol': `ledge.${t}` }, t)).toBe(true);
    expect(requestAuthorized({ 'sec-websocket-protocol': `other, ledge.${t}` }, t)).toBe(true);
    expect(requestAuthorized({ authorization: 'Bearer wrong' }, t)).toBe(false);
    expect(requestAuthorized({ 'sec-websocket-protocol': 'ledge.wrong' }, t)).toBe(false);
    expect(requestAuthorized({}, t)).toBe(false);
  });

  it('echoes only the matching subprotocol', () => {
    expect(selectDaemonProtocol(new Set([`ledge.${t}`]), t)).toBe(`ledge.${t}`);
    expect(selectDaemonProtocol(new Set(['ledge.wrong']), t)).toBe(false);
    expect(selectDaemonProtocol(new Set(['other']), t)).toBe(false);
  });
});

const fakeTmux = { async setOption() {}, async sendText() {}, async sendKeys() {}, async capture() { return null; }, async hasSession() { return false; }, async listSessions() { return []; }, async killSession() {}, async newSession() {}, attachArgs: () => [] } as unknown as Tmux;

describe('handshake', () => {
  let srv: Awaited<ReturnType<typeof startServer>>;
  let url: string;
  const other = 'ab'.repeat(32);
  beforeEach(async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-auth-'));
    srv = await startServer({ store: new Store(), tmux: fakeTmux, port: 0, ssh: async () => {} });
    url = `ws://127.0.0.1:${srv.port}`;
  });
  afterEach(async () => { await srv.close(); });

  /** 'open', or the HTTP status of the refusal. */
  const attempt = (target: string, protocols?: string[], options: WebSocket.ClientOptions = {}) => new Promise<'open' | number>(res => {
    const ws = new WebSocket(target, protocols as string[], options);
    ws.once('open', () => { ws.terminate(); res('open'); });
    ws.once('unexpected-response', (_q, r) => { res(r.statusCode ?? 0); r.resume(); ws.terminate(); });
    ws.once('error', () => {});
  });
  const bearer = (t = readDaemonToken()!) => ({ headers: { authorization: `Bearer ${t}` } });

  it('refuses no token', async () => { expect(await attempt(url)).toBe(401); });
  it('refuses a wrong token', async () => { expect(await attempt(url, undefined, bearer(other))).toBe(401); });
  it('accepts Bearer', async () => { expect(await attempt(url, undefined, bearer())).toBe('open'); });
  it('accepts the subprotocol and echoes it', async () => {
    const t = readDaemonToken()!;
    const ws = new WebSocket(url, ['ledge.' + t], { origin: 'tauri://localhost' });
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    expect(ws.protocol).toBe('ledge.' + t);
    ws.terminate();
  });
  it('refuses a foreign Host', async () => {
    expect(await attempt(url, undefined, { headers: { ...bearer().headers, host: 'evil.example:47831' } })).toBe(401);
  });
  it('refuses an unknown Origin', async () => {
    expect(await attempt(url, undefined, { ...bearer(), origin: 'https://evil.example' })).toBe(401);
  });
  it('ignores a token in the query', async () => {
    expect(await attempt(`${url}/?token=${readDaemonToken()}`)).toBe(401);
  });
  it('answers plain HTTP with 401 and no CORS', async () => {
    const res = await fetch(`http://127.0.0.1:${srv.port}/`, { headers: { origin: 'tauri://localhost' } });
    expect(res.status).toBe(401);
    expect([...res.headers.keys()].filter(k => k.startsWith('access-control-'))).toEqual([]);
  });
  it('opens /ssh/<alias> with the token only', async () => {
    expect(await attempt(`${url}/ssh/server`, undefined, bearer())).toBe('open');
    expect(await attempt(`${url}/ssh/server`)).toBe(401);
  });
  it('logs why, never the token', async () => {
    await attempt(url, undefined, bearer(other));
    await new Promise(r => setTimeout(r, 50));
    const log = readFileSync(paths().log, 'utf8');
    expect(log).toContain('refused a connection (auth)');
    expect(log).not.toContain(other);
    expect(log).not.toContain(readDaemonToken()!);
  });
  it('connect() reads the file', async () => {
    const c = await connect({ port: srv.port });
    await c.close();
    await expect(connect({ port: srv.port, token: null })).rejects.toThrow();
  });
  it('authHeaders() carries the file token', () => {
    expect(authHeaders()).toEqual({ authorization: `Bearer ${readDaemonToken()}` });
  });
});
