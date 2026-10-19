import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitHubError, githubHttp } from '../src/github.js';

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server;
let base: string;
let seen: Seen[];
let handler: (req: IncomingMessage, res: ServerResponse) => void;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

beforeEach(async () => {
  seen = [];
  handler = (_req, res) => json(res, 200, {});
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      handler(req, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const gh = (timeoutMs?: number) =>
  githubHttp({
    clientId: 'CID',
    clientSecret: 'CSECRET',
    webBase: base,
    apiBase: base,
    ...(timeoutMs ? { timeoutMs } : {}),
  });

const form = (s: Seen) => new URLSearchParams(s.body);

async function failure(p: Promise<unknown>): Promise<GitHubError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GitHubError);
    return e as GitHubError;
  }
  throw new Error('expected a rejection');
}

describe('githubHttp', () => {
  it('authorizeUrl targets the authorize endpoint with fixed parameters', () => {
    const u = new URL(gh().authorizeUrl('S', 'http://r/cb'));
    expect(u.origin + u.pathname).toBe(`${base}/login/oauth/authorize`);
    expect(u.searchParams.get('client_id')).toBe('CID');
    expect(u.searchParams.get('redirect_uri')).toBe('http://r/cb');
    expect(u.searchParams.get('state')).toBe('S');
    expect(u.searchParams.get('scope')).toBe('');
    expect(u.searchParams.get('allow_signup')).toBe('false');
  });

  it('uses the github defaults when no base is given', () => {
    const u = githubHttp({ clientId: 'c', clientSecret: 's' }).authorizeUrl('S', 'http://r/cb');
    expect(u.startsWith('https://github.com/login/oauth/authorize?')).toBe(true);
  });

  it('deviceStart posts the client id and translates the answer', async () => {
    handler = (_q, res) =>
      json(res, 200, {
        device_code: 'DC',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      });
    await expect(gh().deviceStart()).resolves.toEqual({
      deviceCode: 'DC',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
    });
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.url).toBe('/login/device/code');
    expect(seen[0]?.headers.accept).toBe('application/json');
    expect(seen[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(form(seen[0] as Seen).get('client_id')).toBe('CID');
    expect(form(seen[0] as Seen).get('scope')).toBe('');
  });

  describe('devicePoll', () => {
    const cases: Array<[string, unknown, unknown]> = [
      ['pending', { error: 'authorization_pending' }, { status: 'pending' }],
      ['slow_down', { error: 'slow_down', interval: 10 }, { status: 'slow_down', interval: 10 }],
      ['expired_token', { error: 'expired_token' }, { status: 'expired' }],
      ['incorrect_device_code', { error: 'incorrect_device_code' }, { status: 'expired' }],
      ['access_denied', { error: 'access_denied' }, { status: 'denied' }],
      ['token', { access_token: 'T', token_type: 'bearer' }, { status: 'ok', accessToken: 'T' }],
    ];
    for (const [name, answer, expected] of cases) {
      it(`translates ${name}`, async () => {
        handler = (_q, res) => json(res, 200, answer);
        await expect(gh().devicePoll('DC')).resolves.toEqual(expected);
        expect(seen[0]?.url).toBe('/login/oauth/access_token');
        const f = form(seen[0] as Seen);
        expect(f.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
        expect(f.get('device_code')).toBe('DC');
        expect(f.get('client_id')).toBe('CID');
      });
    }

    it('rejects any other error', async () => {
      handler = (_q, res) => json(res, 200, { error: 'unsupported_grant_type' });
      expect((await failure(gh().devicePoll('DC'))).code).toBe('rejected');
    });

    it('maps 5xx to unavailable and an unparseable 4xx to rejected', async () => {
      handler = (_q, res) => json(res, 502, {});
      expect((await failure(gh().devicePoll('DC'))).code).toBe('unavailable');
      handler = (_q, res) => {
        res.writeHead(400);
        res.end('not json');
      };
      expect((await failure(gh().devicePoll('DC'))).code).toBe('rejected');
    });
  });

  describe('exchangeCode', () => {
    it('sends the secret and redirect_uri and returns the token', async () => {
      handler = (_q, res) => json(res, 200, { access_token: 'AT', token_type: 'bearer' });
      await expect(gh().exchangeCode('CODE', 'http://r/cb')).resolves.toBe('AT');
      expect(seen[0]?.url).toBe('/login/oauth/access_token');
      expect(seen[0]?.headers.accept).toBe('application/json');
      const f = form(seen[0] as Seen);
      expect(f.get('client_id')).toBe('CID');
      expect(f.get('client_secret')).toBe('CSECRET');
      expect(f.get('code')).toBe('CODE');
      expect(f.get('redirect_uri')).toBe('http://r/cb');
    });

    it('rejects bad_verification_code', async () => {
      handler = (_q, res) => json(res, 200, { error: 'bad_verification_code' });
      expect((await failure(gh().exchangeCode('X', 'http://r/cb'))).code).toBe('rejected');
    });
  });

  describe('user', () => {
    it('sends the bearer token and returns the id as a decimal string', async () => {
      handler = (_q, res) => json(res, 200, { id: 583231, login: 'kruril', extra: 1 });
      await expect(gh().user('T')).resolves.toEqual({ id: '583231', login: 'kruril' });
      expect(seen[0]?.method).toBe('GET');
      expect(seen[0]?.url).toBe('/user');
      expect(seen[0]?.headers.authorization).toBe('Bearer T');
      expect(seen[0]?.headers['user-agent']).toBeTruthy();
      expect(seen[0]?.headers['x-github-api-version']).toBe('2022-11-28');
      expect(seen[0]?.headers.accept).toBe('application/vnd.github+json');
    });

    it('maps 401 to rejected and 500 to unavailable', async () => {
      handler = (_q, res) => json(res, 401, { message: 'Bad credentials' });
      expect((await failure(gh().user('T'))).code).toBe('rejected');
      handler = (_q, res) => json(res, 500, {});
      expect((await failure(gh().user('T'))).code).toBe('unavailable');
    });

    it('treats a malformed body as unavailable', async () => {
      handler = (_q, res) => json(res, 200, { id: 'nope' });
      expect((await failure(gh().user('T'))).code).toBe('unavailable');
    });
  });

  it('a server that never answers gives unavailable within the timeout', async () => {
    handler = () => {};
    const started = Date.now();
    const e = await failure(gh(50).deviceStart());
    expect(e.code).toBe('unavailable');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('a 500 gives unavailable', async () => {
    handler = (_q, res) => json(res, 500, {});
    expect((await failure(gh().deviceStart())).code).toBe('unavailable');
  });

  it('never puts a response field in the error', async () => {
    handler = (_q, res) => json(res, 200, { error: 'x', access_token_leak: 'SECRET-TOKEN' });
    const e = await failure(gh().exchangeCode('CODE', 'http://r/cb'));
    expect(e.message).not.toContain('SECRET-TOKEN');
    expect(e.message).not.toContain('CSECRET');
    expect(e.message).not.toContain('CODE');
    expect(String(e.stack)).not.toContain('SECRET-TOKEN');
  });
});
