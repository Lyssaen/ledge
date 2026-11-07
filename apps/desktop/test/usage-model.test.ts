import { describe, expect, it } from 'vitest';
import type { HarnessUsage, UsageAlert, UsageStateMessage } from '@ledge/protocol';
import { isUnread, resetIsDate, resetLong, resetShort, shownWindows, span, usageAlerts, usageGroups, usageThreshold, usageTone } from '../src/usage/model';

const NOW = Date.parse('2026-11-05T13:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const claude = (o: Partial<HarnessUsage> = {}): HarnessUsage => ({
  harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: ago(1),
  windows: [{ kind: 'five_hour', pct: 62, resetsAt: null }, { kind: 'seven_day', pct: 34, resetsAt: null }, { kind: 'model', model: 'Opus', pct: 81, resetsAt: null }, { kind: 'model', model: 'Fable', pct: 12, resetsAt: null }],
  ...o
});
const state = (harnesses: HarnessUsage[], alerts: UsageAlert[] = [], alert = 0.8): UsageStateMessage => ({ type: 'usage.state', harnesses, alerts, prefs: { alert } });
const up = () => true;

describe('usageGroups', () => {
  it('one group per account, the most recent read speaking for it; Codex one per machine; Claude Code first, local first', () => {
    const states = new Map([
      ['devbox', state([claude({ readAt: ago(0.5), windows: [{ kind: 'five_hour', pct: 70, resetsAt: null }] }), { harness: 'codex', account: null, status: 'ok', readAt: ago(2), windows: [] }])],
      ['local', state([{ harness: 'codex', account: null, status: 'ok', readAt: ago(2), windows: [] }, claude()])]
    ]);
    const g = usageGroups(states, up, NOW);
    expect(g.map(x => [x.harness, x.machines.join('+')])).toEqual([['claude', 'local+devbox'], ['codex', 'local'], ['codex', 'devbox']]);
    expect(g[0]!.windows[0]!.pct).toBe(70);
  });

  it('a machine not connected: its values are old, never loading forever; over an hour old, no values at all', () => {
    const g = usageGroups(new Map([['local', state([claude(), claude({ account: 'ffffffffffff', status: 'loading', readAt: null, windows: [] })])], ['devbox', state([claude({ account: '000000000000', readAt: ago(61) })])]]), m => m !== 'local', NOW);
    expect(g.map(x => x.status)).toEqual(['stale', 'stale', 'ok']);
    expect(g[2]!.windows).toEqual([]);
  });
});

it('the threshold is the local machine\'s; alerts once each, newest first', () => {
  const a = (id: string, at: string): UsageAlert => ({ id, harness: 'claude', account: null, window: { kind: 'five_hour', pct: 90, resetsAt: null }, level: 'threshold', at });
  const states = new Map([['devbox', state([], [a('x', ago(5))], 0.6)], ['local', state([], [a('x', ago(5)), a('y', ago(1))], 0.9)]]);
  expect(usageThreshold(states)).toBe(0.9);
  expect(usageThreshold(new Map())).toBe(0.8);
  expect(usageAlerts(states).map(x => x.id)).toEqual(['y', 'x']);
});

it('shows the 5 hours, the week and the models past the threshold; tones', () => {
  const g = usageGroups(new Map([['local', state([claude()])]]), up, NOW)[0]!;
  const s = shownWindows(g, 0.8);
  expect([s.five?.pct, s.week?.pct, s.hot.map(w => w.model), s.models.length]).toEqual([62, 34, ['Opus'], 2]);
  expect([usageTone(79, 0.8), usageTone(80, 0.8), usageTone(100, 0.8)]).toEqual(['', 'amber', 'red']);
});

it('times: today an hour, another day a weekday; spans', () => {
  const local = new Date(NOW);
  const today = new Date(local.getFullYear(), local.getMonth(), local.getDate(), 14, 30).toISOString();
  const monday = new Date(local.getFullYear(), local.getMonth(), local.getDate() + 4, 9, 0).toISOString();
  expect(resetShort(today, NOW, 'fr')).toBe('14:30');
  expect(resetShort(monday, NOW, 'fr')).toBe('lun.');
  expect(resetLong(monday, NOW, 'fr')).toBe('lun. 09:00');
  expect(resetLong(monday, NOW, 'en')).toBe('Mon 09:00');
  expect([span(40_000, 'fr'), span(12 * 60_000, 'fr'), span(130 * 60_000, 'fr'), span(4 * 86_400_000, 'fr')]).toEqual(['40 s', '12 min', '2 h 10', '4 j']);
});

const cursor = (o: Partial<HarnessUsage> = {}): HarnessUsage => ({
  harness: 'cursor', account: '0123456789ab', status: 'ok', readAt: ago(1),
  windows: [{ kind: 'month', pct: 81, resetsAt: null }, { kind: 'pool', pool: 'cursor', pct: 41, resetsAt: null }, { kind: 'pool', pool: 'other', pct: 100, resetsAt: null }],
  ...o
});

it('Claude, Codex and Cursor sort in that order; two machines on one Cursor account are one group, the latest read speaking', () => {
  const states = new Map([
    ['local', state([cursor({ readAt: ago(5) }), { harness: 'codex', account: null, status: 'ok', readAt: ago(2), windows: [] }, claude()])],
    ['devbox', state([cursor({ readAt: ago(1), windows: [{ kind: 'month', pct: 90, resetsAt: null }] })])]
  ]);
  const g = usageGroups(states, up, NOW);
  expect(g.map(x => x.harness)).toEqual(['claude', 'codex', 'cursor']);
  expect(g[2]!.machines).toEqual(['local', 'devbox']);
  expect(g[2]!.windows[0]!.pct).toBe(90);
});

it('shows Cursor\'s month, its pools, and the pools past the threshold; weekly plans show the week alone', () => {
  const g = usageGroups(new Map([['local', state([cursor()])]]), up, NOW)[0]!;
  const s = shownWindows(g, 0.8);
  expect([s.month?.pct, s.week, s.pools.map(w => w.pct), s.hot.map(w => w.pct)]).toEqual([81, undefined, [41, 100], [100]]);
  const w = usageGroups(new Map([['local', state([cursor({ windows: [{ kind: 'seven_day', pct: 30, resetsAt: null }] })])]]), up, NOW)[0]!;
  const t = shownWindows(w, 0.8);
  expect([t.week?.pct, t.month, t.pools, t.hot]).toEqual([30, undefined, [], []]);
  const swapped = usageGroups(new Map([['local', state([cursor({ windows: [{ kind: 'pool', pool: 'other', pct: 5, resetsAt: null }, { kind: 'pool', pool: 'cursor', pct: 9, resetsAt: null }] })])]]), up, NOW)[0]!;
  expect(shownWindows(swapped, 0.8).pools.map(x => x.pool)).toEqual(['cursor', 'other']);
});

it('isUnread: ok, read, and nothing to show', () => {
  expect(isUnread({ status: 'ok', readAt: ago(1), windows: [] })).toBe(true);
  expect(isUnread({ status: 'stale', readAt: ago(1), windows: [] })).toBe(false);
  expect(isUnread({ status: 'loading', readAt: null, windows: [] })).toBe(false);
  expect(isUnread({ status: 'ok', readAt: ago(1), windows: [{ kind: 'month', pct: 1, resetsAt: null }] })).toBe(false);
});

it('a reset a week or more away is a date; closer, a weekday; a past date keeps the old rules', () => {
  const now = new Date(2026, 10, 7, 10, 0).getTime();
  const dec = new Date(2026, 11, 1, 13, 43).toISOString();
  expect([resetShort(dec, now, 'fr'), resetLong(dec, now, 'fr'), resetIsDate(dec, now), resetShort(dec, now, 'en')]).toEqual(['1 déc.', '1 déc. 13:43', true, '1 Dec']);
  const soon = new Date(2026, 10, 9, 9, 0).toISOString();
  expect([resetShort(soon, now, 'fr'), resetIsDate(soon, now)]).toEqual(['lun.', false]);
  const exactly = new Date(now + 7 * 86_400_000).toISOString();
  expect(resetIsDate(exactly, now)).toBe(true);
  const yesterday = new Date(2026, 10, 6, 9, 0).toISOString();
  expect([resetShort(yesterday, now, 'fr'), resetIsDate(yesterday, now)]).toEqual(['ven.', false]);
});
