import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CURSOR_USAGE_URL, parseCursorUsage, readCursorToken } from '../src/daemon/usage/cursor.js';

const files = (m: Record<string, string>) => async (p: string) => { if (p in m) return m[p]!; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
const NOW = Date.parse('2026-11-07T12:00:00.000Z');
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
const auth = (accessToken: unknown) => JSON.stringify({ accessToken, refreshToken: 'never-read' });
const DAY = 86_400_000;

describe('readCursorToken', () => {
  it('reads auth.json: the token, and an opaque 12-hex account from the JWT sub, the same for the same sub', async () => {
    const token = jwt({ sub: 'auth0|u1', exp: (NOW + 5 * DAY) / 1000 });
    const r = await readCursorToken('/h', {}, NOW, files({ '/h/.config/cursor/auth.json': auth(token) }));
    expect(r).toEqual({ token, account: createHash('sha256').update('ledge-usage:cursor:auth0|u1').digest('hex').slice(0, 12) });
    expect((r as { account: string }).account).toMatch(/^[0-9a-f]{12}$/);
    const other = jwt({ sub: 'auth0|u1', exp: (NOW + 1 * DAY) / 1000, iat: 1 });
    const r2 = await readCursorToken('/h', {}, NOW, files({ '/h/.config/cursor/auth.json': auth(other) }));
    expect((r2 as { account: string }).account).toBe((r as { account: string }).account);
    const r3 = await readCursorToken('/h', {}, NOW, files({ '/h/.config/cursor/auth.json': auth(jwt({ sub: 'auth0|u2', exp: (NOW + DAY) / 1000 })) }));
    expect((r3 as { account: string }).account).not.toBe((r as { account: string }).account);
  });
  it('says expired once the JWT exp has passed', async () => {
    const token = jwt({ sub: 'auth0|u1', exp: (NOW - 1000) / 1000 });
    expect(await readCursorToken('/h', {}, NOW, files({ '/h/.config/cursor/auth.json': auth(token) }))).toMatchObject({ expired: true, account: expect.stringMatching(/^[0-9a-f]{12}$/) });
  });
  it('is null when the file is absent, not JSON, or has no accessToken', async () => {
    expect(await readCursorToken('/h', {}, NOW, files({}))).toBeNull();
    expect(await readCursorToken('/h', {}, NOW, files({ '/h/.config/cursor/auth.json': '{' }))).toBeNull();
    expect(await readCursorToken('/h', {}, NOW, files({ '/h/.config/cursor/auth.json': auth('') }))).toBeNull();
    expect(await readCursorToken('/h', {}, NOW, files({ '/h/.config/cursor/auth.json': auth('  ') }))).toBeNull();
    expect(await readCursorToken('/h', {}, NOW, files({ '/h/.config/cursor/auth.json': '[]' }))).toBeNull();
    expect(await readCursorToken('/h', {}, NOW, files({ '/h/.config/cursor/auth.json': JSON.stringify({ refreshToken: 'x' }) }))).toBeNull();
  });
  it('reads $CURSOR_CONFIG_DIR/auth.json when the environment names it', async () => {
    const token = jwt({ sub: 'auth0|u1', exp: (NOW + DAY) / 1000 });
    const r = await readCursorToken('/h', { CURSOR_CONFIG_DIR: '/c' }, NOW, files({ '/c/auth.json': auth(token), '/h/.config/cursor/auth.json': auth('other') }));
    expect(r).toMatchObject({ token });
  });
  it('still returns a token that is not a JWT, with no account: the API decides', async () => {
    expect(await readCursorToken('/h', {}, NOW, files({ '/h/.config/cursor/auth.json': auth('opaque-token') }))).toEqual({ token: 'opaque-token', account: null });
    expect(await readCursorToken('/h', {}, NOW, files({ '/h/.config/cursor/auth.json': auth('a.%%%.c') }))).toEqual({ token: 'a.%%%.c', account: null });
  });
});

describe('parseCursorUsage', () => {
  const ms = (iso: string) => String(Date.parse(iso));
  const study = {
    billingCycleStart: ms('2026-11-01T12:43:00.000Z'), billingCycleEnd: ms('2026-12-01T12:43:00.000Z'),
    planUsage: { totalPercentUsed: 12.4, autoPercentUsed: 8, apiPercentUsed: 56, totalSpend: 500, includedSpend: 500, limit: 2000 }
  };
  const end = '2026-12-01T12:43:00.000Z';
  it('names its URL', () => { expect(CURSOR_USAGE_URL).toBe('https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage'); });
  it('is the month total, then the two pools', () => {
    expect(parseCursorUsage(study)).toEqual([
      { kind: 'month', pct: 12, resetsAt: end },
      { kind: 'pool', pool: 'cursor', pct: 8, resetsAt: end },
      { kind: 'pool', pool: 'other', pct: 56, resetsAt: end }
    ]);
  });
  it('is the week total when the cycle is under 10 days; a cycle it cannot measure is a month', () => {
    const week = { billingCycleStart: ms('2026-11-03T00:00:00.000Z'), billingCycleEnd: ms('2026-11-10T00:00:00.000Z'), planUsage: { totalPercentUsed: 41.6 } };
    expect(parseCursorUsage(week)).toEqual([{ kind: 'seven_day', pct: 42, resetsAt: '2026-11-10T00:00:00.000Z' }]);
    expect(parseCursorUsage({ ...week, billingCycleStart: undefined })).toEqual([{ kind: 'month', pct: 42, resetsAt: '2026-11-10T00:00:00.000Z' }]);
  });
  it('reads a cycle that ends before it starts as a month, not a week', () => {
    const odd = { billingCycleStart: ms('2026-11-10T00:00:00.000Z'), billingCycleEnd: ms('2026-11-03T00:00:00.000Z'), planUsage: { totalPercentUsed: 10 } };
    expect(parseCursorUsage(odd)).toEqual([{ kind: 'month', pct: 10, resetsAt: '2026-11-03T00:00:00.000Z' }]);
  });
  it('accepts numeric dates; an unreadable end is a null resetsAt', () => {
    expect(parseCursorUsage({ ...study, billingCycleEnd: Date.parse(end), billingCycleStart: Date.parse('2026-11-01T12:43:00.000Z') })?.[0]).toEqual({ kind: 'month', pct: 12, resetsAt: end });
    expect(parseCursorUsage({ ...study, billingCycleEnd: 'soon' })?.[0]).toEqual({ kind: 'month', pct: 12, resetsAt: null });
    expect(parseCursorUsage({ ...study, billingCycleEnd: undefined })?.[0]).toEqual({ kind: 'month', pct: 12, resetsAt: null });
  });
  it('is [] (« not read »), never recomputed, without planUsage or without totalPercentUsed; null when the body is not an object', () => {
    expect(parseCursorUsage({ billingCycleStart: study.billingCycleStart })).toEqual([]);
    expect(parseCursorUsage({ ...study, planUsage: { includedSpend: 500, limit: 2000, autoPercentUsed: 8 } })).toEqual([]);
    expect(parseCursorUsage({ ...study, planUsage: { totalPercentUsed: '12' } })).toEqual([]);
    expect(parseCursorUsage('x')).toBeNull();
    expect(parseCursorUsage(null)).toBeNull();
    expect(parseCursorUsage([])).toBeNull();
  });
  it('rounds and bounds percentages 0..1000; a pool that is not a finite number is left out, the rest kept', () => {
    expect(parseCursorUsage({ ...study, planUsage: { totalPercentUsed: -3 } })).toEqual([{ kind: 'month', pct: 0, resetsAt: end }]);
    expect(parseCursorUsage({ ...study, planUsage: { totalPercentUsed: 1234.6 } })?.[0]?.pct).toBe(1000);
    expect(parseCursorUsage({ ...study, planUsage: { totalPercentUsed: 12.4, autoPercentUsed: 8, apiPercentUsed: '56' } })).toEqual([
      { kind: 'month', pct: 12, resetsAt: end }, { kind: 'pool', pool: 'cursor', pct: 8, resetsAt: end }
    ]);
    expect(parseCursorUsage({ ...study, planUsage: { totalPercentUsed: 12, autoPercentUsed: NaN, apiPercentUsed: Infinity } })).toEqual([{ kind: 'month', pct: 12, resetsAt: end }]);
    expect(parseCursorUsage({ ...study, planUsage: { totalPercentUsed: NaN } })).toEqual([]);
  });
});
