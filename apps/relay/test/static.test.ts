import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RelayLogEvent } from '../src/log.js';
import { createRelay } from '../src/server.js';
import { chain, staticRoutes } from '../src/static.js';

let dir: string;
let relay: ReturnType<typeof createRelay> | undefined;
let events: RelayLogEvent[];

beforeEach(() => {
  events = [];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledge-static-'));
  fs.mkdirSync(path.join(dir, 'root', 'assets'), { recursive: true });
  const root = path.join(dir, 'root');
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>x</title>');
  fs.writeFileSync(path.join(root, 'sw.js'), '//sw');
  fs.writeFileSync(path.join(root, 'build.json'), '{}');
  fs.writeFileSync(path.join(root, 'manifest.webmanifest'), '{}');
  fs.writeFileSync(path.join(root, 'assets', 'app-abc123.js'), '//app');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"secret":true}');
});
afterEach(async () => {
  await relay?.close();
  relay = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function start(publicUrl: string | null = 'https://relay.example'): Promise<number> {
  const handler = staticRoutes({ root: path.join(dir, 'root'), ...(publicUrl ? { publicUrl } : {}), log: (e) => events.push(e) });
  relay = createRelay({ authenticator: { authenticate: async () => null }, http: handler, log: (e) => events.push(e) });
  await new Promise<void>((res) => relay!.server.listen(0, '127.0.0.1', res));
  return (relay.server.address() as AddressInfo).port;
}

/** Raw request, so that `..` and `%2e%2e` reach the server unnormalised. */
function get(port: number, p: string, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method }, (r) => {
      let body = '';
      r.on('data', (c) => (body += c));
      r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('staticRoutes', () => {
  it.each(['/', '/index.html', '/?signin=ok', '/thread', '/a/b'])('serves index.html for %s', async (p) => {
    const port = await start();
    const r = await get(port, p);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.body).toContain('<title>x</title>');
  });

  it('answers 404 for a missing file with an extension', async () => {
    const port = await start();
    expect((await get(port, '/nope.js')).status).toBe(404);
  });

  it('answers 404 for traversal paths, reading nothing outside root', async () => {
    const port = await start();
    for (const p of ['/../package.json', '/%2e%2e/x', '/%2e%2e/package.json', '/assets/%00', '/assets/..%2f..%2fpackage.json', '/..%5cpackage.json', '/assets/../../package.json']) {
      const r = await get(port, p);
      expect(r.status, p).toBe(404);
      expect(r.body).not.toContain('secret');
    }
  });

  it('answers 405 to POST', async () => {
    const port = await start();
    const r = await get(port, '/', 'POST');
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe('GET, HEAD');
  });

  it('answers HEAD without a body', async () => {
    const port = await start();
    const r = await get(port, '/', 'HEAD');
    expect(r.status).toBe(200);
    expect(r.body).toBe('');
  });

  it.each(['/sw.js', '/index.html', '/build.json', '/manifest.webmanifest'])('%s is no-cache', async (p) => {
    const port = await start();
    expect((await get(port, p)).headers['cache-control']).toBe('no-cache');
  });

  it('caches assets for a year, immutable', async () => {
    const port = await start();
    const r = await get(port, '/assets/app-abc123.js');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
  });

  it('puts the CSP and hardening headers on every response', async () => {
    const port = await start();
    const csp =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss://relay.example; " +
      "worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    for (const [p, m] of [['/', 'GET'], ['/nope.js', 'GET'], ['/', 'POST'], ['/assets/app-abc123.js', 'GET']] as const) {
      const r = await get(port, p, m);
      expect(r.headers['content-security-policy']).toBe(csp);
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
    }
  });

  it('names ws for an http public URL, and only self without one', async () => {
    let port = await start('http://localhost:8787');
    expect((await get(port, '/')).headers['content-security-policy']).toContain("connect-src 'self' ws://localhost:8787;");
    await relay!.close();
    port = await start(null);
    expect((await get(port, '/')).headers['content-security-policy']).toContain("connect-src 'self'; worker-src");
  });

  it('does not log the path of a 404', async () => {
    const port = await start();
    await get(port, '/secret-path-xyz.js');
    expect(JSON.stringify(events)).not.toContain('secret-path-xyz');
  });

  it('declines /healthz and /auth/*', async () => {
    const port = await start();
    expect((await get(port, '/healthz')).body).toBe('ok');
    expect((await get(port, '/auth/me')).status).toBe(404);
  });
});

describe('chain', () => {
  it('stops at the first handler that answers', async () => {
    const calls: string[] = [];
    const h = chain(
      async () => { calls.push('a'); return false; },
      async (_q, res) => { calls.push('b'); res.end('b'); return true; },
      async () => { calls.push('c'); return true; }
    );
    relay = createRelay({ authenticator: { authenticate: async () => null }, http: h });
    await new Promise<void>((res) => relay!.server.listen(0, '127.0.0.1', res));
    const r = await get((relay.server.address() as AddressInfo).port, '/x');
    expect(r.body).toBe('b');
    expect(calls).toEqual(['a', 'b']);
  });
});
