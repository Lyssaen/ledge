import { describe, expect, it } from 'vitest';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { HumanAsk, OpenRigAction, OpenRigState, Rig, RigSeat, Session } from '@ledge/protocol';
import type { MachineState } from '@ledge/fleet';
import { confirmOf, displayedMachine, machineEntries, powerOf, rigsViewOf } from '../../src/ide/rigs/model';
import { commandsOf } from '../../src/openrig/model';

const seat = (logicalId: string, rig: string, o: Partial<RigSeat> = {}): RigSeat => ({ logicalId, session: `${logicalId.replace('.', '-')}@${rig}`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0, ...o });
const rig = (name: string, status: string, nodes: RigSeat[], o: Partial<Rig> = {}): Rig => ({ id: name, name, status, lifecycleState: status, seats: nodes.length, running: status === 'running' ? nodes.length : 0, attention: 0, uptime: null, snapshot: null, nodes, ...o });
const state = (o: Partial<OpenRigState> = {}): OpenRigState => ({
  installed: true, version: '0.7.10', daemon: { state: 'running' }, kernel: { state: 'ready' }, at: '2026-11-08T10:00:00.000Z',
  rigs: [
    rig('kernel', 'running', [seat('a.one', 'kernel'), seat('a.two', 'kernel'), seat('a.three', 'kernel')]),
    rig('ledge-dev', 'running', [seat('dev.build', 'ledge-dev', { activity: 'running' }), seat('dev.review', 'ledge-dev')]),
    rig('synapse-review', 'stopped', [1, 2, 3, 4].map(i => seat(`r.s${i}`, 'synapse-review', { stopped: true })))
  ], ...o
});
const AT = new Date().toISOString();
const build = (o: Partial<Session> = {}): Session => fakeSession('b', { name: 'Bix', state: 'waiting_permission', machineId: 'local', rig: { seat: 'dev-build@ledge-dev', name: 'ledge-dev' }, context: { used: 50, window: 200, at: AT }, ...o });
const ask = (seatName: string): HumanAsk => ({ id: 'q', kind: 'decision', alert: false, priority: 'routine', from: { seat: seatName, rig: 'ledge-dev', role: null }, summary: '', body: '', bodyTruncated: false, detail: null, evidenceRef: null, questions: [], createdAt: AT, updatedAt: AT });
const view = (o: Partial<Parameters<typeof rigsViewOf>[0]> = {}) => rigsViewOf({ state: state(), machine: 'local', sessions: [], asks: [], ...o });

describe('rigsViewOf', () => {
  it('lists the kernel and the rigs', () => {
    const v = view();
    expect(v.status).toBe('running'); expect(v.version).toBe('0.7.10');
    expect(v.kernel?.count).toBe(3); expect(v.kernel?.running).toBe(true);
    expect(v.rigs.map(r => r.name)).toEqual(['ledge-dev', 'synapse-review']);
    expect(v.rigs[1]).toMatchObject({ running: false, dot: 'off', seats: [], count: 0 });
  });
  it('joins a seat to its session, on the same machine only', () => {
    const v = view({ sessions: [build()] });
    expect(v.rigs[0]!.seats[0]).toMatchObject({ logicalId: 'dev.build', name: 'Bix', role: 'dev.build', dot: 'perm', ctx: 25 });
    expect(v.rigs[0]!.dot).toBe('perm');
    const s2 = v.rigs[0]!.seats[1]!;
    expect(s2).toMatchObject({ name: 'dev.review', dot: 'idle' }); expect(s2.session).toBeUndefined(); expect(s2.role).toBeUndefined();
    const other = view({ sessions: [build({ machineId: 'srv' })] }).rigs[0]!.seats[0]!;
    expect(other.session).toBeUndefined(); expect(other.name).toBe('dev.build'); expect(other.dot).toBe('work');
  });
  it('a seat without session and stopped is off', () => {
    const s = state({ rigs: [rig('ledge-dev', 'running', [seat('dev.build', 'ledge-dev', { stopped: true })])] });
    expect(view({ state: s }).rigs[0]!.seats[0]!.dot).toBe('off');
  });
  it('status', () => {
    expect(view({ state: undefined }).status).toBe('loading');
    expect(view({ state: undefined, error: 'offline' }).status).toBe('offline');
    expect(view({ state: state({ installed: false }) }).status).toBe('absent');
    const s = view({ state: state({ daemon: { state: 'stopped' }, rigs: [] }) });
    expect(s).toMatchObject({ status: 'stopped', kernel: null, rigs: [] });
  });
  it('the rig dot is its worst seat: perm, ask, work, idle', () => {
    const sess = (id: string, st: Session['state'], seatName: string) => fakeSession(id, { state: st, machineId: 'local', rig: { seat: seatName, name: 'ledge-dev' } });
    const st = state({ rigs: [rig('ledge-dev', 'running', [seat('dev.build', 'ledge-dev'), seat('dev.review', 'ledge-dev')])] });
    const dot = (sessions: Session[], asks: HumanAsk[] = []) => rigsViewOf({ state: st, machine: 'local', sessions, asks }).rigs[0]!.dot;
    const b = (s: Session['state']) => sess('1', s, 'dev-build@ledge-dev'); const r = (s: Session['state']) => sess('2', s, 'dev-review@ledge-dev');
    expect(dot([b('working'), r('idle')])).toBe('work');
    expect(dot([b('working'), r('waiting_input')])).toBe('ask');
    expect(dot([b('waiting_permission'), r('waiting_input'), ])).toBe('perm');
    expect(dot([b('idle'), r('idle')])).toBe('idle');
    expect(dot([b('idle'), r('idle')], [ask('dev-review@ledge-dev')])).toBe('ask');
    expect(dot([b('working'), r('idle')], [ask('dev-review@ledge-dev')])).toBe('ask');
  });
});

describe('machines', () => {
  const m = (id: string, o: Partial<MachineState> = {}): MachineState => ({ id, label: id, ready: true, ...o } as MachineState);
  it('entries', () => {
    const es = machineEntries([m('local'), m('srv', { ssh: 'srv' }), m('bad', { ssh: 'bad' }), m('down', { ssh: 'd', ready: false }), m('new', { ssh: 'n' })], new Map([['local', state()], ['srv', state()], ['bad', state()], ['down', state()]]), new Set(['bad']));
    expect(es.map(e => e.kind)).toEqual(['local', 'ssh', 'ssh', 'ssh', 'ssh']);
    expect(es[0]).toMatchObject({ status: 'running', running: 1 });
    expect(es.slice(2).map(e => e.status)).toEqual(['offline', 'offline', 'loading']);
  });
  it('displayedMachine', () => {
    const ms = [m('local'), m('srv')];
    expect(displayedMachine('srv', ms)).toBe('srv'); expect(displayedMachine('x', ms)).toBe('local'); expect(displayedMachine(null, ms)).toBe('local');
  });
});

describe('power and actions', () => {
  it('powerOf', () => { expect(powerOf(true)).toEqual(['restart', 'stop']); expect(powerOf(false)).toEqual(['start']); });
  it('confirmOf names who works', () => {
    const a: OpenRigAction = { kind: 'rig.stop', rig: 'ledge-dev' };
    expect(confirmOf(state(), a, [build({ name: 'Bix' })], 'local')).toEqual({ working: ['Bix'], commands: commandsOf(a), restart: false });
    expect(confirmOf(state(), a, [], 'local').working).toEqual(['dev.build']);
    expect(confirmOf(state(), { kind: 'rig.restart', rig: 'ledge-dev' }, [], 'local').restart).toBe(true);
  });
});
