import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { MOBILE_BASE } from '@ledge/protocol';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

/** The headers every answer carries: the page may talk only to its own origin, and nothing may frame it. */
function securityHeaders(origin: string): Record<string, string> {
  const host = new URL(origin).host;
  return {
    'Content-Security-Policy': `default-src 'self'; connect-src 'self' wss://${host}; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  };
}

/**
 * The file a `/m/...` path names inside `dir`, or null. Decoded once, then refused if any segment is empty, a dot
 * segment, hidden, or holds a separator or NUL; the resolved path must still be inside `dir`.
 */
function fileFor(dir: string, pathname: string): string | null {
  let rel: string;
  try { rel = decodeURIComponent(pathname.slice(MOBILE_BASE.length)); } catch { return null; }
  if (rel === '') rel = 'index.html';
  const parts = rel.split('/');
  if (parts.some(p => p === '' || p.startsWith('.') || p.includes('\\') || p.includes('\0'))) return null;
  const root = resolve(dir);
  const file = resolve(root, ...parts);
  return file.startsWith(root + sep) ? file : null;
}

function cacheFor(rel: string): Record<string, string> {
  if (rel === 'sw.js') return { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': MOBILE_BASE };
  if (rel.startsWith('assets/')) return { 'Cache-Control': 'public, max-age=31536000, immutable' };
  return { 'Cache-Control': 'no-cache' };
}

/**
 * Serves the PWA built into `dir` (decision D12): `GET`/`HEAD` on `/m/` and `/m/<file>`, `/` redirects to `/m/`,
 * everything else is 404. `origin` is the configured https origin, the only socket the page may open.
 */
export function serveMobile(req: IncomingMessage, res: ServerResponse, dir: string, origin: string): void {
  serve(req, res, dir, origin).catch(() => { if (res.headersSent) res.destroy(); else { res.writeHead(500, securityHeaders(origin)); res.end(); } });
}

async function serve(req: IncomingMessage, res: ServerResponse, dir: string, origin: string): Promise<void> {
  const headers = securityHeaders(origin);
  const end = (status: number, body: string, extra: Record<string, string> = {}) => {
    res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') return end(404, 'Not found');
  let pathname: string;
  try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; } catch { return end(404, 'Not found'); }
  if (pathname === '/') return end(302, 'Found', { Location: MOBILE_BASE });
  if (!pathname.startsWith(MOBILE_BASE)) return end(404, 'Not found');
  try { if (!(await stat(dir)).isDirectory()) throw new Error('not a directory'); }
  catch { return end(503, 'PWA not built'); }
  const file = fileFor(dir, pathname);
  if (!file) return end(404, 'Not found');
  let body: Buffer;
  try {
    if (!(await stat(file)).isFile()) return end(404, 'Not found');
    body = await readFile(file);
  } catch { return end(404, 'Not found'); }
  const rel = file.slice(resolve(dir).length + 1).split(sep).join('/');
  res.writeHead(200, {
    ...headers,
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': String(body.length),
    ...cacheFor(rel)
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}
