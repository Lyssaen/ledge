import { describe, expect, it } from 'vitest';
import type { OpenRigState, Rig, RigSpec } from '@ledge/protocol';
import { emptyForm } from '../../src/openrig/model';
import { emptySeats, fromChoices, launchProblem, liveCommand, newLaunch, pickFrom, relaunchActions } from '../../src/ide/launch-rig/model';

const spec = (name: string, roles: Array<[string, string]>, source = 'builtin'): RigSpec => ({
  name, source, path: `/specs/${name}.yaml`, edges: 0,
  pods: [...new Set(roles.map(r => r[0]))].map(id => ({ id, members: roles.filter(r => r[0] === id).map(r => ({ id: r[1], runtime: 'claude-code', agent: 'x' })) }))
});
const starter = spec('starter', [['dev', 'builder'], ['review', 'reviewer']]);
const factory = spec('factory', [['orch', 'lead'], ['orch', 'advisor'], ['dev', 'build'], ['dev', 'qa'], ['dev', 'design'], ['review', 'r1'], ['review', 'r2']]);
const survey = spec('ledge-survey', [['dev', 'builder']], 'user');
const rig = (name: string, status: string, running: number): Rig => ({ id: name, name, status, lifecycleState: status, seats: 2, running, attention: 0, uptime: null, snapshot: null, nodes: [] });
const state: OpenRigState = {
  installed: true, daemon: { state: 'running' }, kernel: { state: 'ready' }, at: '2026-11-08T10:00:00Z',
  rigs: [rig('kernel', 'running', 1), rig('ledge-dev', 'running', 2), rig('ledge-survey', 'stopped', 0)]
};

describe('fromChoices', () => {
  const c = fromChoices([starter, factory, survey], state, true);
  it('lists rigs (kernel out), then specs without a rig of their name, the empty rig, the operator', () => {
    expect(c.map(x => x.from)).toEqual([
      { kind: 'rig', rig: 'ledge-dev' }, { kind: 'rig', rig: 'ledge-survey' },
      { kind: 'spec', spec: 'starter' }, { kind: 'spec', spec: 'factory' }, { kind: 'empty' }, { kind: 'operator' }
    ]);
  });
  it('greys a running rig, not a stopped one', () => {
    expect(c[0]).toMatchObject({ running: true, disabled: 'running' });
    expect(c[1]).toMatchObject({ running: false, disabled: false });
    expect(c[2]).toMatchObject({ title: 'starter', seats: 2, source: 'builtin', disabled: false });
  });
  it('greys the empty rig without factory and the operator without a kernel', () => {
    const d = fromChoices([starter], state, false);
    expect(d.find(x => x.from.kind === 'empty')?.disabled).toBe('noFactory');
    expect(d.find(x => x.from.kind === 'operator')?.disabled).toBe('kernel');
    expect(c.find(x => x.from.kind === 'empty')?.disabled).toBe(false);
  });
});

describe('emptySeats', () => {
  it('is computed on the spec: lead and build at 1, the rest at 0', () => {
    expect(emptySeats(factory)).toEqual({ 'orch.lead': 1, 'dev.build': 1, 'orch.advisor': 0, 'dev.qa': 0, 'dev.design': 0, 'review.r1': 0, 'review.r2': 0 });
    expect(emptySeats(starter)).toEqual({ 'dev.builder': 0, 'review.reviewer': 0 });
  });
});

describe('pickFrom', () => {
  const c = fromChoices([starter, factory], state, true);
  it('keeps a live, active choice', () => {
    expect(pickFrom(c, { kind: 'spec', spec: 'starter' })).toEqual({ kind: 'spec', spec: 'starter' });
  });
  it('takes the first active card when the choice vanished or is greyed', () => {
    expect(pickFrom(c, { kind: 'spec', spec: 'gone' })).toEqual({ kind: 'rig', rig: 'ledge-survey' });
    expect(pickFrom(c, { kind: 'rig', rig: 'ledge-dev' })).toEqual({ kind: 'rig', rig: 'ledge-survey' });
    expect(pickFrom(c, null)).toEqual({ kind: 'rig', rig: 'ledge-survey' });
  });
  it('is null with nothing active', () => { expect(pickFrom([], null)).toBeNull(); });
});

describe('launchProblem', () => {
  const ok = { ...emptyForm(starter, '/p'), name: 'new-one' };
  it('is null for a good form', () => { expect(launchProblem(ok, state, starter)).toBeNull(); });
  it('names the first problem', () => {
    expect(launchProblem({ ...ok, name: 'ledge-survey' }, state, starter)).toBe('exists');
    expect(launchProblem({ ...ok, name: 'ledge-dev' }, state, starter)).toBe('exists');
    expect(launchProblem({ ...ok, name: 'bad name!' }, state, starter)).toBe('name');
    expect(launchProblem({ ...ok, cwd: ' ' }, state, starter)).toBe('cwd');
    expect(launchProblem({ ...ok, seats: emptySeats(starter), }, state, starter)).toBe('noSeat');
  });
  it('knows an unset role still launches one seat when it has the spec', () => {
    expect(launchProblem({ ...ok, seats: { 'dev.builder': 0 } }, state, starter)).toBeNull();
    expect(launchProblem({ ...ok, seats: { 'dev.builder': 0, 'review.reviewer': 0 } }, state, starter)).toBe('noSeat');
  });
});

describe('newLaunch', () => {
  const f = { ...emptyForm(starter, '/p'), name: 'x' };
  it('passes no policy for spec, the level otherwise', () => {
    expect(newLaunch(starter, f, 'spec', false)).not.toHaveProperty('policy');
    expect(newLaunch(starter, f, 'open', false)).toMatchObject({ policy: 'open' });
    expect(newLaunch(starter, f, 'spec', true)).toMatchObject({ plan: true });
  });
});

describe('relaunchActions', () => {
  const seats = ['dev.builder', 'dev.reviewer'];
  it('sets the policy first when the level differs, then starts', () => {
    expect(relaunchActions('ledge-survey', 'standard', 'spec', seats, true)).toEqual([
      { kind: 'rig.policy', rig: 'ledge-survey', policy: 'standard', seats: ['dev.builder@ledge-survey', 'dev.reviewer@ledge-survey'] },
      { kind: 'rig.start', rig: 'ledge-survey' }
    ]);
  });
  it('only starts at the same level, with a mixed rig untouched or no level', () => {
    expect(relaunchActions('ledge-survey', 'standard', 'standard', seats, true)).toEqual([{ kind: 'rig.start', rig: 'ledge-survey' }]);
    expect(relaunchActions('ledge-survey', null, 'mixed', seats, true)).toEqual([{ kind: 'rig.start', rig: 'ledge-survey' }]);
  });
  it('starts the seats fresh (bare ids) when not resuming', () => {
    expect(relaunchActions('ledge-survey', 'spec', 'spec', seats, false)).toEqual([{ kind: 'rig.start', rig: 'ledge-survey', fresh: seats }]);
  });
});

describe('liveCommand', () => {
  const startAction = { kind: 'daemon.start', restore: 'none' } as const;
  it('shows a relaunch, daemon start first when the daemon is down', () => {
    const actions = relaunchActions('ledge-survey', null, null, ['dev.builder'], true);
    expect(liveCommand({ daemonUp: true, startAction, actions })).toBe('rig up ledge-survey --existing --yes');
    const down = liveCommand({ daemonUp: false, startAction, actions });
    expect(down.startsWith('rig daemon start')).toBe(true);
    expect(down.endsWith(' && rig up ledge-survey --existing --yes')).toBe(true);
  });
  it('shows a launch the way the daemon runs it', () => {
    const launch = newLaunch(starter, { ...emptyForm(starter, '/p'), name: 'x' }, 'spec', false);
    const cmd = liveCommand({ daemonUp: true, startAction, launch, spec: starter });
    expect(cmd).toBe('rig up starter --name x --cwd /p --yes');
  });
});
