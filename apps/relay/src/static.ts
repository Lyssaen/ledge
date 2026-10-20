import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { RelayLog } from './log.js';
import type { HttpHandler } from './server.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
};

/** `connect-src` names the public origin's websocket; without a public URL (dev), 'self' covers the same origin. */
function connectSrc(publicUrl: string | undefined): string {
  if (!publicUrl) return "'self'";
  const u = new URL(publicUrl);
  return `'self' ${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`;
}

/**
 * Serves the phone PWA's files (GET/HEAD only) from `root`, read on demand. A path without an extension is a client
 * route and answers `index.html`. `/auth/*` and `/healthz` are not ours: they are declined (false).
 */
export function staticRoutes(opts: { root: string; publicUrl?: string; log: RelayLog }): HttpHandler {
  const root = path.resolve(opts.root);
  const base: Record<string, string> = {
    'Content-Security-Policy':
      `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; ` +
      `connect-src ${connectSrc(opts.publicUrl)}; worker-src 'self'; manifest-src 'self'; ` +
      `frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  };
  const reply = (res: ServerResponse, status: number, headers: Record<string, string | number> = {}, body?: Buffer) => {
    res.writeHead(status, { ...base, ...headers });
    res.end(body);
  };
  const notFound = (res: ServerResponse) => reply(res, 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, Buffer.from('not found'));

  return async (req, res) => {
    // The raw path: `new URL` would fold `/%2e%2e/` away before it could be refused.
    const pathname = (req.url ?? '/').split(/[?#]/, 1)[0] || '/';
    if (!pathname.startsWith('/')) { notFound(res); return true; }
    if (pathname === '/healthz' || pathname === '/auth' || pathname.startsWith('/auth/')) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      reply(res, 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, Buffer.from('method not allowed'));
      return true;
    }
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { notFound(res); return true; }
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) { notFound(res); return true; }
    let rel = decoded === '/' ? '/index.html' : decoded;
    if (path.extname(rel) === '') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + path.sep)) { notFound(res); return true; }
    const ext = path.extname(file);
    const type = MIME[ext];
    if (!type) { notFound(res); return true; }
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'EISDIR' && code !== 'ENOTDIR') opts.log({ ev: 'http_error' });
      notFound(res);
      return true;
    }
    const immutable = rel.startsWith('/assets/');
    reply(res, 200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
    }, req.method === 'HEAD' ? undefined : data);
    return true;
  };
}

/** Tries each handler in order; the first to answer true wins. */
export function chain(...handlers: HttpHandler[]): HttpHandler {
  return async (req, res, relay) => {
    for (const h of handlers) if (await h(req, res, relay)) return true;
    return false;
  };
}
