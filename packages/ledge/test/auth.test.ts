import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { connect as tcp } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, statSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { ensureDaemonToken, hostAllowed, isDaemonToken, readDaemonToken, tokenEquals } from '../src/auth.js';
import { ensureLedgeDir, paths } from '../src/paths.js';
import { startServer } from '../src/daemon/server.js';
import { connect } from '../src/client.js';
import { Store } from '../src/daemon/store.js';
import type { Tmux } from '../src/tmux.js';

const tmux = { async setOption() {}, async sendText() {}, async sendKeys() {}, async capture() { return null; }, async hasSession() { return false; }, async listSessions() { return []; }, async killSession() {}, async newSession() {}, attachArgs: () => [] } as Tmux;

function rawHttp(port: number, head: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = tcp({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('timeout')); }, 1000);
    let data = '';
    sock.on('data', chunk => {
      data += chunk.toString('latin1');
      if (data.includes('\r\n\r\n')) { clearTimeout(timer); sock.destroy(); resolve(data); }
    });
    sock.on('error', err => { clearTimeout(timer); reject(err); });
    sock.on('connect', () => sock.write(head));
  });
}

function upgrade(port: number, headers: string): Promise<string> {
  return rawHttp(port, `GET / HTTP/1.1\r\n${headers}Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
}

describe('daemon token file', () => {
  beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-auth-')); });

  it('lives under LEDGE_HOME and is not created with the rest of the directory', async () => {
    expect(paths().token).toBe(join(process.env.LEDGE_HOME!, 'token'));
    await ensureLedgeDir();
    expect(existsSync(paths().token)).toBe(false);
  });

  it('creates 32 random bytes, mode 0600, and keeps them across restarts', async () => {
    const prev = process.umask(0);
    try {
      const token = await ensureDaemonToken();
      expect(isDaemonToken(token)).toBe(true);
      expect(statSync(paths().token).mode & 0o777).toBe(0o600);
      expect(readFileSync(paths().token, 'utf8').trim()).toBe(token);
      expect(readDaemonToken()).toBe(token);
      expect(await ensureDaemonToken()).toBe(token);
    } finally { process.umask(prev); }
  });

  it('tightens a loose file without replacing a valid token, and replaces junk', async () => {
    const kept = 'ab'.repeat(32);
    writeFileSync(paths().token, `${kept}\n`, { mode: 0o644 });
    expect(await ensureDaemonToken()).toBe(kept);
    expect(statSync(paths().token).mode & 0o777).toBe(0o600);
    writeFileSync(paths().token, 'not-a-token\n', { mode: 0o644 });
    const replaced = await ensureDaemonToken();
    expect(replaced).not.toBe(kept);
    expect(isDaemonToken(replaced)).toBe(true);
    expect(statSync(paths().token).mode & 0o777).toBe(0o600);
  });
});

describe('token comparison and host', () => {
  const token = 'cd'.repeat(32);
  it('matches only the same string, including when the lengths differ', () => {
    expect(tokenEquals(token, token)).toBe(true);
    expect(tokenEquals(`${token} `, token)).toBe(false);
    expect(tokenEquals(token.slice(0, 63), token)).toBe(false);
    expect(tokenEquals('', token)).toBe(false);
    expect(tokenEquals(token.toUpperCase(), token)).toBe(false);
  });
  it('accepts only loopback names, with an optional port', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.0.0.1:47831', '[::1]', '[::1]:47831']) expect(hostAllowed(host)).toBe(true);
    for (const host of [undefined, '', 'evil.example', 'evil.example:47831', '127.0.0.1.evil.example', 'localhost.', 'localhost:abc', '0.0.0.0', '[::1', '127.0.0.1:47831:80']) expect(hostAllowed(host)).toBe(false);
  });
});

describe('daemon handshake', () => {
  let srv: Awaited<ReturnType<typeof startServer>>;
  beforeEach(async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-auth-'));
    srv = await startServer({ store: new Store(), tmux, port: 0 });
  });
  afterEach(async () => { await srv.close(); });

  it('requires the token on the bearer header or the ledge subprotocol', async () => {
    const token = readDaemonToken()!;
    const client = await connect({ port: srv.port });
    expect((await client.next('snapshot')).type).toBe('snapshot');
    await client.close();
    await expect(connect({ port: srv.port, token: null, timeoutMs: 500 })).rejects.toThrow(/401/);
    await expect(connect({ port: srv.port, token: '0'.repeat(64), timeoutMs: 500 })).rejects.toThrow(/401/);
    const asProtocol = new WebSocket(`ws://127.0.0.1:${srv.port}`, [`ledge.${token}`]);
    await new Promise<void>((resolve, reject) => { asProtocol.once('open', () => resolve()); asProtocol.once('error', reject); });
    asProtocol.terminate();
    const wrongProtocol = new WebSocket(`ws://127.0.0.1:${srv.port}`, [`ledge.${'0'.repeat(64)}`]);
    const wrongStatus = await new Promise<number>(resolve => {
      wrongProtocol.once('unexpected-response', (_q, res) => { resolve(res.statusCode ?? 0); res.resume(); });
      wrongProtocol.once('open', () => resolve(101));
      wrongProtocol.once('error', () => {});
    });
    expect(wrongStatus).toBe(401);
    const query = new WebSocket(`ws://127.0.0.1:${srv.port}/?token=${token}`);
    const queryStatus = await new Promise<number>(resolve => {
      query.once('unexpected-response', (_q, res) => { resolve(res.statusCode ?? 0); res.resume(); });
      query.once('open', () => resolve(101));
      query.once('error', () => {});
    });
    expect(queryStatus).toBe(401);
  });

  it('rejects a bad origin or host even when the token is valid, and never sends CORS headers', async () => {
    const token = readDaemonToken()!;
    const auth = `Authorization: Bearer ${token}\r\n`;
    const ok = await upgrade(srv.port, `Host: 127.0.0.1:${srv.port}\r\n${auth}`);
    expect(ok.startsWith('HTTP/1.1 101')).toBe(true);
    expect(ok.toLowerCase()).not.toContain('access-control-allow-origin');
    const evilHost = await upgrade(srv.port, `Host: evil.example\r\n${auth}`);
    expect(evilHost.startsWith('HTTP/1.1 401')).toBe(true);
    expect(evilHost.toLowerCase()).not.toContain('access-control-allow-origin');
    const evilOrigin = await upgrade(srv.port, `Host: 127.0.0.1:${srv.port}\r\nOrigin: https://evil.example\r\n${auth}`);
    expect(evilOrigin.startsWith('HTTP/1.1 401')).toBe(true);
    const missingHost = await upgrade(srv.port, auth);
    expect(missingHost).toMatch(/^HTTP\/1\.1 (400|401) /);
    const allowed = await upgrade(srv.port, `Host: localhost:${srv.port}\r\nOrigin: tauri://localhost\r\n${auth}`);
    expect(allowed.startsWith('HTTP/1.1 101')).toBe(true);
    const page = await upgrade(srv.port, `Host: 127.0.0.1:${srv.port}\r\nOrigin: http://localhost:1420\r\n`);
    expect(page.startsWith('HTTP/1.1 401')).toBe(true);
    const log = readFileSync(paths().log, 'utf8');
    expect(log).not.toContain(token);
    expect(log).toContain('refused a connection');
  });

  it('answers plain HTTP with 401 and no permissive CORS', async () => {
    const token = readDaemonToken()!;
    for (const method of ['GET', 'OPTIONS']) {
      const res = await new Promise<{ status: number; allow: string | undefined }>((resolve, reject) => {
        const req = request({
          host: '127.0.0.1', port: srv.port, method, path: '/',
          headers: { Origin: 'https://evil.example', Authorization: `Bearer ${token}`, 'Access-Control-Request-Method': 'GET' }
        }, response => { response.resume(); resolve({ status: response.statusCode ?? 0, allow: response.headers['access-control-allow-origin'] as string | undefined }); });
        req.on('error', reject);
        req.end();
      });
      expect(res.status).toBe(401);
      expect(res.allow).toBeUndefined();
    }
  });
});
