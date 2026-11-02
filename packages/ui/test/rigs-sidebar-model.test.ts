import { describe, expect, it } from 'vitest';
import type { Escalation, Projects, Rig, RigSeat, Session } from '@ledge/protocol';
import { isStandalone, ledgeLine, rigsModel } from '../src/rigs/model';

const seat = (name: string, over: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@x`, address: `@${name}`, name, runtime: 'claude-code', state: 'ready', ...over });
const rig = (machine: string, id: string, over: Partial<Rig> = {}): Rig => ({ id, name: id, machine, cwd: '/w', projectId: null, offProject: false,
  lifecycle: 'running', kernel: false, seats: [], repos: [], ...over });
const PROJECTS = { projects: [{ id: 'ledge', name: 'Ledge' }], rules: [] } as unknown as Projects;
const STARTER = rig('local', 'r-s', { name: 'starter', seats: [seat('dev', { state: 'working', sessionId: 'local:dev' }), seat('qa', { state: 'stopped' }), seat('pm')] });
const FACTORY = rig('nas', 'r-f', { name: 'factory', projectId: 'ledge', seats: [seat('a', { state: 'working' })] });
const KERNEL = rig('local', 'k', { name: 'kernel', kernel: true, seats: [seat('orch'), seat('advisor'), seat('human', { runtime: 'terminal' }), seat('advisor2')] });
const sess = (id: string, state: Session['state'], r?: Session['rig']): Session => ({ id, name: id, state, ...(r ? { rig: r } : {}) } as Session);
const R = (machine: string, rigId: string) => ({ machine, rigId, rigName: rigId, seat: 's', pod: 'p', member: 'm' });
const esc = (id: string, state: Escalation['state'], over: Partial<Escalation> = {}): Escalation => ({ id, source: 'rig', machine: 'nas', rigId: 'r-f',
  from: 'a@x', intent: 'decision', summary: 's', questions: [], createdAt: '2026-10-31T10:00:00.000Z', state, ...over });

describe('isStandalone', () => {
  it('a session without a rig is standalone', () => expect(isStandalone(sess('a', 'idle'), [STARTER])).toBe(true));
  it('paired to a running seat of a known rig: not standalone', () => expect(isStandalone(sess('local:dev', 'idle', R('local', 'r-s')), [STARTER])).toBe(false));
  it('paired to an unknown rig: standalone', () => expect(isStandalone(sess('local:dev', 'idle', R('local', 'gone')), [rig('nas', 'x')])).toBe(true));
  it('same seat on another machine is unknown', () => expect(isStandalone(sess('local:dev', 'idle', R('nas', 'r-s')), [STARTER])).toBe(true));
  it('stopped seat: standalone', () => expect(isStandalone(sess('local:qa', 'idle', R('local', 'r-s')),
    [rig('local', 'r-s', { seats: [seat('qa', { state: 'stopped', sessionId: 'local:qa' })] })])).toBe(true));
  it('seat without sessionId (pairing race): standalone', () => expect(isStandalone(sess('local:pm', 'idle', R('local', 'r-s')), [STARTER])).toBe(true));
  it('seat paired to another session: standalone', () => expect(isStandalone(sess('local:other', 'idle', R('local', 'r-s')), [STARTER])).toBe(true));
  it('any seat of a kernel counts, hidden ones included', () => expect(isStandalone(sess('local:adv', 'idle', R('local', 'k')),
    [rig('local', 'k', { kernel: true, seats: [seat('advisor', { sessionId: 'local:adv' })] })])).toBe(false));
  it('the brain session is never standalone, with or without rigs', () => {
    const brain = { ...sess('local:brain', 'idle'), brain: true } as Session;
    expect(isStandalone(brain, [])).toBe(false);
    expect(isStandalone(brain, [STARTER])).toBe(false);
  });
  // Lot F: a Ledge team's seat is a session of that team (`team`), not paired by `rig`; it lives in its team's room only while its seat runs.
  describe('a seat of a Ledge team', () => {
    const team = (state: RigSeat['state'], over: Partial<Rig> = {}) => rig('local', 'team-a1b2', { engine: 'ledge', seats: [seat('build', { ref: 'build@team-a1b2', state, sessionId: 'otto' })], ...over });
    const otto = { ...sess('otto', 'working'), team: 'team-a1b2', role: 'build' } as Session;
    it('its seat running: not standalone', () => expect(isStandalone(otto, [team('working')])).toBe(false));
    it('its team at rest (seat stopped): standalone', () => expect(isStandalone(otto, [team('stopped', { lifecycle: 'stopped' })])).toBe(true));
    it('another team, or an OpenRig rig of that id: standalone', () => {
      expect(isStandalone({ ...otto, team: 'team-c3d4' } as Session, [team('working')])).toBe(true);
      const { engine: _, ...openrig } = team('working', { id: 'r-team' });
      expect(isStandalone({ ...otto, team: 'r-team' } as Session, [openrig as Rig])).toBe(true);
    });
  });
});

describe('rigsModel', () => {
  const byId = new Map([['local:dev', sess('local:dev', 'waiting_input')]]);
  const m = rigsModel([STARTER, KERNEL, FACTORY], byId, PROJECTS);
  it('kernel apart, « +2 », factory before starter', () => {
    expect(m.rigs.map(r => r.rig.name)).toEqual(['factory', 'starter']);
    expect(m.kernels).toHaveLength(1);
    expect(m.kernels[0]).toMatchObject({ key: 'local/k', hiddenCount: 3 });
    expect(m.kernels[0]!.shown.map(s => s.name)).toEqual(['orch']);
  });
  it('rows: place, remote, active seats in rig order, waiting from paired sessions', () => {
    const [factory, starter] = m.rigs;
    expect(factory).toMatchObject({ key: 'nas/r-f', place: { kind: 'project', name: 'Ledge' }, remote: true, working: 1, waiting: 0 });
    expect(starter).toMatchObject({ remote: false, working: 1, waiting: 1, place: { kind: 'none' } });
    expect(starter!.seats.map(s => s.name)).toEqual(['local:dev', 'pm']); // paired session keeps its own name
    expect(starter!.seats[0]!.id).toBe('local:dev');
  });
  it('kernel rows skip stopped seats, local first then by machine', () => {
    const kn = (machine: string, over: Partial<Rig> = {}) => rig(machine, 'k' + machine, { kernel: true, seats: [seat('orch'), seat('advisor', { state: 'stopped' }), seat('advisor2')], ...over });
    const k = rigsModel([kn('zeta'), kn('alpha'), kn('local')], new Map(), null).kernels;
    expect(k.map(x => x.rig.machine)).toEqual(['local', 'alpha', 'zeta']);
    expect(k[0]).toMatchObject({ hiddenCount: 1 });
    expect(k[0]!.shown.map(s => s.name)).toEqual(['orch']);
  });
  it('same name: ordered by machine', () => {
    expect(rigsModel([rig('b', 'x', { name: 'f' }), rig('a', 'y', { name: 'f' })], new Map(), null).rigs.map(r => r.rig.machine)).toEqual(['a', 'b']);
  });
  it('a Ledge team at rest keeps its row, with no seat (Review Focus 2)', () => {
    const resting = rig('local', 'team-c3d4', { name: 'mobile', engine: 'ledge', lifecycle: 'stopped', seats: [seat('build', { state: 'stopped', sessionId: 'arlo' })] });
    const rows = rigsModel([resting], new Map(), null).rigs;
    expect(rows.map(r => r.rig.name)).toEqual(['mobile']);
    expect(rows[0]!.seats).toEqual([]);
  });
  it('one kernel per machine', () => {
    const k2 = rig('local', 'k2', { kernel: true });
    expect(rigsModel([KERNEL, k2], new Map(), null).kernels).toHaveLength(1);
  });
});

describe('ledgeLine', () => {
  it('a waiting decision: decision, unread 1, rig of the oldest', () =>
    expect(ledgeLine([esc('e1', 'pending')], [FACTORY])).toMatchObject({ preview: { kind: 'decision', count: 1, rig: 'factory' }, at: '2026-10-31T10:00:00.000Z', unread: 1 }));
  it('several pending: count, rig of the oldest', () => {
    const l = ledgeLine([esc('e2', 'pending', { createdAt: '2026-10-31T11:00:00.000Z', rigId: 'r-s', machine: 'local' }), esc('e1', 'pending'), esc('e3', 'grace')], [FACTORY, STARTER]);
    expect(l).toMatchObject({ preview: { kind: 'decision', count: 2, rig: 'factory' }, unread: 3 });
  });
  it('grace only: grace', () => expect(ledgeLine([esc('e1', 'grace')], [FACTORY])).toMatchObject({ preview: { kind: 'grace', rig: 'factory' }, unread: 1 }));
  it('updates, answered and closed do not count', () => {
    const l = ledgeLine([esc('u', 'pending', { intent: 'update' }), esc('a', 'answered'), esc('c', 'closed')], [FACTORY], { text: 'Hi', at: '2026-10-31T09:00:00.000Z' });
    expect(l).toEqual({ preview: { kind: 'said', text: 'Hi' }, at: '2026-10-31T09:00:00.000Z', unread: 0 });
  });
  it('nothing: calm with the rig count (kernels excluded)', () => expect(ledgeLine([], [FACTORY, STARTER, KERNEL])).toEqual({ preview: { kind: 'calm', rigs: 2 }, unread: 0 }));
  it('unknown rig: no rig name', () => expect(ledgeLine([esc('e1', 'pending', { rigId: undefined })], [FACTORY]).preview).toEqual({ kind: 'decision', count: 1 }));
});
