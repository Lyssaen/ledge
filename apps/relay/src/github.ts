import { z } from 'zod';

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DevicePoll =
  | { status: 'ok'; accessToken: string }
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'expired' }
  | { status: 'denied' };

export interface GitHubUser {
  /** The GitHub numeric id, in decimal. */
  id: string;
  login: string;
}

export type GitHubErrorCode = 'unavailable' | 'rejected';

/** Messages are fixed per situation: never a token, a code, the secret or a response body. */
export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  constructor(code: GitHubErrorCode) {
    super(code === 'unavailable' ? 'github unavailable' : 'github rejected the request');
    this.name = 'GitHubError';
    this.code = code;
  }
}

export interface GitHub {
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  deviceStart(): Promise<DeviceCode>;
  devicePoll(deviceCode: string): Promise<DevicePoll>;
  user(accessToken: string): Promise<GitHubUser>;
}

const DeviceStartSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().min(1),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive(),
});

const TokenAnswerSchema = z.object({
  access_token: z.string().min(1).optional(),
  error: z.string().optional(),
  interval: z.number().int().positive().optional(),
});

const UserSchema = z.object({
  id: z.number().int().nonnegative(),
  login: z.string().min(1),
});

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const USER_AGENT = 'ledge-relay';

export function githubHttp(opts: {
  clientId: string;
  clientSecret: string;
  webBase?: string;
  apiBase?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): GitHub {
  const webBase = (opts.webBase ?? 'https://github.com').replace(/\/+$/, '');
  const apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const doFetch = opts.fetch ?? fetch;

  /** One bounded call; returns the status and the parsed JSON body (undefined when not JSON). */
  async function call(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{ status: number; body: unknown }> {
    try {
      const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      return { status: res.status, body };
    } catch {
      throw new GitHubError('unavailable');
    }
  }

  async function postForm(
    path: string,
    fields: Record<string, string>,
  ): Promise<{ status: number; body: unknown }> {
    return call(`${webBase}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': USER_AGENT,
      },
      body: new URLSearchParams(fields).toString(),
    });
  }

  /** Non-2xx handling shared by the web endpoints: 5xx and 429 are transient, other codes are refusals. */
  function checkStatus(status: number): void {
    if (status >= 200 && status < 300) return;
    throw new GitHubError(status >= 500 || status === 429 ? 'unavailable' : 'rejected');
  }

  function parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const r = schema.safeParse(body);
    if (!r.success) throw new GitHubError('unavailable');
    return r.data;
  }

  return {
    authorizeUrl(state, redirectUri) {
      const q = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: redirectUri,
        state,
        scope: '',
        allow_signup: 'false',
      });
      return `${webBase}/login/oauth/authorize?${q.toString()}`;
    },

    async exchangeCode(code, redirectUri) {
      const { status, body } = await postForm('/login/oauth/access_token', {
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        code,
        redirect_uri: redirectUri,
      });
      checkStatus(status);
      const answer = parse(TokenAnswerSchema, body);
      if (answer.error !== undefined || answer.access_token === undefined) {
        throw new GitHubError('rejected');
      }
      return answer.access_token;
    },

    async deviceStart() {
      const { status, body } = await postForm('/login/device/code', {
        client_id: opts.clientId,
        scope: '',
      });
      checkStatus(status);
      const d = parse(DeviceStartSchema, body);
      return {
        deviceCode: d.device_code,
        userCode: d.user_code,
        verificationUri: d.verification_uri,
        expiresIn: d.expires_in,
        interval: d.interval,
      };
    },

    async devicePoll(deviceCode) {
      const { status, body } = await postForm('/login/oauth/access_token', {
        client_id: opts.clientId,
        device_code: deviceCode,
        grant_type: DEVICE_GRANT,
      });
      const parsed = TokenAnswerSchema.safeParse(body);
      if (status < 200 || status >= 300) {
        // A 4xx carrying a known device-flow answer is still translated; anything else is a refusal.
        if (status >= 500 || status === 429 || !parsed.success) checkStatus(status);
        if (!parsed.success || parsed.data.error === undefined) throw new GitHubError('rejected');
      }
      const answer = parse(TokenAnswerSchema, body);
      switch (answer.error) {
        case undefined:
          if (answer.access_token === undefined) throw new GitHubError('unavailable');
          return { status: 'ok', accessToken: answer.access_token };
        case 'authorization_pending':
          return { status: 'pending' };
        case 'slow_down':
          return { status: 'slow_down', interval: answer.interval ?? 10 };
        case 'expired_token':
        case 'incorrect_device_code':
          return { status: 'expired' };
        case 'access_denied':
          return { status: 'denied' };
        default:
          throw new GitHubError('rejected');
      }
    },

    async user(accessToken) {
      const { status, body } = await call(`${apiBase}/user`, {
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${accessToken}`,
          'user-agent': USER_AGENT,
          'x-github-api-version': '2022-11-28',
        },
      });
      if (status === 401 || status === 403) throw new GitHubError('rejected');
      checkStatus(status);
      const u = parse(UserSchema, body);
      return { id: String(u.id), login: u.login };
    },
  };
}
