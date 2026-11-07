import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect as netConnect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { httpsGet, httpsPost } from '../src/daemon/usage/net.js';

// The usage reader's GET through a corporate proxy, for real on 127.0.0.1: a CONNECT proxy, a TLS server with its own certificate
// authority (as a TLS-inspecting proxy has), and the daemon's code between them. No outside network.
let dir = '', tlsPort = 0, proxyPort = 0;
let tls: Server, proxy: Server;
const connects: string[] = [];
/** The tunnels' sockets: a CONNECT hands them over, so the server no longer closes them itself. */
const sockets: Array<{ destroy(): void }> = [];
let refuse = false;
const openssl = (() => { try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

beforeAll(async () => {
  if (!openssl) return;
  dir = mkdtempSync(join(tmpdir(), 'ledge-net-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  tls = createHttpsServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
    res.setHeader('content-type', 'application/json');
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => res.end(JSON.stringify({ path: req.url, auth: req.headers.authorization ?? null, ua: req.headers['user-agent'] ?? null, method: req.method, body: Buffer.concat(chunks).toString('utf8'), length: req.headers['content-length'] ?? null, ct: req.headers['content-type'] ?? null })));
  });
  await new Promise<void>(r => tls.listen(0, '127.0.0.1', () => r()));
  tlsPort = (tls.address() as AddressInfo).port;
  proxy = createHttpServer();
  proxy.on('connect', (req, client) => {
    connects.push(req.url ?? '');
    sockets.push(client);
    if (refuse) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const up = netConnect(tlsPort, '127.0.0.1', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.pipe(client); client.pipe(up); });
    sockets.push(up);
    up.on('error', () => client.destroy());
  });
  await new Promise<void>(r => proxy.listen(0, '127.0.0.1', () => r()));
  proxyPort = (proxy.address() as AddressInfo).port;
});
afterAll(async () => { if (!openssl) return; for (const s of sockets) s.destroy(); tls.closeAllConnections?.(); proxy.closeAllConnections?.(); await new Promise(r => tls.close(r)); await new Promise(r => proxy.close(r)); });

describe.skipIf(!openssl)('httpsGet', () => {
  it('goes through the proxy\'s CONNECT tunnel, trusting the extra authority the environment names, headers intact', async () => {
    const env = { https_proxy: `http://127.0.0.1:${proxyPort}`, NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem'), no_proxy: 'example.org' };
    const r = await httpsGet(`https://localhost:${tlsPort}/api/oauth/usage`, { Authorization: 'Bearer t', 'User-Agent': 'claude-code/2.1.318' }, env, 5000);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ path: '/api/oauth/usage', auth: 'Bearer t', ua: 'claude-code/2.1.318', method: 'GET' });
    expect(connects.at(-1)).toBe(`localhost:${tlsPort}`);
  });

  it('no_proxy goes direct; a proxy that refuses, or an authority it does not know, is a failure that says why, never a hang', async () => {
    const before = connects.length;
    const direct = await httpsGet(`https://localhost:${tlsPort}/x`, {}, { https_proxy: `http://127.0.0.1:${proxyPort}`, no_proxy: 'localhost', NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem') }, 5000);
    expect(direct.status).toBe(200);
    expect(connects.length).toBe(before);
    refuse = true;
    const refused = await httpsGet(`https://localhost:${tlsPort}/x`, {}, { https_proxy: `http://127.0.0.1:${proxyPort}`, NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem') }, 5000);
    refuse = false;
    expect(refused).toMatchObject({ status: 0, error: 'proxy answered 403' });
    const untrusted = await httpsGet(`https://localhost:${tlsPort}/x`, {}, { https_proxy: `http://127.0.0.1:${proxyPort}` }, 5000);
    expect(untrusted.status).toBe(0);
    expect(untrusted.error).toMatch(/certificate/i);
  });
});

describe.skipIf(!openssl)('a header the request refuses', () => {
  it('through the proxy it is a failed read that says why, never a throw out of the tunnel', async () => {
    const env = { https_proxy: `http://127.0.0.1:${proxyPort}`, NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem') };
    const r = await httpsPost(`https://localhost:${tlsPort}/rpc`, { Authorization: 'Bearer a\nb' }, '{}', env, 5000);
    expect(r.status).toBe(0);
    expect(r.error).toBeTruthy();
    const g = await httpsGet(`https://localhost:${tlsPort}/rpc`, { Authorization: 'Bearer a\nb' }, env, 5000);
    expect(g.status).toBe(0);
    expect(g.error).toBeTruthy();
  });
});

describe.skipIf(!openssl)('httpsPost', () => {
  const headers = { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' };
  it('sends the method, the body and its length, and the headers, directly', async () => {
    const r = await httpsPost(`https://localhost:${tlsPort}/rpc`, headers, '{}', { NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem') }, 5000);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ path: '/rpc', method: 'POST', body: '{}', length: '2', auth: 'Bearer t', ct: 'application/json' });
  });

  it('computes its own Content-Length, whatever case the caller gave one in', async () => {
    const r = await httpsPost(`https://localhost:${tlsPort}/rpc`, { ...headers, 'content-length': '999' }, '{}', { NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem') }, 5000);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ body: '{}', length: '2' });
  });

  it('goes through the proxy\'s CONNECT tunnel as the GET does', async () => {
    const env = { https_proxy: `http://127.0.0.1:${proxyPort}`, NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem') };
    const before = connects.length;
    const r = await httpsPost(`https://localhost:${tlsPort}/rpc`, headers, '{}', env, 5000);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ method: 'POST', body: '{}', length: '2' });
    expect(connects.length).toBe(before + 1);
    expect(connects.at(-1)).toBe(`localhost:${tlsPort}`);
  });
});
