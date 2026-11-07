// One HTTPS GET for the usage reader, through the corporate proxy the person's environment names (`https_proxy`, `no_proxy`),
// with the extra certificate authority Node is told about (`NODE_EXTRA_CA_CERTS`): Node's own request ignores all three
// unless it was started with them, and the daemon is usually started without (systemd).
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Socket } from 'node:net';
import { connect as tlsConnect, rootCertificates } from 'node:tls';
import { readFileSync } from 'node:fs';

export interface GetResult { status: number; body: string; headers: Record<string, string | string[] | undefined> }
/** A GET that never throws: `status` 0 when it did not get an answer (network, proxy, timeout), `error` then says why. */
export type HttpsGet = (url: string, headers: Record<string, string>, env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<GetResult & { error?: string }>;

const pick = (env: NodeJS.ProcessEnv, ...keys: string[]): string | undefined => {
  for (const k of keys) { const v = env[k]; if (v && v.trim()) return v.trim(); }
  return undefined;
};

/** Whether `no_proxy` exempts this host: `*`, an exact name, a domain suffix (`.example.com` or `example.com`). Ports are ignored. */
export function bypassProxy(host: string, noProxy: string | undefined): boolean {
  if (!noProxy) return false;
  const h = host.toLowerCase();
  for (const raw of noProxy.split(/[,\s]+/)) {
    const e = raw.trim().toLowerCase().replace(/:\d+$/, '');
    if (!e) continue;
    if (e === '*') return true;
    const d = e.startsWith('*.') ? e.slice(1) : e;
    if (h === d.replace(/^\./, '') || h.endsWith(d.startsWith('.') ? d : `.${d}`)) return true;
  }
  return false;
}

/** The proxy for an https URL, as curl reads the environment; null when none or bypassed. Only an http:// proxy is used. */
export function proxyFor(target: URL, env: NodeJS.ProcessEnv): URL | null {
  const p = pick(env, 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY');
  if (!p || bypassProxy(target.hostname, pick(env, 'no_proxy', 'NO_PROXY'))) return null;
  try {
    const u = new URL(p.includes('://') ? p : `http://${p}`);
    return u.protocol === 'http:' ? u : null;
  } catch { return null; }
}

/** A POST, the same way: `Content-Length` and the body are written, the answer is as bounded as the GET's. */
export type HttpsPost = (url: string, headers: Record<string, string>, body: string, env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<GetResult & { error?: string }>;

/** The certificate authorities: Node's, plus the file `NODE_EXTRA_CA_CERTS` names in the given environment (a proxy that
 *  inspects TLS signs with its own). Undefined: Node's default. */
function authorities(env: NodeJS.ProcessEnv): string[] | undefined {
  const file = pick(env, 'NODE_EXTRA_CA_CERTS');
  if (!file || file === process.env.NODE_EXTRA_CA_CERTS) return undefined; // already Node's, or none
  try { return [...rootCertificates, readFileSync(file, 'utf8')]; } catch { return undefined; }
}

const exchange = (method: 'GET' | 'POST', url: string, headers: Record<string, string>, body: string | undefined, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<GetResult & { error?: string }> => new Promise(resolve => {
  let done = false;
  /** What is open: closed once the answer is in, or on a failure, so nothing keeps the daemon's event loop busy. */
  const open: Array<{ destroy(): void }> = [];
  const finish = (r: GetResult & { error?: string }) => {
    if (done) return;
    done = true; clearTimeout(timer);
    for (const o of open) { try { o.destroy(); } catch { /* already closed */ } }
    resolve(r);
  };
  const fail = (error: string) => finish({ status: 0, body: '', headers: {}, error });
  const timer = setTimeout(() => fail('timeout'), timeoutMs);
  let target: URL;
  try { target = new URL(url); } catch { fail('bad url'); return; }
  const ca = authorities(env);
  const port = Number(target.port || 443);
  // Through the proxy, the request's TLS is opened on the tunnel's socket by the request itself: a socket handed over already
  // secured would leave it waiting for a `secureConnect` that has passed.
  const send = (tunnelled?: Socket) => {
    const req = httpsRequest({
      host: target.hostname, port, path: `${target.pathname}${target.search}`, method, headers: body === undefined ? headers : { ...Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'content-length')), 'Content-Length': String(Buffer.byteLength(body)) },
      // Node takes `createConnection` only without an agent (`agent: false` makes a fresh one, which would connect directly).
      ...(ca ? { ca } : {}), ...(tunnelled ? { createConnection: () => tlsConnect({ socket: tunnelled, servername: target.hostname, ...(ca ? { ca } : {}) }) } : { agent: false })
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size <= 1_000_000) chunks.push(c); });
      res.on('end', () => finish({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      res.on('error', e => fail(e.message));
    });
    open.push(req);
    req.on('error', e => fail(e.message));
    if (body === undefined) req.end(); else req.end(body);
  };
  const proxy = proxyFor(target, env);
  if (!proxy) { send(); return; }
  const auth = proxy.username ? { 'Proxy-Authorization': `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}` } : {};
  const tunnel = httpRequest({ host: proxy.hostname, port: Number(proxy.port || 80), method: 'CONNECT', path: `${target.hostname}:${port}`, headers: { Host: `${target.hostname}:${port}`, ...auth }, agent: false });
  open.push(tunnel);
  tunnel.on('connect', (res, socket) => {
    open.push(socket);
    if (res.statusCode !== 200) { fail(`proxy answered ${res.statusCode}`); return; }
    send(socket);
  });
  tunnel.on('error', e => fail(`proxy: ${e.message}`));
  tunnel.end();
});

export const httpsGet: HttpsGet = (url, headers, env, timeoutMs) => exchange('GET', url, headers, undefined, env, timeoutMs);
export const httpsPost: HttpsPost = (url, headers, body, env, timeoutMs) => exchange('POST', url, headers, body, env, timeoutMs);
