import { describe, expect, it } from 'vitest';
import type { PhoneTeam } from '@ledge/protocol';
import { pendingAfter, runningSettings } from '../../src/model/teamsPending';

const team = (seats: PhoneTeam['seats']): PhoneTeam => ({ id: 'team-a1b2', name: 'T', project: 'ledge', state: 'active', createdAt: new Date().toISOString(), done: 0, given: 0, seats });
const defaults = (role: string) => role === 'leader' ? { tool: 'claude', model: 'opus', effort: 'high' } : { tool: 'codex', model: 'gpt-5' };

describe('runningSettings', () => {
  it('resolves each seat\'s own value over its role\'s, leaving seats included', () => {
    const ran = runningSettings(team([{ role: 'leader', sessionId: 's1', model: 'sonnet' }, { role: 'dev', sessionId: 's2', tool: 'omp', leaving: true }]), defaults);
    expect(ran.get('leader')).toStrictEqual({ tool: 'claude', model: 'sonnet', effort: 'high' });
    expect(ran.get('dev')).toStrictEqual({ tool: 'omp', model: 'gpt-5', effort: undefined });
  });
});

describe('pendingAfter', () => {
  const ran = runningSettings(team([{ role: 'leader', sessionId: 's1' }, { role: 'dev', sessionId: 's2' }]), defaults);

  it('leaves nothing when nothing differs', () => {
    expect(pendingAfter(ran, [{ role: 'leader', tool: 'claude', model: 'opus', effort: 'high' }, { role: 'dev', tool: 'codex', model: 'gpt-5' }])).toStrictEqual({});
  });

  it('a tool change needs a restart', () => {
    expect(pendingAfter(ran, [{ role: 'leader', tool: 'codex', model: 'opus', effort: 'high' }])).toStrictEqual({ leader: { restart: true, next: false } });
  });

  it('a model or effort change shows at the next start', () => {
    expect(pendingAfter(ran, [{ role: 'leader', tool: 'claude', model: 'sonnet', effort: 'high' }])).toStrictEqual({ leader: { restart: false, next: true } });
    expect(pendingAfter(ran, [{ role: 'leader', tool: 'claude', model: 'opus', effort: 'low' }])).toStrictEqual({ leader: { restart: false, next: true } });
  });

  it('changing the tool and then back in a second composition leaves no restart', () => {
    const first = pendingAfter(ran, [{ role: 'leader', tool: 'codex', model: 'opus', effort: 'high' }]);
    expect(first.leader?.restart).toBe(true);
    expect(pendingAfter(ran, [{ role: 'leader', tool: 'claude', model: 'opus', effort: 'high' }])).toStrictEqual({});
  });

  it('a seat that left and is added again is compared with what it ran with until it closed', () => {
    const withLeaving = runningSettings(team([{ role: 'leader', sessionId: 's1' }, { role: 'qa', sessionId: 's3', tool: 'claude', leaving: true }]), () => ({ tool: 'codex' }));
    expect(pendingAfter(withLeaving, [{ role: 'qa', tool: 'codex' }])).toStrictEqual({ qa: { restart: true, next: false } });
    expect(pendingAfter(withLeaving, [{ role: 'qa', tool: 'claude' }])).toStrictEqual({});
  });

  it('a seat that was not in the team has nothing to compare with', () => {
    expect(pendingAfter(ran, [{ role: 'rev', tool: 'omp' }])).toStrictEqual({});
  });
});
