import { describe, expect, it } from 'vitest';
import { parseClaudeUsage, readClaudeAccount, readClaudeToken } from '../src/daemon/usage/claude.js';
import { bypassProxy, proxyFor } from '../src/daemon/usage/net.js';

const files = (m: Record<string, string>) => async (p: string) => { if (p in m) return m[p]!; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
const NOW = Date.parse('2026-11-05T14:00:00.000Z');

describe('readClaudeToken', () => {
  it('reads Claude Code\'s token from its credentials, and says expired once its time is past', async () => {
    const creds = (expiresAt?: number) => JSON.stringify({ claudeAiOauth: { accessToken: 'tok-1', refreshToken: 'never-read', ...(expiresAt ? { expiresAt } : {}), subscriptionType: 'max' } });
    expect(await readClaudeToken('/h', {}, NOW, files({ '/h/.claude/.credentials.json': creds(NOW + 60_000) }))).toEqual({ token: 'tok-1', from: 'file' });
    expect(await readClaudeToken('/h', {}, NOW, files({ '/h/.claude/.credentials.json': creds() }))).toEqual({ token: 'tok-1', from: 'file' });
    expect(await readClaudeToken('/h', {}, NOW, files({ '/h/.claude/.credentials.json': creds(NOW - 1) }))).toBe('expired');
  });
  it('takes CLAUDE_CODE_OAUTH_TOKEN first; no file, a broken one or no token is « not signed in »', async () => {
    expect(await readClaudeToken('/h', { CLAUDE_CODE_OAUTH_TOKEN: ' env-tok ' }, NOW, files({}))).toEqual({ token: 'env-tok', from: 'env' });
    expect(await readClaudeToken('/h', {}, NOW, files({}))).toBeNull();
    expect(await readClaudeToken('/h', {}, NOW, files({ '/h/.claude/.credentials.json': '{' }))).toBeNull();
    expect(await readClaudeToken('/h', {}, NOW, files({ '/h/.claude/.credentials.json': '{"claudeAiOauth":{}}' }))).toBeNull();
  });
});

describe('readClaudeAccount', () => {
  it('is an opaque 12-hex id, the same for the same account, never the uuid nor the email', async () => {
    const cfg = (account: string, org = 'org-1') => JSON.stringify({ oauthAccount: { accountUuid: account, organizationUuid: org, emailAddress: 'someone@example.com' } });
    const a = await readClaudeAccount('/h', files({ '/h/.claude.json': cfg('acc-1') }));
    const b = await readClaudeAccount('/other', files({ '/other/.claude.json': cfg('acc-1') }));
    const c = await readClaudeAccount('/h', files({ '/h/.claude.json': cfg('acc-2') }));
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(a).not.toContain('acc');
    expect(await readClaudeAccount('/h', files({ '/h/.claude.json': '{}' }))).toBeNull();
    expect(await readClaudeAccount('/h', files({}))).toBeNull();
  });
});

describe('parseClaudeUsage', () => {
  it('reads the 5 hours and the week, then one week per model (flat fields first, then limits[] weekly_scoped), nothing else', () => {
    const w = parseClaudeUsage({
      five_hour: { utilization: 84.4, resets_at: '2026-11-05T14:30:00+00:00' },
      seven_day: { utilization: 34, resets_at: '2026-11-09T09:00:00Z' },
      seven_day_opus: { utilization: 100, resets_at: '2026-11-09T09:00:00Z' },
      seven_day_oauth_apps: { utilization: 3 },
      extra_usage: { utilization: 12, spent_usd: 4 },
      limits: [
        { kind: 'weekly_scoped', percent: 71, resets_at: '2026-11-09T09:00:00Z', scope: { model: { display_name: 'Fable' } } },
        { kind: 'weekly_scoped', percent: 50, is_active: false, scope: { model: { display_name: 'Opus' } } },
        { kind: 'weekly_scoped', percent: 9, scope: { model: { display_name: '' } } },
        { kind: 'five_hour', percent: 99 }
      ]
    });
    expect(w).toEqual([
      { kind: 'five_hour', pct: 84, resetsAt: '2026-11-05T14:30:00.000Z' },
      { kind: 'seven_day', pct: 34, resetsAt: '2026-11-09T09:00:00.000Z' },
      { kind: 'model', model: 'Opus', pct: 100, resetsAt: '2026-11-09T09:00:00.000Z' },
      { kind: 'model', model: 'Fable', pct: 71, resetsAt: '2026-11-09T09:00:00.000Z' }
    ]);
  });
  it('anything that is not the API\'s answer gives no window', () => {
    for (const b of [undefined, null, 'x', [], {}, { five_hour: { utilization: 'high' } }]) expect(parseClaudeUsage(b)).toEqual([]);
  });
});

describe('the proxy', () => {
  it('takes https_proxy as curl does, unless no_proxy names the host', () => {
    const u = new URL('https://api.anthropic.com/api/oauth/usage');
    expect(proxyFor(u, { https_proxy: 'http://192.168.40.2:3128' })?.host).toBe('192.168.40.2:3128');
    expect(proxyFor(u, { HTTPS_PROXY: '192.168.40.2:3128' })?.host).toBe('192.168.40.2:3128');
    expect(proxyFor(u, {})).toBeNull();
    expect(proxyFor(u, { https_proxy: 'http://p:3128', no_proxy: 'localhost,.anthropic.com' })).toBeNull();
    expect(proxyFor(u, { https_proxy: 'socks5://p:1080' })).toBeNull();
    expect(bypassProxy('api.anthropic.com', 'anthropic.com')).toBe(true);
    expect(bypassProxy('api.anthropic.com', '127.0.0.1,localhost')).toBe(false);
    expect(bypassProxy('x.y', '*')).toBe(true);
  });
});
