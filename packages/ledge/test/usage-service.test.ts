import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUsage, CURSOR_READ_EVERY_MS, READ_EVERY_MS, type UsageState } from '../src/daemon/usage/service.js';
import type { HttpsGet, HttpsPost } from '../src/daemon/usage/net.js';
import { CURSOR_USAGE_URL } from '../src/daemon/usage/cursor.js';

const logged = vi.hoisted(() => [] as string[]);
vi.mock('../src/log.js', () => ({ log: (l: string) => { logged.push(l); } }));

const T0 = Date.parse('2026-11-05T14:00:00.000Z');
const API = {
  five_hour: { utilization: 42, resets_at: '2026-11-05T18:30:00Z' },
  seven_day: { utilization: 85, resets_at: '2026-11-09T09:00:00Z' },
  seven_day_opus: { utilization: 100, resets_at: '2026-11-09T09:00:00Z' }
};

/** A machine with Claude Code signed in (or not), an API double, and a clock the test moves. Never the network, never a real file. */
function machine(o: { creds?: string | null; answers?: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>; file?: string } = {}) {
  let t = T0;
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const answers = [...(o.answers ?? [])];
  const get: HttpsGet = async (url, headers) => {
    calls.push({ url, headers });
    const a = answers.shift() ?? { status: 200, body: API };
    return { status: a.status, body: a.body === undefined ? '' : JSON.stringify(a.body), headers: a.headers ?? {} };
  };
  const reads: string[] = [];
  const credsFile = o.creds === undefined ? JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: T0 + 30 * 24 * 3_600_000 } }) : o.creds;
  const read = async (p: string) => {
    reads.push(p);
    if (p.endsWith('.credentials.json') && credsFile !== null) return credsFile;
    if (p.endsWith('.claude.json')) return JSON.stringify({ oauthAccount: { accountUuid: 'acc-1', organizationUuid: 'org-1' } });
    throw new Error('ENOENT');
  };
  const file = o.file ?? join(mkdtempSync(join(tmpdir(), 'ledge-usage-')), 'usage.json');
  const svc = createUsage({ home: '/h', env: async () => ({}), file, now: () => t, get, read, version: async () => '2.1.318' });
  const states: UsageState[] = [];
  svc.onChange(s => states.push(s));
  return { svc, calls, reads, states, file, advance: (ms: number) => { t += ms; }, at: () => t };
}

describe('the usage service: Claude Code', () => {
  it('reads the API with the token, Claude Code\'s version and the beta header, then shows the windows', async () => {
    const m = machine();
    expect(m.svc.state().harnesses).toEqual([]);
    await m.svc.tick();
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.url).toBe('https://api.anthropic.com/api/oauth/usage');
    expect(m.calls[0]!.headers).toMatchObject({ Authorization: 'Bearer tok', 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'claude-code/2.1.318' });
    const [h] = m.svc.state().harnesses;
    expect(h).toMatchObject({ harness: 'claude', status: 'ok', readAt: '2026-11-05T14:00:00.000Z' });
    expect(h!.account).toMatch(/^[0-9a-f]{12}$/);
    expect(h!.windows.map(w => [w.kind, w.model, w.pct])).toEqual([['five_hour', undefined, 42], ['seven_day', undefined, 85], ['model', 'Opus', 100]]);
    // Only reads: the credentials file is never written (the service has no writer for it), and only these two files are read.
    expect([...new Set(m.reads)].filter(r => !r.endsWith('/cursor/auth.json'))).toEqual(['/h/.claude/.credentials.json', '/h/.claude.json']);
  });

  it('reads at most every 2 minutes; stale after 5 without a read, nothing shown after an hour', async () => {
    const m = machine({ answers: [{ status: 200, body: API }, { status: 500 }] });
    await m.svc.tick();
    m.advance(30_000); await m.svc.tick();
    expect(m.calls).toHaveLength(1);
    m.advance(READ_EVERY_MS); await m.svc.tick();
    expect(m.calls).toHaveLength(2);
    // The 500: unreachable, the values of the last good read kept, with when it was.
    expect(m.svc.state().harnesses[0]).toMatchObject({ status: 'unreachable', readAt: '2026-11-05T14:00:00.000Z' });
    expect(m.svc.state().harnesses[0]!.windows).toHaveLength(3);
    m.advance(61 * 60_000); await m.svc.tick();
    // Read again since (the default answer): fine again.
    expect(m.svc.state().harnesses[0]!.status).toBe('ok');
  });

  it('a 429 waits longer each time (Retry-After when it says more), up to 15 minutes', async () => {
    const m = machine({ answers: [{ status: 429 }, { status: 429, headers: { 'retry-after': '700' } }, { status: 200, body: API }] });
    await m.svc.tick();
    expect(m.svc.state().harnesses[0]!.status).toBe('unreachable');
    m.advance(READ_EVERY_MS); await m.svc.tick();
    expect(m.calls).toHaveLength(1); // 4 minutes after the first 429
    m.advance(READ_EVERY_MS); await m.svc.tick();
    expect(m.calls).toHaveLength(2);
    m.advance(10 * 60_000); await m.svc.tick();
    expect(m.calls).toHaveLength(2); // the second asked 700 s, the doubling gives 8 min: 700 s it is
    m.advance(2 * 60_000); await m.svc.tick();
    expect(m.calls).toHaveLength(3);
    expect(m.svc.state().harnesses[0]!.status).toBe('ok');
  });

  it('a Retry-After longer than Ledge\'s own 15-minute cap is kept', async () => {
    const m = machine({ answers: [{ status: 429, headers: { 'retry-after': '3600' } }, { status: 200, body: API }] });
    await m.svc.tick();
    m.advance(16 * 60_000); await m.svc.tick();
    expect(m.calls).toHaveLength(1);
    m.advance(44 * 60_000); await m.svc.tick();
    expect(m.calls).toHaveLength(2);
    expect(m.svc.state().harnesses[0]!.status).toBe('ok');
  });

  it('an expired token is never sent nor refreshed: « expired », no window; a 401 says the same', async () => {
    const expired = machine({ creds: JSON.stringify({ claudeAiOauth: { accessToken: 'old', expiresAt: T0 - 1 } }) });
    await expired.svc.tick();
    expect(expired.calls).toEqual([]);
    expect(expired.svc.state().harnesses).toEqual([expect.objectContaining({ harness: 'claude', status: 'expired', windows: [] })]);
    const refused = machine({ answers: [{ status: 401 }] });
    await refused.svc.tick();
    expect(refused.svc.state().harnesses[0]).toMatchObject({ status: 'expired', windows: [] });
  });

  it('not signed in: no Claude Code at all; stale after 5 minutes without a read', async () => {
    const none = machine({ creds: null });
    await none.svc.tick();
    expect(none.calls).toEqual([]);
    expect(none.svc.state().harnesses).toEqual([]);
    const m = machine({ answers: [{ status: 200, body: API }] });
    await m.svc.tick();
    // Paused (the next read is not due): past 5 minutes it is stale.
    m.advance(6 * 60_000);
    expect(m.svc.state().harnesses[0]!.status).toBe('stale');
  });
});

describe('the usage service: the account', () => {
  it('is told only for the token Claude Code keeps in its file; CLAUDE_CODE_OAUTH_TOKEN may be another account\'s: none then', async () => {
    let t = T0;
    const read = async (p: string) => {
      if (p.endsWith('.credentials.json')) return JSON.stringify({ claudeAiOauth: { accessToken: 'file-tok', expiresAt: T0 + 30 * 24 * 3_600_000 } });
      if (p.endsWith('.claude.json')) return JSON.stringify({ oauthAccount: { accountUuid: 'acc-A' } });
      throw new Error('ENOENT');
    };
    let env: NodeJS.ProcessEnv = { CLAUDE_CODE_OAUTH_TOKEN: 'env-tok-B' };
    const headers: string[] = [];
    const svc = createUsage({ home: '/h', env: async () => env, file: join(mkdtempSync(join(tmpdir(), 'ledge-usage-')), 'usage.json'), now: () => t, read, version: async () => '2.1.318',
      get: async (_u, h) => { headers.push(h.Authorization!); return { status: 200, body: JSON.stringify(API), headers: {} }; } });
    await svc.tick();
    expect(headers).toEqual(['Bearer env-tok-B']);
    expect(svc.state().harnesses[0]!.account).toBeNull();
    // The environment token gone (a later login shell): the file's token, and its account, at once.
    env = {};
    t += 11 * 60_000; // past the environment's reread
    await svc.tick();
    expect(headers.at(-1)).toBe('Bearer file-tok');
    expect(svc.state().harnesses[0]!.account).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('the usage service: another account signs in', () => {
  /** Claude Code's credentials file and ~/.claude.json, switched to another account mid-test. */
  function switching(answers: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
    let t = T0, who = 'A';
    const calls: string[] = [];
    const read = async (p: string) => {
      if (p.endsWith('.credentials.json')) return JSON.stringify({ claudeAiOauth: { accessToken: `tok-${who}`, expiresAt: T0 + 30 * 24 * 3_600_000 } });
      if (p.endsWith('.claude.json')) return JSON.stringify({ oauthAccount: { accountUuid: `acc-${who}` } });
      throw new Error('ENOENT');
    };
    const svc = createUsage({ home: '/h', env: async () => ({}), file: join(mkdtempSync(join(tmpdir(), 'ledge-usage-')), 'usage.json'), now: () => t, read, version: async () => '2.1.318',
      get: async (_u, h) => { calls.push(h.Authorization!); const a = answers.shift() ?? { status: 200, body: API }; return { status: a.status, body: a.body === undefined ? '' : JSON.stringify(a.body), headers: a.headers ?? {} }; } });
    return { svc, calls, to: (w: string) => { who = w; }, advance: (ms: number) => { t += ms; } };
  }
  const A_BODY = { five_hour: { utilization: 91, resets_at: '2026-11-05T18:00:00Z' }, seven_day: { utilization: 10, resets_at: '2026-11-09T09:00:00Z' } };

  it('drops the previous account\'s windows at once, without reading again before it is due; Claude Code refreshing its token keeps them', async () => {
    const m = switching([{ status: 200, body: A_BODY }, { status: 200, body: API }]);
    await m.svc.tick();
    const a = m.svc.state().harnesses[0]!;
    expect(a.windows[0]!.pct).toBe(91);
    m.to('B');
    m.advance(30_000); await m.svc.tick();
    const b = m.svc.state().harnesses[0]!;
    expect(b.account).not.toBe(a.account);
    expect(b).toMatchObject({ status: 'loading', readAt: null, windows: [] });
    expect(m.svc.state().alerts).toEqual([]);
    expect(m.calls).toEqual(['Bearer tok-A']);
    m.advance(READ_EVERY_MS); await m.svc.tick();
    expect(m.calls).toEqual(['Bearer tok-A', 'Bearer tok-B']);
    expect(m.svc.state().harnesses[0]).toMatchObject({ account: b.account, status: 'ok' });
    expect(m.svc.state().harnesses[0]!.windows[0]!.pct).toBe(42);
  });

  it('during a 429\'s wait, another account: its windows are not the previous ones, the wait still stands', async () => {
    const m = switching([{ status: 200, body: A_BODY }, { status: 429, headers: { 'retry-after': '1800' } }, { status: 200, body: API }]);
    await m.svc.tick();
    m.advance(READ_EVERY_MS); await m.svc.tick(); // the 429
    expect(m.svc.state().harnesses[0]).toMatchObject({ status: 'unreachable', windows: [expect.objectContaining({ pct: 91 }), expect.objectContaining({ pct: 10 })] });
    m.to('B');
    m.advance(60_000); await m.svc.tick();
    expect(m.svc.state().harnesses[0]).toMatchObject({ status: 'unreachable', readAt: null, windows: [] });
    expect(m.calls).toHaveLength(2);
    m.advance(29 * 60_000); await m.svc.tick();
    expect(m.calls).toEqual(['Bearer tok-A', 'Bearer tok-A', 'Bearer tok-B']);
    expect(m.svc.state().harnesses[0]!.status).toBe('ok');
  });

  it('a 401 is the account it was for: another account signed in during the wait is loading, not expired', async () => {
    const m = switching([{ status: 401 }, { status: 200, body: API }]);
    await m.svc.tick();
    expect(m.svc.state().harnesses[0]!.status).toBe('expired');
    m.to('B');
    m.advance(30_000); await m.svc.tick();
    expect(m.svc.state().harnesses[0]).toMatchObject({ status: 'loading', windows: [] });
    expect(m.calls).toEqual(['Bearer tok-A']);
    m.advance(READ_EVERY_MS); await m.svc.tick();
    expect(m.calls).toEqual(['Bearer tok-A', 'Bearer tok-B']);
    expect(m.svc.state().harnesses[0]!.status).toBe('ok');
  });

  it('the same account refused (401) stays expired until its next read', async () => {
    const m = switching([{ status: 401 }, { status: 200, body: API }]);
    await m.svc.tick();
    m.advance(30_000); await m.svc.tick();
    expect(m.svc.state().harnesses[0]!.status).toBe('expired');
    m.advance(READ_EVERY_MS); await m.svc.tick();
    expect(m.svc.state().harnesses[0]!.status).toBe('ok');
  });

  it('a token past its time, then a valid one (signed in again), is no longer expired at once, without reading before it is due', async () => {
    let t = T0, expiresAt = T0 - 1;
    const calls: string[] = [];
    const read = async (p: string) => {
      if (p.endsWith('.credentials.json')) return JSON.stringify({ claudeAiOauth: { accessToken: `tok-${expiresAt}`, expiresAt } });
      if (p.endsWith('.claude.json')) return JSON.stringify({ oauthAccount: { accountUuid: 'acc-A' } });
      throw new Error('ENOENT');
    };
    const svc = createUsage({ home: '/h', env: async () => ({}), file: join(mkdtempSync(join(tmpdir(), 'ledge-usage-')), 'usage.json'), now: () => t, read, version: async () => '2.1.318',
      get: async (_u, h) => { calls.push(h.Authorization!); return { status: 429, body: '', headers: {} }; } });
    await svc.tick();
    expect(svc.state().harnesses[0]!.status).toBe('expired');
    expect(calls).toEqual([]);
    expiresAt = T0 + 30 * 24 * 3_600_000;
    t += 30_000; await svc.tick();
    // Read now (it was never read): the 429 makes it unreachable, not expired.
    expect(svc.state().harnesses[0]!.status).toBe('unreachable');
    expect(calls).toHaveLength(1);
  });

  it('a refusal outlives a local expiry and a token refreshed for the same account: still expired, nothing shown, until a read succeeds', async () => {
    let t = T0, expiresAt = T0 + 3_600_000, gen = 1;
    const calls: string[] = [];
    const answers = [{ status: 200, body: { five_hour: { utilization: 91, resets_at: '2026-11-05T18:00:00Z' } } }, { status: 401 }, { status: 200, body: API }];
    const read = async (p: string) => {
      if (p.endsWith('.credentials.json')) return JSON.stringify({ claudeAiOauth: { accessToken: `tok-${gen}`, expiresAt } });
      if (p.endsWith('.claude.json')) return JSON.stringify({ oauthAccount: { accountUuid: 'acc-A' } });
      throw new Error('ENOENT');
    };
    const svc = createUsage({ home: '/h', env: async () => ({}), file: join(mkdtempSync(join(tmpdir(), 'ledge-usage-')), 'usage.json'), now: () => t, read, version: async () => '2.1.318',
      get: async (_u, h) => { calls.push(h.Authorization!); const a = answers.shift()!; return { status: a.status, body: a.body ? JSON.stringify(a.body) : '', headers: {} }; } });
    await svc.tick(); // 91 %
    t += READ_EVERY_MS; await svc.tick(); // 401
    expect(svc.state().harnesses[0]!.status).toBe('expired');
    expiresAt = t - 1; t += 10_000; await svc.tick(); // the local token expires
    expiresAt = t + 3_600_000; gen = 2; t += 10_000; await svc.tick(); // Claude Code refreshes it, same account
    expect(svc.state().harnesses[0]).toMatchObject({ status: 'expired', windows: [] });
    expect(calls).toHaveLength(2);
    t += READ_EVERY_MS; await svc.tick(); // the next read, at its time, succeeds
    expect(calls).toEqual(['Bearer tok-1', 'Bearer tok-1', 'Bearer tok-2']);
    expect(svc.state().harnesses[0]!.status).toBe('ok');
  });

  it('a Retry-After past a day is waited a day', async () => {
    const m = switching([{ status: 429, headers: { 'retry-after': String(3 * 24 * 3600) } }]);
    await m.svc.tick();
    m.advance(23 * 3_600_000); await m.svc.tick();
    expect(m.calls).toHaveLength(1);
    m.advance(2 * 3_600_000); await m.svc.tick();
    expect(m.calls).toHaveLength(2);
  });
});

describe('the usage service: alerts and the threshold', () => {
  it('a window past the threshold, then one reached: « Compris » puts each away until it resets, kept on disk with when it was seen', async () => {
    const m = machine();
    await m.svc.tick();
    const alerts = m.svc.state().alerts;
    expect(alerts.map(a => [a.window.kind, a.window.model, a.level])).toEqual([['seven_day', undefined, 'threshold'], ['model', 'Opus', 'full']]);
    expect(alerts.every(a => a.at === '2026-11-05T14:00:00.000Z')).toBe(true);
    // Later, the same alerts keep the moment they were first seen.
    m.advance(60_000);
    expect(m.svc.state().alerts.map(a => a.at)).toEqual(['2026-11-05T14:00:00.000Z', '2026-11-05T14:00:00.000Z']);
    expect(m.svc.ack(alerts[1]!.id)).toBe(true);
    expect(m.svc.ack('unknown')).toBe(false);
    expect(m.svc.state().alerts.map(a => a.level)).toEqual(['threshold']);
    const kept = JSON.parse(readFileSync(m.file, 'utf8')) as { alert: number; acks: string[]; seen: Record<string, string> };
    expect(kept.alert).toBe(0.8);
    expect(kept.acks).toEqual([alerts[1]!.id]);
    expect(Object.values(kept.seen)).toEqual(['2026-11-05T14:00:00.000Z', '2026-11-05T14:00:00.000Z']);
    // A daemon that starts again keeps both: the ack, and when the open alert was born.
    const again = machine({ file: m.file });
    again.advance(5 * 60_000);
    await again.svc.tick();
    expect(again.svc.state().alerts.map(a => [a.level, a.at])).toEqual([['threshold', '2026-11-05T14:00:00.000Z']]);
  });

  it('the threshold set by a front applies at once, is kept, and stays within 50-95 %', async () => {
    const m = machine();
    await m.svc.tick();
    m.svc.setPrefs({ alert: 0.9 });
    expect(m.svc.state().prefs).toEqual({ alert: 0.9 });
    expect(m.svc.state().alerts.map(a => a.level)).toEqual(['full']);
    expect(m.states.at(-1)?.prefs).toEqual({ alert: 0.9 });
    expect(machine({ file: m.file }).svc.state().prefs).toEqual({ alert: 0.9 });
  });

  it('an ack is dropped once its window has started again', async () => {
    const m = machine();
    await m.svc.tick();
    const id = m.svc.state().alerts[0]!.id;
    m.svc.ack(id);
    m.advance(5 * 24 * 3_600_000); // past 2026-11-09T09:00
    await m.svc.tick();
    expect((JSON.parse(readFileSync(m.file, 'utf8')) as { acks: string[] }).acks).toEqual([]);
  });
});

describe('the usage service: Codex', () => {
  it('shows Codex only when its transcripts report windows; the newest reading wins; none for a plan without', async () => {
    const m = machine({ creds: null });
    const w = [{ kind: 'five_hour' as const, pct: 30, resetsAt: '2026-11-05T18:00:00.000Z' }, { kind: 'seven_day' as const, pct: 96, resetsAt: '2026-11-11T09:00:00.000Z' }];
    m.svc.observeCodex({ windows: w, at: '2026-11-05T13:59:00.000Z' });
    expect(m.svc.state().harnesses).toEqual([{ harness: 'codex', account: null, status: 'ok', readAt: '2026-11-05T13:59:00.000Z', windows: w }]);
    expect(m.svc.state().alerts.map(a => [a.harness, a.window.kind, a.level])).toEqual([['codex', 'seven_day', 'threshold']]);
    m.svc.observeCodex({ windows: [{ ...w[0]!, pct: 1 }], at: '2026-11-05T13:00:00.000Z' });
    expect(m.svc.state().harnesses[0]!.windows[0]!.pct).toBe(30);
    // A plan without windows, reported later: Codex goes.
    m.svc.observeCodex({ windows: [], at: '2026-11-05T14:00:00.000Z' });
    expect(m.svc.state().harnesses).toEqual([]);
  });

  it('an older reading never replaces a newer one, an empty one included (another session\'s older transcript)', () => {
    const m = machine({ creds: null });
    const w = [{ kind: 'five_hour' as const, pct: 30, resetsAt: '2026-11-05T18:00:00.000Z' }];
    m.svc.observeCodex({ windows: w, at: '2026-11-05T13:59:00.000Z' });
    m.svc.observeCodex({ windows: [], at: '2026-11-05T12:00:00.000Z' });
    expect(m.svc.state().harnesses.map(h => h.harness)).toEqual(['codex']);
  });
});

const jwt = (claims: Record<string, unknown>): string => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const CURSOR_BODY = { billingCycleStart: '1793000000000', billingCycleEnd: String(T0 + 20 * 86_400_000), planUsage: { totalPercentUsed: 56.4, autoPercentUsed: 30, apiPercentUsed: 100 } };
const CURSOR_TOKEN = jwt({ sub: 'auth0|user_1', exp: Math.floor((T0 + 5 * 86_400_000) / 1000) });
const LEAK = 'SECRET-TOKEN-STRING';

/** Cursor Agent signed in (or not), a POST double, and no Claude Code. */
function cursorMachine(o: { auth?: string | null; answers?: Array<{ status: number; body?: string | unknown; headers?: Record<string, string> }> } = {}) {
  let t = T0;
  const posts: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const answers = [...(o.answers ?? [])];
  const post: HttpsPost = async (url, headers, body) => {
    posts.push({ url, headers, body });
    const a = answers.shift() ?? { status: 200, body: CURSOR_BODY };
    return { status: a.status, body: a.body === undefined ? '' : typeof a.body === 'string' ? a.body : JSON.stringify(a.body), headers: a.headers ?? {} };
  };
  const authFile = o.auth === undefined ? JSON.stringify({ accessToken: CURSOR_TOKEN, refreshToken: 'r' }) : o.auth;
  const read = async (p: string) => { if (p === '/h/.config/cursor/auth.json' && authFile !== null) return authFile; throw new Error('ENOENT'); };
  const file = join(mkdtempSync(join(tmpdir(), 'ledge-usage-')), 'usage.json');
  const get: HttpsGet = async () => { throw new Error('no GET'); };
  const svc = createUsage({ home: '/h', env: async () => ({}), file, now: () => t, get, post, read, version: async () => '2.1.318' });
  return { svc, posts, file, advance: (ms: number) => { t += ms; }, cursor: () => svc.state().harnesses.find(h => h.harness === 'cursor') };
}

describe('the usage service: Cursor Agent', () => {
  it('POSTs the dashboard RPC with the token and shows the total and the pools', async () => {
    const m = cursorMachine();
    await m.svc.tick();
    expect(m.posts).toHaveLength(1);
    expect(m.posts[0]!.url).toBe(CURSOR_USAGE_URL);
    expect(m.posts[0]!.headers).toMatchObject({ Authorization: `Bearer ${CURSOR_TOKEN}`, 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' });
    expect(m.posts[0]!.body).toBe('{}');
    expect(m.cursor()).toMatchObject({ harness: 'cursor', status: 'ok', readAt: '2026-11-05T14:00:00.000Z' });
    expect(m.cursor()!.account).toMatch(/^[0-9a-f]{12}$/);
    expect(m.cursor()!.windows.map(w => [w.kind, w.pool, w.pct])).toEqual([['month', undefined, 56], ['pool', 'cursor', 30], ['pool', 'other', 100]]);
  });

  it('reads at most every 5 minutes; stale after 15 without a read; nothing shown past an hour', async () => {
    const m = cursorMachine({ answers: [{ status: 200, body: CURSOR_BODY }, { status: 503 }] });
    await m.svc.tick();
    m.advance(CURSOR_READ_EVERY_MS - 1000); await m.svc.tick();
    expect(m.posts).toHaveLength(1);
    m.advance(1000); await m.svc.tick();
    expect(m.posts).toHaveLength(2);
    expect(m.cursor()).toMatchObject({ status: 'unreachable', readAt: '2026-11-05T14:00:00.000Z' });
    expect(m.cursor()!.windows).toHaveLength(3);
    m.advance(10 * 60_000 + 1000);
    expect(m.cursor()!.status).toBe('unreachable');
    const s = cursorMachine();
    await s.svc.tick();
    s.advance(15 * 60_000); expect(s.cursor()!.status).toBe('ok');
    s.advance(1000); expect(s.cursor()!.status).toBe('stale');
    s.advance(45 * 60_000 - 1000); expect(s.cursor()!.windows).toHaveLength(3);
    s.advance(1000); expect(s.cursor()!.windows).toEqual([]);
  });

  it('a token past its time: expired, no window, no POST; a 401 is expired and the next read that succeeds is ok', async () => {
    const old = cursorMachine({ auth: JSON.stringify({ accessToken: jwt({ sub: 'x', exp: Math.floor(T0 / 1000) - 1 }) }) });
    await old.svc.tick();
    expect(old.posts).toEqual([]);
    expect(old.cursor()).toMatchObject({ status: 'expired', windows: [] });
    const m = cursorMachine({ answers: [{ status: 401, body: { code: 'unauthenticated' } }, { status: 200, body: CURSOR_BODY }] });
    await m.svc.tick();
    expect(m.cursor()).toMatchObject({ status: 'expired', windows: [] });
    m.advance(CURSOR_READ_EVERY_MS); await m.svc.tick();
    expect(m.cursor()!.status).toBe('ok');
  });

  it('a 429 with Retry-After 1800 waits 30 minutes', async () => {
    const m = cursorMachine({ answers: [{ status: 429, headers: { 'retry-after': '1800' } }, { status: 200, body: CURSOR_BODY }] });
    await m.svc.tick();
    expect(m.cursor()!.status).toBe('unreachable');
    m.advance(29 * 60_000); await m.svc.tick();
    expect(m.posts).toHaveLength(1);
    m.advance(60_000); await m.svc.tick();
    expect(m.posts).toHaveLength(2);
    expect(m.cursor()!.status).toBe('ok');
  });

  it('an answer without totalPercentUsed is ok with no window; an HTML body is unreachable', async () => {
    const m = cursorMachine({ answers: [{ status: 200, body: { planUsage: {} } }, { status: 200, body: '<html>' }] });
    await m.svc.tick();
    expect(m.cursor()).toMatchObject({ status: 'ok', readAt: '2026-11-05T14:00:00.000Z', windows: [] });
    m.advance(CURSOR_READ_EVERY_MS); await m.svc.tick();
    expect(m.cursor()!.status).toBe('unreachable');
  });

  it('no auth.json: no Cursor at all', async () => {
    const m = cursorMachine({ auth: null });
    await m.svc.tick();
    expect(m.posts).toEqual([]);
    expect(m.svc.state().harnesses).toEqual([]);
  });

  it('alerts on the total and on each pool, with the same threshold', async () => {
    const m = cursorMachine({ answers: [{ status: 200, body: { ...CURSOR_BODY, planUsage: { totalPercentUsed: 81, apiPercentUsed: 100 } } }] });
    await m.svc.tick();
    const a = m.svc.state().alerts;
    expect(a.find(x => x.level === 'threshold')!.id).toMatch(/^cursor\|[0-9a-f]{12}\|month\|-\|threshold\|/);
    expect(a.find(x => x.level === 'full')!.id).toBe(`cursor|${m.cursor()!.account}|pool|other|full|${new Date(T0 + 20 * 86_400_000).toISOString()}`);
  });

  it('another account signing in drops the previous windows and the refusal', async () => {
    let auth = JSON.stringify({ accessToken: jwt({ sub: 'A', exp: Math.floor(T0 / 1000) + 99999 }) });
    let t = T0;
    const svc = createUsage({ home: '/h', env: async () => ({}), file: join(mkdtempSync(join(tmpdir(), 'ledge-usage-')), 'usage.json'), now: () => t,
      read: async p => { if (p.endsWith('auth.json')) return auth; throw new Error('ENOENT'); },
      post: async () => ({ status: t === T0 ? 200 : 401, body: JSON.stringify(CURSOR_BODY), headers: {} }) });
    await svc.tick();
    expect(svc.state().harnesses[0]!.windows).toHaveLength(3);
    t += CURSOR_READ_EVERY_MS; await svc.tick();
    expect(svc.state().harnesses[0]).toMatchObject({ status: 'expired', windows: [] });
    auth = JSON.stringify({ accessToken: jwt({ sub: 'B', exp: Math.floor(T0 / 1000) + 99999 }) });
    t += 1000; await svc.tick();
    expect(svc.state().harnesses[0]).toMatchObject({ status: 'loading', windows: [] });
  });

  it('a throw in the Cursor read leaves Claude\'s alone', async () => {
    const m = machine();
    const svc = createUsage({ home: '/h', env: async () => ({}), file: m.file, now: () => T0, version: async () => '1',
      get: async () => ({ status: 200, body: JSON.stringify(API), headers: {} }), post: async () => { throw new Error('boom'); },
      read: async p => { if (p.endsWith('auth.json')) return JSON.stringify({ accessToken: CURSOR_TOKEN }); if (p.endsWith('.credentials.json')) return JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: T0 + 9e9 } }); throw new Error('ENOENT'); } });
    await svc.tick();
    expect(svc.state().harnesses.map(h => [h.harness, h.status])).toEqual([['claude', 'ok'], ['cursor', 'unreachable']]);
  });

  it('never writes the token to the log or to usage.json', async () => {
    logged.length = 0;
    {
      const m = cursorMachine({ auth: JSON.stringify({ accessToken: LEAK }), answers: [{ status: 503, body: LEAK }, { status: 401, body: LEAK }, { status: 429, body: LEAK }, { status: 200, body: { ...CURSOR_BODY, planUsage: { totalPercentUsed: 99 } } }] });
      for (let i = 0; i < 4; i++) { await m.svc.tick(); m.advance(40 * 60_000); }
      expect(logged.join('\n')).toContain('usage: Cursor Agent session expired (401)');
      expect(logged.join('\n')).not.toContain(LEAK);
      expect((() => { try { return readFileSync(m.file, 'utf8'); } catch { return ''; } })()).not.toContain(LEAK);
    }
  });

  it('a 429 without Retry-After waits 10 minutes', async () => {
    const m = cursorMachine({ answers: [{ status: 429 }, { status: 200, body: CURSOR_BODY }] });
    await m.svc.tick();
    m.advance(10 * 60_000 - 1000); await m.svc.tick();
    expect(m.posts).toHaveLength(1);
    m.advance(1000); await m.svc.tick();
    expect(m.posts).toHaveLength(2);
  });

  it('a throw in Claude\'s read leaves Cursor\'s alone', async () => {
    const svc = createUsage({ home: '/h', env: async () => ({}), file: join(mkdtempSync(join(tmpdir(), 'ledge-usage-')), 'usage.json'), now: () => T0, version: async () => '1',
      get: async () => { throw new Error('boom'); }, post: async () => ({ status: 200, body: JSON.stringify(CURSOR_BODY), headers: {} }),
      read: async p => { if (p.endsWith('auth.json')) return JSON.stringify({ accessToken: CURSOR_TOKEN }); if (p.endsWith('.credentials.json')) return JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: T0 + 9e9 } }); throw new Error('ENOENT'); } });
    await svc.tick();
    expect(svc.state().harnesses.map(h => [h.harness, h.status])).toEqual([['claude', 'unreachable'], ['cursor', 'ok']]);
  });

  it('asks the login shell for its environment once, both harnesses being there', async () => {
    let envCalls = 0;
    const svc = createUsage({ home: '/h', env: async () => { envCalls++; return {}; }, file: join(mkdtempSync(join(tmpdir(), 'ledge-usage-')), 'usage.json'), now: () => T0, version: async () => '1',
      get: async () => ({ status: 200, body: JSON.stringify(API), headers: {} }), post: async () => ({ status: 200, body: JSON.stringify(CURSOR_BODY), headers: {} }),
      read: async p => { if (p.endsWith('auth.json')) return JSON.stringify({ accessToken: CURSOR_TOKEN }); if (p.endsWith('.credentials.json')) return JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: T0 + 9e9 } }); throw new Error('ENOENT'); } });
    await svc.tick();
    expect(svc.state().harnesses).toHaveLength(2);
    expect(envCalls).toBe(1);
  });

  it('an alert without a reset drops its ack and its seen entry once it is no longer open', async () => {
    const noEnd = { planUsage: { totalPercentUsed: 90 } };
    const m = cursorMachine({ answers: [{ status: 200, body: noEnd }, { status: 200, body: { planUsage: { totalPercentUsed: 10 } } }, { status: 200, body: noEnd }] });
    await m.svc.tick();
    const id = m.svc.state().alerts[0]!.id;
    expect(id.endsWith('|-')).toBe(true);
    expect(m.svc.ack(id)).toBe(true);
    m.advance(CURSOR_READ_EVERY_MS); await m.svc.tick();
    expect(m.svc.state().alerts).toEqual([]);
    expect(JSON.parse(readFileSync(m.file, 'utf8'))).toMatchObject({ acks: [], seen: {} });
    m.advance(CURSOR_READ_EVERY_MS); await m.svc.tick();
    expect(m.svc.state().alerts).toHaveLength(1); // a new alert, not the one put away
  });

  it('an acked alert without a reset survives an expired session and comes back silent after the token is renewed', async () => {
    const noEnd = { planUsage: { totalPercentUsed: 90 } };
    let auth = JSON.stringify({ accessToken: jwt({ sub: 'A', exp: Math.floor(T0 / 1000) + 99999 }) });
    let t = T0, status = 200;
    const file = join(mkdtempSync(join(tmpdir(), 'ledge-usage-')), 'usage.json');
    const svc = createUsage({ home: '/h', env: async () => ({}), file, now: () => t,
      read: async p => { if (p.endsWith('auth.json')) return auth; throw new Error('ENOENT'); },
      post: async () => ({ status, body: status === 200 ? JSON.stringify(noEnd) : '', headers: {} }) });
    await svc.tick();
    const id = svc.state().alerts[0]!.id;
    expect(svc.ack(id)).toBe(true);
    status = 401; t += CURSOR_READ_EVERY_MS; await svc.tick();
    expect(svc.state().harnesses[0]).toMatchObject({ status: 'expired', windows: [] });
    expect(JSON.parse(readFileSync(file, 'utf8')).acks).toEqual([id]);
    status = 200; auth = JSON.stringify({ accessToken: jwt({ sub: 'A', exp: Math.floor(T0 / 1000) + 199999 }) });
    t += 1000; await svc.tick();
    t += CURSOR_READ_EVERY_MS; await svc.tick();
    expect(svc.state().harnesses[0]).toMatchObject({ status: 'ok' });
    expect(svc.state().alerts).toEqual([]);
  });

  it('another account\'s expired token drops the previous account\'s windows', async () => {
    let auth = JSON.stringify({ accessToken: jwt({ sub: 'A', exp: Math.floor(T0 / 1000) + 99999 }) });
    const svc = createUsage({ home: '/h', env: async () => ({}), file: join(mkdtempSync(join(tmpdir(), 'ledge-usage-')), 'usage.json'), now: () => T0,
      read: async p => { if (p.endsWith('auth.json')) return auth; throw new Error('ENOENT'); },
      post: async () => ({ status: 200, body: JSON.stringify(CURSOR_BODY), headers: {} }) });
    await svc.tick();
    auth = JSON.stringify({ accessToken: jwt({ sub: 'B', exp: Math.floor(T0 / 1000) - 5 }) });
    await svc.tick();
    expect(svc.state().harnesses[0]).toMatchObject({ status: 'expired', windows: [] });
    auth = JSON.stringify({ accessToken: jwt({ sub: 'A', exp: Math.floor(T0 / 1000) + 99999 }) });
    await svc.tick();
    expect(svc.state().harnesses[0]!.windows).toEqual([]); // A's old windows were dropped; B's sign-in cleared them
  });
});
