import { expect, it } from 'vitest';
import type { UsageStateMessage } from '@ledge/protocol';
import { usageGroups } from '../src/usage/model';
import { shownGroups } from '../src/usage/UsageFooter';

// #301 review (review-qa): a refused machine must not hide a valid read of the same account on another.
it('un autre ordinateur qui lit le même compte garde ses limites quand la machine locale est refusée', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');
  const mk = (status: 'ok' | 'expired', minutes: number): UsageStateMessage => ({type:'usage.state', prefs:{alert:0.8}, alerts:[], harnesses:[{harness:'claude', account:'shared', status, readAt:new Date(now-minutes*60000).toISOString(), windows:status === 'ok' ? [{kind:'five_hour',pct:42,resetsAt:null}] : []}]});
  const states = new Map([['local', mk('expired', 1)], ['other', mk('ok', 2)]]);
  const result = shownGroups(usageGroups(states, () => true, now));
  expect(result).toHaveLength(1);
  expect(result[0]!.windows[0]!.pct).toBe(42);
});
