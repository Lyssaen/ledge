import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OpenRigGraphStateSchema } from '@ledge/protocol';
import { createOpenRig, graphFromSpec, readGraph, type RigRun } from '../src/daemon/openrig.js';

const fixture = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/openrig-0.7/${f}`, import.meta.url), 'utf8')) as Record<string, any>;
const GRAPH = fixture('graph-survey.json');
const SPEC = fixture('spec-show-kernel.json');

function world(over: { http?: (path: string) => unknown; rigs?: boolean; now?: () => number; run?: RigRun } = {}) {
  const calls: string[] = [], httpCalls: string[] = [];
  const ok = (j: unknown) => ({ code: 0, stdout: JSON.stringify(j), stderr: '' });
  const run: RigRun = over.run ?? (async args => {
    const a = args.join(' '); calls.push(a);
    if (a === 'status --json') return ok({ daemon: { state: 'running', reachable: true, port: 7433 }, kernel: { state: 'ready' } });
    if (a === '--version') return { code: 0, stdout: '0.7.7\n', stderr: '' };
    if (a === 'ps --json') return ok([{ rigId: '01RIGSURVEY', name: 'ledge-survey', nodeCount: 2, status: 'running' }, { rigId: '01KERNEL', name: 'kernel', nodeCount: 4, status: 'running' }]);
    if (a === 'ps --nodes -A --json') return ok([]);
    if (a === 'spec show 01KERNEL --json') return ok(SPEC);
    return { code: 1, stdout: '', stderr: `unexpected ${a}` };
  });
  const http = async (path: string) => { httpCalls.push(path); return over.http ? over.http(path) : undefined; };
  const rig = createOpenRig({ run, http, ...(over.now ? { now: over.now } : {}) });
  return { rig, calls, httpCalls };
}

describe('OpenRig graph: from /graph', () => {
  it('pods, seats and links of a running rig, in logicalId form', async () => {
    const { rig, httpCalls } = world({ http: () => GRAPH });
    const r = await rig.graph('ledge-survey');
    expect(httpCalls).toEqual(['/api/rigs/01RIGSURVEY/graph']);
    expect(r.error).toBeUndefined();
    expect(r.graph).toEqual({
      pods: [{ id: 'dev', label: 'Project' }],
      seats: [
        { logicalId: 'dev.build', pod: 'dev', role: 'implementer', runtime: 'claude-code', status: 'running', session: 'dev-build@ledge-survey', attention: false },
        { logicalId: 'dev.review', pod: 'dev', role: 'qa', runtime: 'codex', model: 'gpt-6-astra', status: 'running', session: 'dev-review@ledge-survey', attention: false }
      ],
      links: [{ from: 'dev.build', to: 'dev.review', kind: 'delegates_to' }]
    });
    expect(OpenRigGraphStateSchema.safeParse({ type: 'openrig.graphState', requestId: 'g', rig: 'ledge-survey', graph: r.graph }).success).toBe(true);
  });
  it('a stopped rig keeps its seats, with the status OpenRig gives them; attention and context come through', () => {
    const g = structuredClone(GRAPH);
    for (const n of g.nodes) if (n.type === 'rigNode') n.data.status = 'exited';
    g.nodes[1].data.needsAttention = true; g.nodes[1].data.contextUsedPercentage = 42;
    const out = readGraph(g)!;
    expect(out.seats.map(s => s.status)).toEqual(['exited', 'exited']);
    expect(out.seats[0]).toMatchObject({ attention: true, context: 42 });
    expect(out.seats[1]!.context).toBeUndefined();
  });
  it('a shape it does not know is undefined', () => {
    expect(readGraph(undefined)).toBeUndefined();
    expect(readGraph({ nodes: 'x' })).toBeUndefined();
    expect(readGraph({ edges: [] })).toBeUndefined();
  });
});

describe('OpenRig graph: the spec fallback', () => {
  it('reads the kernel: 4 seats, pod-local links prefixed and the rig-level ones as they are', async () => {
    for (const http of [() => undefined, () => { throw new Error('boom'); }, () => ({ nodes: 'junk' })]) {
      const { rig, calls } = world({ http });
      const r = await rig.graph('kernel');
      expect(calls).toContain('spec show 01KERNEL --json');
      const g = r.graph!;
      expect(g.pods).toEqual([{ id: 'advisor', label: 'Advisor' }, { id: 'operator', label: 'Operator' }, { id: 'queue', label: 'Queue' }]);
      expect(g.seats.map(s => s.logicalId)).toEqual(['advisor.lead', 'operator.agent', 'operator.human', 'queue.worker']);
      expect(g.seats[1]).toEqual({ logicalId: 'operator.agent', pod: 'operator', runtime: 'codex', status: 'unknown', attention: false });
      expect(g.links).toContainEqual({ from: 'advisor.lead', to: 'operator.agent', kind: 'delegates_to' });
      expect(g.links).toContainEqual({ from: 'operator.agent', to: 'operator.human', kind: 'collaborates_with' });
      expect(g.links).toHaveLength(5);
    }
  });
  it('graphFromSpec keeps a member model when set, and is undefined without pods', () => {
    expect(graphFromSpec({ pods: [{ id: 'p', label: 'P', members: [{ id: 'm', runtime: 'codex', model: 'x' }], edges: [] }] })!.seats[0]).toMatchObject({ model: 'x' });
    expect(graphFromSpec({})).toBeUndefined();
  });
  it('fails with the spec error when both reads fail', async () => {
    const { rig } = world({ http: () => undefined, run: async args => (args[0] === 'status' ? { code: 0, stdout: JSON.stringify({ daemon: { state: 'running', reachable: true, port: 1 } }), stderr: '' } : args[0] === 'ps' ? { code: 0, stdout: args.includes('--nodes') ? '[]' : JSON.stringify([{ rigId: 'R', name: 'x', status: 'running' }]), stderr: '' } : { code: 1, stdout: '', stderr: 'boom' }) });
    expect((await rig.graph('x')).error).toBeTruthy();
  });
});

describe('OpenRig graph: errors and cache', () => {
  it('a rig the daemon does not know is unknown_rig, without any read of it', async () => {
    const { rig, httpCalls } = world({ http: () => GRAPH });
    expect(await rig.graph('nope')).toEqual({ error: 'unknown_rig' });
    expect(httpCalls).toEqual([]);
  });
  it('OpenRig not installed or its daemon stopped says so', async () => {
    const none = createOpenRig({ run: async () => ({ code: null, stdout: '', stderr: '' }), http: async () => undefined });
    expect(await none.graph('kernel')).toEqual({ error: 'not_installed' });
    const stopped = createOpenRig({ run: async args => (args[0] === 'status' ? { code: 0, stdout: JSON.stringify({ daemon: { state: 'stopped' } }), stderr: '' } : { code: 1, stdout: '', stderr: '' }), http: async () => undefined });
    expect(await stopped.graph('kernel')).toEqual({ error: 'daemon_stopped' });
  });
  it('an action on a rig makes the next graph read again, though within 5 s', async () => {
    const { rig, httpCalls } = world({ http: () => GRAPH, now: () => 1_000_000 });
    await rig.graph('ledge-survey');
    await rig.act({ kind: 'rig.start', rig: 'ledge-survey' }); // fails here (no such command in the fake): the cache is forgotten all the same
    await rig.graph('ledge-survey');
    expect(httpCalls).toHaveLength(2);
  });
  it('is read once within 5 s per rig, again after, and a failing graph leaves state() alone', async () => {
    let t = 1_000_000;
    const { rig, httpCalls } = world({ http: () => GRAPH, now: () => t });
    await rig.graph('ledge-survey'); t += 4_000; await rig.graph('ledge-survey');
    expect(httpCalls).toHaveLength(1);
    t += 2_000; await rig.graph('ledge-survey');
    expect(httpCalls).toHaveLength(2);
    const bad = world({ http: () => { throw new Error('x'); }, run: async args => (args.join(' ') === 'status --json' ? { code: 0, stdout: JSON.stringify({ daemon: { state: 'running', reachable: true, port: 1 } }), stderr: '' } : args[0] === 'ps' ? { code: 0, stdout: args.includes('--nodes') ? '[]' : JSON.stringify([{ rigId: 'R', name: 'x', status: 'running' }]), stderr: '' } : { code: 1, stdout: '', stderr: 'no' }) });
    await bad.rig.graph('x');
    expect((await bad.rig.state()).rigs.map(r => r.name)).toEqual(['x']);
  });
});
