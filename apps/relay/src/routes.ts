import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  RELAY_CLOSE_SIGNED_OUT,
  RELAY_SESSION_COOKIE,
  type DevicePollResponse,
  type DeviceStartResponse,
  type MeResponse
} from '@ledge/protocol';
import { sessionOf, type AccountsDeps } from './accounts.js';
import { parseCookies, setCookie } from './cookies.js';
import { GitHubError, type GitHub } from './github.js';
import { countedLog, type RelayLogEvent } from './log.js';
import type { HttpHandler } from './server.js';
import { hashToken, newDevicePeer, newOpaque, newSessionToken } from './tokens.js';

const MAX_BODY = 4096;
const DEFAULT_MAX_GITHUB_CALLS = 16;
const STATE_COOKIE = 'ledge_oauth_state';
const STATE_PATH = '/auth/github';
const STATE_MAX_AGE_S = 600;

/** Equal only if both strings are; compares fixed-length digests so lengths neither throw nor leak. */
function sameSecret(a: string, b: string): boolean {
  const d = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(d(a), d(b));
}

type SignInRefused = Extract<RelayLogEvent, { ev: 'sign_in_refused' }>;

/** Thrown inside a route; answered with a fixed JSON body. Never carries request or GitHub content. */
class Answer extends Error {
  constructor(readonly status: number, readonly error: string) { super(error); }
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

/** The body, or a 413 `Answer` past `MAX_BODY` bytes: reading stops there. */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) return reject(new Answer(413, 'too_large'));
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const onData = (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        cleanup();
        req.pause();
        return reject(new Answer(413, 'too_large'));
      }
      chunks.push(c);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const onError = (e: unknown) => { cleanup(); reject(e); };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

async function readJson<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  const raw = await readBody(req);
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString('utf8')); } catch { throw new Answer(400, 'bad_request'); }
  const r = schema.safeParse(parsed);
  if (!r.success) throw new Answer(400, 'bad_request');
  return r.data;
}

const PollBodySchema = z.object({ deviceCode: z.string().min(1).max(1024) });

/**
 * The relay's `/auth/*` routes. All answers are JSON. A `GitHubError` answers 502 `{ error: 'github' }`; more than
 * `maxGitHubCalls` GitHub calls in flight answer 503 `{ error: 'busy' }`. `stop()` flushes the aggregated
 * `sign_in_refused` counts.
 */
export function authRoutes(
  deps: AccountsDeps & { github: GitHub; maxGitHubCalls?: number; refusedLogMs?: number }
): HttpHandler & { stop(): void } {
  const maxCalls = deps.maxGitHubCalls ?? DEFAULT_MAX_GITHUB_CALLS;
  let inFlight = 0;
  const refusals = countedLog<SignInRefused>(deps.log, deps.refusedLogMs ?? 60_000);
  const refusedFor = (reason: SignInRefused['reason']) => refusals.add({ ev: 'sign_in_refused', reason });

  /** One slot for a sequence of GitHub calls; a full house answers 503 without calling GitHub. */
  async function withGitHub<T>(f: (gh: GitHub) => Promise<T>): Promise<T> {
    if (inFlight >= maxCalls) throw new Answer(503, 'busy');
    inFlight++;
    try {
      return await f(deps.github);
    } catch (e) {
      if (e instanceof GitHubError) {
        refusedFor('github');
        throw new Answer(502, 'github');
      }
      throw e;
    } finally {
      inFlight--;
    }
  }

  async function deviceStart(res: ServerResponse): Promise<void> {
    const d = await withGitHub((gh) => gh.deviceStart());
    const body: DeviceStartResponse = {
      deviceCode: d.deviceCode, userCode: d.userCode, verificationUri: d.verificationUri, expiresIn: d.expiresIn, interval: d.interval
    };
    json(res, 200, body);
  }

  async function devicePoll(req: IncomingMessage, res: ServerResponse, kick: Parameters<HttpHandler>[2]['kick']): Promise<void> {
    const { deviceCode } = await readJson(req, PollBodySchema);
    // The GitHub token never leaves this block: only the user's id and login do.
    const outcome = await withGitHub(async (gh) => {
      const poll = await gh.devicePoll(deviceCode);
      if (poll.status !== 'ok') return poll;
      return { status: 'user' as const, user: await gh.user(poll.accessToken) };
    });
    let body: DevicePollResponse;
    switch (outcome.status) {
      case 'pending': body = { status: 'pending' }; break;
      case 'slow_down': body = { status: 'slow_down', interval: outcome.interval }; break;
      case 'expired': refusedFor('expired'); body = { status: 'expired' }; break;
      case 'denied': refusedFor('denied'); body = { status: 'denied' }; break;
      case 'user': {
        const { id, login } = outcome.user;
        if (!deps.allowed.has(id)) {
          refusedFor('not_allowed');
          body = { status: 'not_allowed' };
          break;
        }
        // One PC per account: earlier PC sessions are revoked and their socket closed before the new one exists.
        await deps.store.upsertAccount(id, login);
        await deps.store.revokeSessions(id, 'pc');
        kick(id, 'pc', RELAY_CLOSE_SIGNED_OUT, 'signed_out');
        const token = newSessionToken();
        await deps.store.createSession(hashToken(token), { accountId: id, login, peer: 'pc', kind: 'pc' });
        deps.log({ ev: 'sign_in', account: id, peer: 'pc', kind: 'pc' });
        body = { status: 'ok', token, accountId: id, login };
        break;
      }
    }
    json(res, 200, body);
  }

  const isSecure = () => deps.publicUrl.startsWith('https:');
  const redirect = (res: ServerResponse, location: string, cookies: string[]) => {
    res.writeHead(302, { location, 'cache-control': 'no-store', 'set-cookie': cookies });
    res.end();
  };

  async function githubStart(res: ServerResponse): Promise<void> {
    const state = newOpaque();
    const url = deps.github.authorizeUrl(state, `${deps.publicUrl}/auth/github/callback`);
    redirect(res, url, [setCookie(STATE_COOKIE, state, { maxAgeS: STATE_MAX_AGE_S, path: STATE_PATH, secure: isSecure() })]);
  }

  /** Always a 302 to `/?signin=<issue>` and the state cookie cleared. No code, state or token is ever put in a URL. */
  async function githubCallback(req: IncomingMessage, res: ServerResponse, kick: Parameters<HttpHandler>[2]['kick']): Promise<void> {
    const clearState = setCookie(STATE_COOKIE, '', { maxAgeS: 0, path: STATE_PATH, secure: isSecure() });
    const done = (issue: string, extra: string[] = []) => redirect(res, `/?signin=${issue}`, [clearState, ...extra]);
    const q = new URL(req.url ?? '/', 'http://relay').searchParams;
    const cookies = parseCookies(req.headers.cookie);
    const state = q.get('state');
    const expected = cookies.get(STATE_COOKIE);
    if (!state || !expected || !sameSecret(state, expected)) { refusedFor('bad_state'); return done('bad_state'); }
    if (q.get('error') === 'access_denied') { refusedFor('denied'); return done('denied'); }
    const code = q.get('code');
    if (!code) { refusedFor('github'); return done('error'); }

    let user: { id: string; login: string };
    try {
      // The GitHub token never leaves this block.
      user = await withGitHub(async (gh) => gh.user(await gh.exchangeCode(code, `${deps.publicUrl}/auth/github/callback`)));
    } catch (e) {
      if (!(e instanceof Answer)) throw e;
      if (e.status === 503) refusedFor('github'); // withGitHub already counted a GitHubError
      return done('error');
    }
    if (!deps.allowed.has(user.id)) { refusedFor('not_allowed'); return done('not_allowed'); }

    await deps.store.upsertAccount(user.id, user.login);
    // Keep the phone's peer when it already holds a live device session of this account. A top-level redirect
    // from GitHub carries no same-origin Origin, so the cookie is looked up without that check.
    let peer = newDevicePeer();
    const old = cookies.get(RELAY_SESSION_COOKIE);
    if (old) {
      const oldHash = hashToken(old);
      const found = await deps.store.findSession(oldHash);
      if (found && found.kind === 'device' && found.accountId === user.id) {
        const revoked = await deps.store.revokeSession(oldHash);
        if (revoked) {
          peer = revoked.peer;
          kick(user.id, peer, RELAY_CLOSE_SIGNED_OUT, 'signed_out');
        }
      }
    }
    const token = newSessionToken();
    await deps.store.createSession(hashToken(token), { accountId: user.id, login: user.login, peer, kind: 'device' });
    deps.log({ ev: 'sign_in', account: user.id, peer, kind: 'device' });
    done('ok', [setCookie(RELAY_SESSION_COOKIE, token, { maxAgeS: Math.floor(deps.store.ttlMs / 1000), path: '/', secure: isSecure() })]);
  }

  async function me(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A GET changes nothing: no Origin check, so the phone's page can read who it is.
    const found = await sessionOf(req, deps, { checkOrigin: false });
    if (!found) throw new Answer(401, 'unauthorized');
    const { accountId, login, peer, kind } = found.session;
    const body: MeResponse = { accountId, login, peer, kind };
    json(res, 200, body);
  }

  async function logout(req: IncomingMessage, res: ServerResponse, kick: Parameters<HttpHandler>[2]['kick']): Promise<void> {
    const found = await sessionOf(req, deps, { checkOrigin: true });
    if (!found) throw new Answer(401, 'unauthorized');
    const revoked = await deps.store.revokeSession(found.tokenHash);
    if (!revoked) throw new Answer(401, 'unauthorized');
    kick(revoked.accountId, revoked.peer, RELAY_CLOSE_SIGNED_OUT, 'signed_out');
    deps.log({ ev: 'sign_out', account: revoked.accountId, peer: revoked.peer });
    const headers: Record<string, string> = { 'cache-control': 'no-store' };
    if (found.viaCookie) {
      headers['set-cookie'] = setCookie(RELAY_SESSION_COOKIE, '', { maxAgeS: 0, path: '/', secure: isSecure() });
    }
    res.writeHead(204, headers);
    res.end();
  }

  const handler: HttpHandler = async (req, res, relay) => {
    let path: string;
    try { path = new URL(req.url ?? '/', 'http://relay').pathname; } catch { return false; }
    if (!path.startsWith('/auth/')) return false;
    const kick = relay.kick.bind(relay);
    const route = `${req.method ?? ''} ${path}`;
    let run: (() => Promise<void>) | undefined;
    switch (route) {
      case 'POST /auth/device/start': run = () => deviceStart(res); break;
      case 'POST /auth/device/poll': run = () => devicePoll(req, res, kick); break;
      case 'GET /auth/github/start': run = () => githubStart(res); break;
      case 'GET /auth/github/callback': run = () => githubCallback(req, res, kick); break;
      case 'GET /auth/me': run = () => me(req, res); break;
      case 'POST /auth/logout': run = () => logout(req, res, kick); break;
    }
    if (!run) return false;
    try {
      await run();
    } catch (e) {
      if (!(e instanceof Answer)) throw e;
      // A body cut short at 413 is not drained: the connection is closed after the answer.
      json(res, e.status, { error: e.error }, e.status === 413 ? { connection: 'close' } : {});
    }
    return true;
  };
  return Object.assign(handler, { stop: () => refusals.stop() });
}
