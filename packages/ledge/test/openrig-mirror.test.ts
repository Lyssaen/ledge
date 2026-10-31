import { describe, expect, it } from 'vitest';
import type { Projects } from '@ledge/protocol';
import { createMirror } from '../src/daemon/openrig/mirror.js';
import { parseSessionName, seatState } from '../src/daemon/openrig/seats.js';
import type { NodeEntry } from '../src/daemon/openrig/wire.js';

const none: Projects = { version: 1, projects: [], rules: [] } as unknown as Projects;
const node = (over: Record<string, unknown> = {}): NodeEntry => ({ rigId: 'r1', logicalId: 'dev.build', podId: 'dev', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' }, ...over }) as NodeEntry;
const nodes2 = () => [node(), node({ logicalId: 'dev.test', canonicalSessionName: 'dev-test@starter' })];
const mk = (rigsRoot = '/home/u/.ledge/rigs') => createMirror({ machine: 'local', projects: () => none, rigsRoot });
const snap = (m: ReturnType<typeof mk>, extra: { id: string; name: string; nodes: NodeEntry[] }[] = []) => {
  const list = [{ id: 'r1', name: 'starter', nodes: nodes2() }, ...extra];
  return m.replace({ rigs: list.map(r => ({ rigId: r.id, rigName: r.name, status: 'running' })), nodes: new Map(list.map(r => [r.id, r.nodes])), kernel: null });
};

describe('seats', () => {
  it('parses session names', () => {
    expect(parseSessionName('dev-build@starter')).toEqual({ pod: 'dev', member: 'build', rig: 'starter' });
    expect(parseSessionName('nope')).toBeNull();
  });
  it('maps states', () => {
    expect(seatState(node({ startupStatus: 'pending' }))).toBe('starting');
    expect(seatState(node({ startupStatus: 'challenged' }))).toBe('trust');
    expect(seatState(node({ startupStatus: 'failed' }))).toBe('attention');
    expect(seatState(node({ startupStatus: 'attention_required' }))).toBe('attention');
    expect(seatState(node({ startupStatus: 'ready', lifecycleState: 'attention_required' }))).toBe('attention');
    expect(seatState(node({ startupStatus: 'failed', sessionStatus: 'exited' }))).toBe('crashed');
    expect(seatState(node({ sessionStatus: 'detached' }))).toBe('stopped');
    expect(seatState(node({ sessionStatus: 'failed' }))).toBe('crashed');
    expect(seatState(node())).toBe('ready');
    expect(seatState(node(), 'working')).toBe('working');
  });
});

describe('mirror', () => {
  it('builds rigs with seats', () => {
    const m = mk(); const { updated } = snap(m);
    expect(updated).toHaveLength(1); const r = updated[0]!;
    expect(r.seats.map(s => [s.ref, s.address])).toEqual([['dev-build@starter', '@build'], ['dev-test@starter', '@test']]);
    expect(r).toMatchObject({ id: 'r1', name: 'starter', machine: 'local', lifecycle: 'running', kernel: false, cwd: '/w/app', offProject: false, projectId: null });
    expect(snap(m).updated).toEqual([]);
  });
  it('refetch rules', () => {
    const m = mk(); snap(m);
    expect(m.applyEvent({ seq: 1, type: 'rig.imported', rigId: 'r1' }).refetch).toEqual(['r1']);
    expect(m.applyEvent({ seq: 2, type: 'node.launched', rigId: 'r1', nodeId: 'n', sessionName: 'dev-build@starter' }).refetch).toEqual(['r1']);
    expect(m.applyEvent({ seq: 3, type: 'session.detached', rigId: 'r1', nodeId: 'n' }).refetch).toEqual(['r1']);
    expect(m.applyEvent({ seq: 4, type: 'seat.activity_changed', sessionName: 'nobody-x@y' }).refetch).toEqual([]);
    expect(m.applyEvent({ seq: 5, type: 'seat.activity_changed', seatNodeId: 'n', sessionName: 'dev-build@starter' }).refetch).toEqual(['r1']);
    const w = [node({ activityState: { activity: 'working' } }), nodes2()[1]!];
    expect(m.setNodes('r1', w)!.seats[0]!.state).toBe('working');
  });
  it('removes vanished rigs, keeps pairings', () => {
    const m = mk(); snap(m, [{ id: 'r2', name: 'factory', nodes: [] }]);
    m.pair('r1', 'dev-build@starter', 's1');
    const { removed, updated } = snap(m);
    expect(removed).toEqual(['r2']); expect(updated).toEqual([]);
    expect(m.byRef('dev-build@starter')!.seat.sessionId).toBe('s1');
  });
  it('unreachable then restored', () => {
    const m = mk(); snap(m);
    expect(m.markUnreachable().map(r => r.lifecycle)).toEqual(['unreachable']); expect(m.rigs()).toHaveLength(1);
    expect(snap(m).updated.map(r => r.lifecycle)).toEqual(['running']);
  });
  it('flags off-project rigs only under ~/.ledge/rigs', () => {
    const m = mk(); m.replace({ rigs: [{ rigId: 'a', rigName: 'a' }, { rigId: 'b', rigName: 'b' }], kernel: null,
      nodes: new Map([['a', [node({ cwd: '/home/u/.ledge/rigs/x' })]], ['b', [node({ cwd: '/home/u/.ledge/rigsX/x' })]]]) });
    expect(m.byName('a')).toMatchObject({ offProject: true, projectId: null }); expect(m.byName('b')!.offProject).toBe(false);
  });
  it('follows LEDGE_HOME by default (paths().rigs)', () => {
    const saved = process.env.LEDGE_HOME; process.env.LEDGE_HOME = '/tmp/ledge-home-x';
    try {
      const m = createMirror({ machine: 'local', projects: () => none });
      m.replace({ rigs: [{ rigId: 'a', rigName: 'a' }, { rigId: 'b', rigName: 'b' }], kernel: null,
        nodes: new Map([['a', [node({ cwd: '/tmp/ledge-home-x/rigs/x' })]], ['b', [node({ cwd: '/home/u/.ledge/rigs/x' })]]]) });
      expect(m.byName('a')!.offProject).toBe(true); expect(m.byName('b')!.offProject).toBe(false);
    } finally { if (saved === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = saved; }
  });
  it('detects kernel and launching', () => {
    const m = mk(); m.replace({ rigs: [{ rigId: 'k', rigName: 'kernel', status: 'running' }, { rigId: 'z', rigName: 'z', status: 'running' }], kernel: { state: 'ready', rigName: 'z' },
      nodes: new Map([['z', [node({ startupStatus: 'pending' })]]]) });
    expect(m.byName('kernel')!.kernel).toBe(true); expect(m.byName('z')).toMatchObject({ kernel: true, lifecycle: 'launching' });
  });
});
