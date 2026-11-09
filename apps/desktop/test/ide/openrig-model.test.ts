import { describe, expect, it } from 'vitest';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { OpenRigState, Rig, RigSeat, Session } from '@ledge/protocol';
import { navCounts, recentCommands, roleChips, roleLabel, tilesOf, waitingSeats } from '../../src/ide/openrig/model';
import type { RigOutputEntry } from '../../src/openrig/rigOutput';

const seat = (logicalId: string, rig: string, o: Partial<RigSeat> = {}): RigSeat => ({ logicalId, session: `${logicalId.replace('.', '-')}@${rig}`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0, ...o });
const rig = (name: string, status: string, nodes: RigSeat[]): Rig => ({ id: name, name, status, lifecycleState: status, seats: nodes.length, running: status === 'running' ? nodes.length : 0, attention: 0, uptime: null, snapshot: null, nodes });
const STARTED = '2026-11-08T09:12:00.000Z';
const state = (o: Partial<OpenRigState> = {}): OpenRigState => ({
  installed: true, version: '0.7.10', daemon: { state: 'running', startedAt: STARTED }, kernel: { state: 'ready' }, at: '2026-11-08T10:00:00.000Z',
  rigs: [
    rig('kernel', 'running', [seat('advisor.lead', 'kernel'), seat('operator.lead', 'kernel')]),
    rig('ledge-dev', 'running', [seat('dev.build', 'ledge-dev'), seat('dev.review', 'ledge-dev')]),
    rig('synapse-review', 'stopped', [seat('r.s1', 'synapse-review', { stopped: true })])
  ], ...o
});
const waiting = (): Session => fakeSession('b', { name: 'Bix', state: 'waiting_permission', machineId: 'local', rig: { seat: 'dev-build@ledge-dev', name: 'ledge-dev' } });
const entry = (seq: number, machine: string): RigOutputEntry => ({ seq, at: seq, machine, commands: [`rig c${seq}`], ok: true, result: null });

describe('navCounts', () => {
  it('counts rigs with the kernel, roles, machines and output', () => {
    expect(navCounts(state(), 7, 2, 4)).toEqual({ rigs: 3, roles: 7, machines: 2, output: 4 });
  });
  it('leaves out what is not known yet', () => {
    expect(navCounts(null, null, 1, 0)).toEqual({ machines: 1, output: 0 });
  });
});

describe('tilesOf', () => {
  it('counts the rigs without the kernel, and gives the daemon start in local time', () => {
    const t = tilesOf(state(), [], [], 'local', 'fr');
    expect(t.rigs).toEqual({ running: 1, total: 2 });
    expect(t.daemon).toMatchObject({ up: true, version: '0.7.10', since: new Date(STARTED).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) });
    expect(t.kernel).toEqual({ up: true, seats: 2, roles: ['advisor', 'operator'] });
  });
  it('counts a seat whose session waits for a permission as waiting', () => {
    const t = tilesOf(state(), [waiting()], [], 'local', 'en');
    expect(t.seats).toEqual({ active: 4, waiting: 1 });
  });
  it('a stopped daemon has no seats and no start time', () => {
    const t = tilesOf(state({ daemon: { state: 'stopped' }, kernel: { state: 'stopped' }, rigs: [] }), [], [], 'local', 'fr');
    expect(t.daemon.up).toBe(false); expect(t.daemon.since).toBeUndefined();
    expect(t.kernel).toMatchObject({ up: false, seats: 0 }); expect(t.seats).toEqual({ active: 0, waiting: 0 });
  });
});

describe('waitingSeats', () => {
  it('lists the seats whose dot is perm or ask, with their rig', () => {
    const w = waitingSeats(state(), [waiting()], [], 'local');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ rig: 'ledge-dev', kind: 'perm', seat: { logicalId: 'dev.build', name: 'Bix' } });
  });
  it('another machine\'s session does not wait here', () => {
    expect(waitingSeats(state(), [{ ...waiting(), machineId: 'srv' }], [], 'local')).toEqual([]);
  });
});

describe('recentCommands', () => {
  it('keeps the last five of the machine, the latest last', () => {
    const all = [1, 2, 3, 4, 5, 6, 7].map(i => entry(i, i === 4 ? 'srv' : 'local'));
    expect(recentCommands(all, 'local').map(e => e.seq)).toEqual([2, 3, 5, 6, 7]);
    expect(recentCommands(all, 'local', 2).map(e => e.seq)).toEqual([6, 7]);
  });
});

describe('roleChips', () => {
  it('groups the seats by role', () => {
    const r = rig('x', 'running', [seat('dev.build', 'x'), seat('dev.build-2', 'x', { runtime: 'codex' }), seat('dev.review', 'x', { runtime: 'codex' })]);
    expect(roleChips(r)).toEqual([{ role: 'build', runtime: 'claude-code', count: 2 }, { role: 'review', runtime: 'codex', count: 1 }]);
  });
  it('names the kernel’s roles by their pod (its members are all lead, agent or worker)', () => {
    const k = rig('kernel', 'running', [seat('operator.agent', 'kernel'), seat('advisor.lead', 'kernel'), seat('queue.worker', 'kernel')]);
    expect(roleChips(k).map(c => c.role)).toEqual(['operator', 'advisor', 'queue']);
  });
});

describe('roleLabel', () => {
  it('drops the pod and the copy number of a rig’s seat, keeps the pod of a kernel seat', () => {
    expect(roleLabel('ledge-dev', 'dev.build-3')).toBe('build');
    expect(roleLabel('kernel', 'advisor.lead')).toBe('advisor');
    expect(roleLabel('x', 'solo')).toBe('solo');
  });
});
