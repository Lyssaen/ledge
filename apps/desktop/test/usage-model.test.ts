import { describe, expect, it } from 'vitest';
import type { HarnessUsage, UsageAlert, UsageStateMessage } from '@ledge/protocol';
import { resetLong, resetShort, shownWindows, span, usageAlerts, usageGroups, usageThreshold, usageTone } from '../src/usage/model';

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
