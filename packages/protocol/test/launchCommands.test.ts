import { describe, it, expect } from 'vitest';
import { OpenRigActionSchema, PingSchema, PongSchema, RigLaunchSchema, changesSpec, composes, launchCommands, rigCommands, type RigSpec } from '../src/index.js';

const spec: RigSpec = { name: 'starter', source: 'builtin', path: '/s/starter/rig.yaml', pods: [], edges: 0 };
const launch = (l: object = {}) => RigLaunchSchema.parse({ spec: 'starter', cwd: '/w', name: 'starter', ...l });
const o = { rigsDir: '/home/me/.ledge/rigs', name: true };

describe('rig.start with fresh', () => {
  it('starts the named seats fresh, after --existing', () => {
    expect(rigCommands({ kind: 'rig.start', rig: 'dev', fresh: ['orch.lead', 'dev.build'] })).toEqual([['up', 'dev', '--existing', '--fresh', 'orch.lead', 'dev.build', '--yes', '--json']]);
    expect(rigCommands({ kind: 'rig.start', rig: 'dev' })).toEqual([['up', 'dev', '--existing', '--yes', '--json']]);
  });
  it('refuses fresh with a snapshot, an empty list and a seat that is not pod.member', () => {
    const ok = (a: object) => OpenRigActionSchema.safeParse({ kind: 'rig.start', rig: 'dev', ...a }).success;
    expect(ok({ fresh: ['dev.build'] })).toBe(true);
    expect(ok({ fresh: ['dev.build'], snapshot: '01HZZZZZZZZZZZZZZZZZZZZZZZ' })).toBe(false);
    expect(ok({ fresh: [] })).toBe(false);
    expect(ok({ fresh: ['build'] })).toBe(false);
    expect(ok({ fresh: ['--yes.x'] })).toBe(false);
    expect(ok({ fresh: Array.from({ length: 201 }, (_, i) => `dev.s${i}`) })).toBe(false);
  });
});

describe('launchCommands', () => {
  it('the spec as it is', () => {
    expect(launchCommands(launch(), spec, o)).toEqual([['up', 'starter', '--cwd', '/w', '--yes', '--json']]);
    expect(changesSpec(launch())).toBe(false);
  });
  it('another name without change goes through --name', () => {
    expect(launchCommands(launch({ name: 'x' }), spec, o)).toEqual([['up', 'starter', '--name', 'x', '--cwd', '/w', '--yes', '--json']]);
  });
  it('a changed seat launches the composed spec; a rig without --name composes a rename too', () => {
    expect(launchCommands(launch({ name: 'x', seats: { 'dev.build': 2 } }), spec, o)).toEqual([['up', '/home/me/.ledge/rigs/x/rig.yaml', '--cwd', '/w', '--yes', '--json']]);
    expect(launchCommands(launch({ name: 'x' }), spec, { ...o, name: false })).toEqual([['up', '/home/me/.ledge/rigs/x/rig.yaml', '--cwd', '/w', '--yes', '--json']]);
  });
  it('save adds the spec to the library; plan checks only and saves nothing', () => {
    expect(launchCommands(launch({ name: 'x', save: true }), spec, o)).toEqual([
      ['up', '/home/me/.ledge/rigs/x/rig.yaml', '--cwd', '/w', '--yes', '--json'], ['specs', 'add', '/home/me/.ledge/rigs/x', '--json']]);
    expect(launchCommands(launch({ name: 'x', save: true, plan: true }), spec, o)).toEqual([['up', '/home/me/.ledge/rigs/x/rig.yaml', '--cwd', '/w', '--plan', '--json']]);
    expect(launchCommands(launch({ plan: true }), spec, o)).toEqual([['up', 'starter', '--cwd', '/w', '--plan', '--json']]);
  });
  it('nonInterruptive adds --non-interruptive; a "~" rigsDir shows as it is', () => {
    expect(launchCommands(launch({ nonInterruptive: true }), spec, o)).toEqual([['up', 'starter', '--cwd', '/w', '--non-interruptive', '--yes', '--json']]);
    expect(launchCommands(launch({ policy: 'auto' }), spec, { rigsDir: '~/.ledge/rigs', name: true })[0]![1]).toBe('~/.ledge/rigs/starter/rig.yaml');
  });
});

describe('ping and pong', () => {
  it('carry a requestId and an optional machineId; a pong may carry the fleet\'s error', () => {
    expect(PingSchema.safeParse({ type: 'ping', requestId: 'a', machineId: 'server' }).success).toBe(true);
    expect(PingSchema.safeParse({ type: 'ping' }).success).toBe(false);
    expect(PongSchema.safeParse({ type: 'pong', requestId: 'a' }).success).toBe(true);
    expect(PongSchema.safeParse({ type: 'pong', requestId: 'a', error: 'outdated' }).success).toBe(true);
  });
});

describe('composes', () => {
  it('is true when the launch changes the spec, keeps it, or renames it on a rig without --name', () => {
    expect(composes(launch(), spec, o)).toBe(false);
    expect(composes(launch({ name: 'x' }), spec, o)).toBe(false);
    expect(composes(launch({ seats: { 'dev.build': 2 } }), spec, o)).toBe(true);
    expect(composes(launch({ save: true }), spec, o)).toBe(true);
    expect(composes(launch({ name: 'x' }), spec, { ...o, name: false })).toBe(true);
    expect(composes(launch(), spec, { ...o, name: false })).toBe(false);
  });
  it('launchCommands follows it', () => {
    for (const l of [launch(), launch({ name: 'x' }), launch({ save: true })]) for (const name of [true, false])
      expect(launchCommands(l, spec, { ...o, name })[0]![1] === `${o.rigsDir}/${l.name}/rig.yaml`).toBe(composes(l, spec, { ...o, name }));
  });
});
