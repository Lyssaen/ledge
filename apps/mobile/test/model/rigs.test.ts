import { describe, expect, it } from 'vitest';
import type { HumanAsk, PhoneSession } from '@ledge/protocol';
import {
  attentionOf, changeOf, closedTone, daysAgo, kernelSeatName, listedRigs, newestFirst, parseRigTime, permLevelOf, podsOf, rigDot, rigStatus, roleCounts,
  rowTone, runRig, seatLinks, seatName, seatState, specLevel, topSeat, workingSeats
} from '../../src/model/rigs';
import { kernel, ledgeDev, ledgeGraph, openrig, seat, synapse } from './openrig-fixtures';

const session = (extra: Partial<PhoneSession>): PhoneSession => ({
  id: 's1', name: 'dev-front', tool: 'claude', state: 'working', cwd: '~', startedAt: '2026-11-11T09:00:00.000Z', lastEventAt: '2026-11-11T09:00:00.000Z',
  rig: { name: 'ledge-dev', role: 'dev.front' }, ...extra
} as PhoneSession);

describe('rigs model', () => {
  it('says a rig is running, starting, partial or stopped, and nothing else (Q48)', () => {
    expect(rigStatus(ledgeDev())).toBe('running');
    expect(rigStatus(synapse())).toBe('stopped');
    expect(rigStatus(ledgeDev({ status: 'starting' }))).toBe('starting');
    expect(rigStatus(ledgeDev({ nodes: [seat('a.b'), seat('c.d', { stopped: true })] }))).toBe('partial');
  });

  it('lists the rigs without the kernel, the running ones first, in OpenRig order otherwise (Q38)', () => {
    const s = openrig({ rigs: [synapse(), kernel(), ledgeDev()] });
    expect(listedRigs(s).map(r => r.name)).toEqual(['ledge-dev', 'synapse-review']);
  });

  it('counts what waits on the person in a rig: permissions apart, questions with the rows parked on the person', () => {
    const sessions = [
      session({ id: 'a', pending: { kind: 'permission' } as PhoneSession['pending'] }),
      session({ id: 'b', pending: { kind: 'question' } as PhoneSession['pending'] }),
      session({ id: 'c', rig: { name: 'other' }, pending: { kind: 'permission' } as PhoneSession['pending'] })
    ];
    const asks = [{ id: 'q1', kind: 'question', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' } }] as unknown as HumanAsk[];
    const a = attentionOf('ledge-dev', sessions, asks);
    expect(a).toEqual({ perm: 1, ask: 2 });
    expect(rigDot(ledgeDev(), a)).toBe('perm');
    expect(rigDot(ledgeDev(), { perm: 0, ask: 0 })).toBe('work');
    expect(rigDot(synapse(), { perm: 0, ask: 0 })).toBe('off');
  });

  it('reads a seat from its session first, then from OpenRig', () => {
    expect(seatState({ session: session({ state: 'waiting_permission' }), rigStatus: 'running' })).toBe('perm');
    expect(seatState({ session: session({ state: 'waiting_input' }), rigStatus: 'running' })).toBe('ask');
    expect(seatState({ node: seat('dev.front', { work: 2 }), rigStatus: 'running' })).toBe('work');
    expect(seatState({ node: seat('dev.front', { stopped: true }), rigStatus: 'starting' })).toBe('waiting');
    expect(seatState({ node: seat('dev.front'), rigStatus: 'stopped' })).toBe('off');
  });

  it('names a seat by its session, and the kernel operator Max', () => {
    expect(seatName('dev.front')).toBe('dev-front');
    expect(seatName('dev.front', 'front@x')).toBe('front');
    expect(kernelSeatName({ logicalId: 'operator.agent', session: 'operator-agent@kernel' })).toBe('Max');
    expect(kernelSeatName({ logicalId: 'advisor.lead', session: 'advisor@kernel' })).toBe('advisor');
  });

  it('draws the lead alone on top and the other seats by pod', () => {
    const g = ledgeGraph();
    expect(topSeat(g.seats, g.links)).toBe('pilot.lead');
    expect(podsOf(g.seats.filter(s => s.logicalId !== 'pilot.lead'), g.pods).map(p => [p.id, p.seats.length])).toEqual([['design', 1], ['dev', 2], ['review', 1]]);
    expect(topSeat(g.seats, [])).toBeNull();
  });

  it('says how a seat is linked to the others', () => {
    const links = seatLinks('dev.front', ledgeGraph().links);
    expect(links).toEqual([{ kind: 'delegatesTo', who: 'pilot.lead' }, { kind: 'delegates', who: 'review.qa' }, { kind: 'collaborates', who: 'dev.back' }]);
  });

  it('finds the permission level every seat shares, Mixte otherwise', () => {
    const p = (policySource: string, policy?: string) => ({ logicalId: 'a.b', session: 'a-b@r', policySource, ...(policy ? { policy } : {}) });
    expect(permLevelOf([p('member_policy', 'builtin:auto'), p('member_policy', 'builtin:auto')])).toBe('auto');
    expect(permLevelOf([p('member_policy', 'builtin:auto'), p('rig_policy')])).toBe('mixed');
    expect(permLevelOf([p('team_default')])).toBe('spec');
    expect(permLevelOf([])).toBeNull();
    expect(specLevel('builtin:yolo')).toBe('yolo');
    expect(specLevel('custom')).toBeNull();
  });

  it('counts the seats per role and the working ones', () => {
    expect(roleCounts(ledgeDev()).map(r => [r.role, r.count])).toContainEqual(['dev.front', 1]);
    expect(workingSeats(ledgeDev())).toEqual(['dev-front']);
  });

  it('tones a queue row: one parked on the person is « à toi »', () => {
    expect(rowTone({ id: 'q1', state: 'pending' }, [{ id: 'q1' }] as unknown as HumanAsk[])).toBe('mine');
    expect(rowTone({ id: 'q2', state: 'in-progress' }, null)).toBe('progress');
    expect(rowTone({ id: 'q2', state: 'blocked' }, null)).toBe('blocked');
    expect(closedTone('done')).toBe('done');
    expect(closedTone('handed-off')).toBe('handed');
    expect(closedTone('canceled')).toBe('stopped');
  });

  it('reads OpenRig routing words', () => {
    expect(changeOf('handed off to design-ux@ledge-dev')).toEqual({ verb: 'handed', to: 'design-ux' });
    expect(changeOf('blocked on qitem-9')).toEqual({ verb: 'blocked', on: 'qitem-9' });
    expect(changeOf('Claimed')).toEqual({ verb: 'claimed' });
    expect(changeOf('done')).toEqual({ verb: 'completed' });
    expect(changeOf('reshuffled')).toEqual({ verb: 'other', text: 'reshuffled' });
  });

  it('reads OpenRig UTC times and sorts snapshots newest first', () => {
    expect(parseRigTime('2026-11-08 14:54:01')?.toISOString()).toBe('2026-11-08T14:54:01.000Z');
    expect(parseRigTime('nonsense')).toBeNull();
    const snaps = [{ id: 'a', createdAt: '2026-11-08 10:00:00' }, { id: 'b', createdAt: '2026-11-09 09:00:00' }];
    expect(newestFirst(snaps).map(s => s.id)).toEqual(['b', 'a']);
    expect(daysAgo(new Date(2026, 10, 10, 23), new Date(2026, 10, 11, 1))).toBe(1);
  });

  it('finds the rig a run touches: none for the daemon, the kernel or a goal', () => {
    expect(runRig({ kind: 'seats', rig: 'ledge-dev' })).toBe('ledge-dev');
    expect(runRig({ kind: 'act', action: { kind: 'rig.stop', rig: 'ledge-dev' } })).toBe('ledge-dev');
    expect(runRig({ kind: 'act', action: { kind: 'seat.set', seat: 'dev-front@ledge-dev' } })).toBe('ledge-dev');
    expect(runRig({ kind: 'act', action: { kind: 'kernel.stop' } })).toBeNull();
    expect(runRig({ kind: 'goal' })).toBeNull();
  });
});
