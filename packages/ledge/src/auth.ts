import { execFile } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import { dirname } from 'node:path';
import { paths } from './paths.js';

/** 32 random bytes, hex. The file keeps a trailing newline; comparisons use the trimmed token. */
const TOKEN_RE = /^[0-9a-f]{64}$/;
/** Subprotocol the browser WebSocket API can send, because it cannot set Authorization. */
export const DAEMON_PROTOCOL_PREFIX = 'ledge.';

export function isDaemonToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

/**
 * Compares two tokens without leaking the expected value through an early length check.
 * SHA-256 both sides first: `timingSafeEqual` throws on different lengths, which would itself be a signal.
 */
export function tokenEquals(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented.slice(0, 256), 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** Loopback names only, so a DNS-rebinding page cannot present a public Host that resolves to this process. */
export function hostAllowed(hostHeader: string | string[] | undefined): boolean {
  const raw = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!raw || raw.length > 255) return false;
  const host = raw.trim().toLowerCase();
  if (!host || host.includes(' ') || host.endsWith('.')) return false;
  let name: string;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end < 0) return false;
    name = host.slice(1, end);
    const rest = host.slice(end + 1);
    if (rest !== '' && !/^:\d{1,5}$/.test(rest)) return false;
  } else {
    const colon = host.lastIndexOf(':');
    if (colon >= 0) {
      if (!/^\d{1,5}$/.test(host.slice(colon + 1))) return false;
      name = host.slice(0, colon);
    } else name = host;
  }
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

function headerValue(value: string | string[] | undefined, max: number): string {
  const raw = Array.isArray(value) ? value.join(',') : value;
  return !raw || raw.length > max ? '' : raw;
}

function bearerToken(authorization: string | undefined): string {
  if (!authorization || authorization.length > 512) return '';
  return /^Bearer[ \t]+(\S+)$/i.exec(authorization)?.[1] ?? '';
}

function protocolToken(header: string | string[] | undefined): string {
  const raw = headerValue(header, 512);
  if (!raw) return '';
  for (const part of raw.split(',').slice(0, 8)) {
    const protocol = part.trim();
    if (protocol.startsWith(DAEMON_PROTOCOL_PREFIX)) return protocol.slice(DAEMON_PROTOCOL_PREFIX.length);
  }
  return '';
}

/** True when Authorization or a `ledge.<token>` subprotocol matches. Either channel is enough. */
export function requestAuthorized(headers: IncomingHttpHeaders, expected: string): boolean {
  const bearerOk = tokenEquals(bearerToken(typeof headers.authorization === 'string' ? headers.authorization : undefined), expected);
  const presented = protocolToken(headers['sec-websocket-protocol']);
  return bearerOk || (presented !== '' && tokenEquals(presented, expected));
}

/** The subprotocol to echo. A client that offered none (the CLI) continues without one. */
export function selectDaemonProtocol(protocols: Set<string>, expected: string): string | false {
  for (const protocol of protocols) {
    if (protocol.startsWith(DAEMON_PROTOCOL_PREFIX) && tokenEquals(protocol.slice(DAEMON_PROTOCOL_PREFIX.length), expected)) return protocol;
  }
  return false;
}

async function readTokenFile(file: string): Promise<string | undefined> {
  try {
    const raw = (await readFile(file, 'utf8')).trim();
    return isDaemonToken(raw) ? raw : undefined;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

/** Mode 0600 on Unix. On Windows, drop inherited ACEs and leave only the current user read/write. */
async function lockTokenFile(file: string): Promise<void> {
  await chmod(file, 0o600);
  if (process.platform !== 'win32') return;
  const user = process.env.USERNAME;
  if (!user) throw new Error('USERNAME is not set; cannot restrict the daemon token');
  await new Promise<void>((resolve, reject) => {
    execFile('icacls', [file, '/inheritance:r', '/grant:r', `${user}:(R,W)`], { windowsHide: true }, err => {
      if (err) reject(new Error('could not restrict the daemon token to the current user'));
      else resolve();
    });
  });
}

/**
 * Creates `~/.ledge/token` on first start and returns it. A later start keeps the same secret and
 * tightens the mode again. Two daemons starting together publish one file; the loser reads the winner.
 */
export async function ensureDaemonToken(): Promise<string> {
  const file = paths().token;
  await mkdir(dirname(file), { recursive: true });
  const current = await readTokenFile(file);
  if (current) { await lockTokenFile(file); return current; }
  const token = randomBytes(32).toString('hex');
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, `${token}\n`, { mode: 0o600, flag: 'wx' });
  await chmod(tmp, 0o600);
  try {
    await link(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const raced = await readTokenFile(file);
    if (raced) { await lockTokenFile(file); return raced; }
    await writeFile(file, `${token}\n`, { mode: 0o600 });
  }
  await unlink(tmp).catch(() => {});
  await lockTokenFile(file);
  const stored = await readTokenFile(file);
  if (!stored) throw new Error('daemon token was not stored');
  return stored;
}

/** The token file, or undefined when the daemon has never started in this LEDGE_HOME. */
export function readDaemonToken(): string | undefined {
  try {
    const raw = readFileSync(paths().token, 'utf8').trim();
    return isDaemonToken(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}
