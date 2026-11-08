import { describe, expect, it } from 'vitest';
import type { RigGraph, RigRow, RigSeatPermission, Session, Rig } from '@ledge/protocol';
import { RIG_7A } from '../../e2e/openrig-fixtures';
import { layoutOf, parseRigRef, permLevelOf, policyOf, queueLines, rigTabRef, roleCounts, seatDraft } from '../../src/ide/rig/model';

const survey = RIG_7A.rigGraphs['ledge-survey'] as RigGraph;
const kernel: RigGraph = {
  pods: [{ id: 'advisor', label: 'Advisor' }, { id: 'operator', label: 'Operator' }, { id: 'queue', label: 'Queue' }],
  seats: [
    { logicalId: 'advisor.lead', pod: 'advisor', runtime: 'claude-code', status: 'running', attention: false },
    { logicalId: 'operator.agent', pod: 'operator', runtime: 'claude-code', status: 'running', attention: false },
    { logicalId: 'operator.human', pod: 'operator', runtime: 'human', status: 'running', attention: false },
    { logicalId: 'queue.worker', pod: 'queue', runtime: 'claude-code', status: 'exited', attention: false }
  ],
  links: [
    { from: 'advisor.lead', to: 'operator.agent', kind: 'delegates_to' },
    { from: 'operator.agent', to: 'operator.human', kind: 'escalates_to' },
    { from: 'operator.agent', to: 'ghost.seat', kind: 'delegates_to' }
  ]
};
const session = (over: Partial<Session>): Session => ({ id: 'local:s1', name: 'Bix', state: 'working', machineId: 'local', rig: { seat: 'dev-build@ledge-survey' }, ...over }) as unknown as Session;
const perm = (over: Partial<RigSeatPermission>): RigSeatPermission => ({ logicalId: 'a.b', session: 'a-b@r', ...over });

describe('rig ref', () => {
  it('splits at the first colon', () => {
    expect(parseRigRef('srv:ledge-dev')).toEqual({ machine: 'srv', rig: 'ledge-dev' });
    expect(parseRigRef('nocolon')).toBeNull();
    expect(rigTabRef('local', 'kernel')).toBe('local:kernel');
  });
});

describe('layoutOf', () => {
  it('draws one column per pod, one node per seat, one edge per resolvable link', () => {
    const l = layoutOf(kernel, [], 'local', true);
    expect(l.nodes).toHaveLength(4);
    expect(l.edges.map(e => `${e.from}>${e.to}`)).toEqual(['advisor.lead>operator.agent', 'operator.agent>operator.human']);
    const x = (id: string) => l.nodes.find(n => n.logicalId === id)!.x;
    expect(x('operator.agent')).toBe(x('operator.human'));
    expect(l.pods.map(p => p.id)).toEqual(['advisor', 'operator', 'queue']);
    expect(l.pods[0]!.x).toBeLessThan(l.pods[1]!.x);
    expect(l.pods[1]!.x).toBeLessThan(l.pods[2]!.x);
    expect(l.edges.every(e => e.path.startsWith('M'))).toBe(true);
    for (const n of l.nodes) { expect(n.x + 150).toBeLessThanOrEqual(l.width); expect(n.y + 44).toBeLessThanOrEqual(l.height); }
  });
  it('turns every dot off for a stopped rig', () => {
    expect(layoutOf(survey, [], 'local', false).nodes.every(n => n.dot === 'off')).toBe(true);
  });
  it('names a joined seat after its session and reads its dot', () => {
    const l = layoutOf(survey, [session({ state: 'waiting_permission' })], 'local', true);
    const n = l.nodes.find(n => n.logicalId === 'dev.build')!;
    expect(n.name).toBe('Bix');
    expect(n.dot).toBe('perm');
    expect(n.session?.id).toBe('local:s1');
    const other = l.nodes.find(n => n.logicalId === 'dev.review')!;
    expect(other.name).toBe('dev.review');
    expect(other.dot).toBe('idle');
  });
  it('maps an unjoined seat by its status: exited is off', () => {
    expect(layoutOf(kernel, [], 'local', true).nodes.find(n => n.logicalId === 'queue.worker')!.dot).toBe('off');
  });
  it('handles an empty graph', () => {
    const l = layoutOf({ pods: [], seats: [], links: [] }, [], 'local', true);
    expect(l.nodes).toEqual([]);
    expect(l.width).toBeGreaterThan(0);
  });
});

describe('permissions', () => {
  it('policyOf', () => { expect(policyOf('open')).toBe('open'); expect(policyOf('spec')).toBe('spec'); expect(policyOf('locked')).toBe('locked'); });
  it('permLevelOf', () => {
    expect(permLevelOf([perm({ policySource: 'rig_policy' }), perm({ policySource: 'kernel_default' })])).toBe('spec');
    expect(permLevelOf([perm({ policySource: 'member_policy', policy: 'builtin:yolo' }), perm({ policySource: 'member_policy', policy: 'builtin:yolo' })])).toBe('yolo');
    expect(permLevelOf([perm({ policySource: 'member_policy', policy: 'builtin:locked' })])).toBe('locked');
    expect(permLevelOf([perm({ policySource: 'member_policy', policy: 'builtin:standard' }), perm({ policySource: 'rig_policy' })])).toBe('mixed');
    expect(permLevelOf([perm({ policySource: 'explicit' })])).toBe('mixed');
    expect(permLevelOf([perm({})])).toBe('mixed');
    expect(permLevelOf([perm({ policySource: 'member_policy', policy: 'none' })])).toBe('mixed');
    expect(permLevelOf([])).toBeNull();
  });
});

describe('seats', () => {
  const rig = { nodes: ['dev.build', 'dev.build-2', 'dev.review'].map(logicalId => ({ logicalId, runtime: logicalId === 'dev.review' ? 'codex' : 'claude-code' })) } as unknown as Rig;
  it('roleCounts', () => {
    expect(roleCounts(rig)).toEqual([{ role: 'dev.build', runtime: 'claude-code', count: 2 }, { role: 'dev.review', runtime: 'codex', count: 1 }]);
  });
  const counts = roleCounts(rig);
  it('seatDraft', () => {
    expect(seatDraft(counts, { 'dev.build': 0 }).seats['dev.build']).toBe(1);
    expect(seatDraft(counts, { 'dev.build': 0 }).changed).toBe(true);
    expect(seatDraft(counts, { gone: 3, 'dev.build': 3 }).seats).toEqual({ 'dev.build': 3, 'dev.review': 1 });
    expect(seatDraft(counts, { 'dev.build': 2, 'dev.review': 1 }).changed).toBe(false);
    expect(seatDraft(counts, {})).toEqual({ seats: { 'dev.build': 2, 'dev.review': 1 }, changed: false });
  });
});

describe('queueLines', () => {
  const now = Date.parse('2026-11-08T15:05:00.000Z');
  const row = (extra: Partial<RigRow>): RigRow => ({ id: 'qitem-1', state: 'pending', summary: 'Run', from: 'operator-human@kernel', to: 'dev-build@ledge-survey', createdAt: '2026-11-08T15:00:00.000Z', updatedAt: '2026-11-08T15:00:00.000Z', at: '2026-11-08T15:05:00.000Z', ...extra });
  it('maps rows', () => {
    const [l] = queueLines([row({ needsInput: { count: 1, reason: null } })], [session({})], 'local', now);
    expect(l).toEqual({ id: 'qitem-1', state: 'pending', needsInput: true, summary: 'Run', from: 'operator-human@kernel', to: 'Bix', age: '5 min' });
  });
  it('defaults and long ages', () => {
    const [l] = queueLines([row({ summary: undefined, updatedAt: '2026-11-08T12:00:00.000Z' })], [], 'local', now);
    expect(l).toMatchObject({ needsInput: false, summary: '', to: 'dev-build@ledge-survey', age: '3 h' });
  });
});
