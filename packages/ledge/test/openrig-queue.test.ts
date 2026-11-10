import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OpenRigQueueSchema, OpenRigQueueStateSchema, RigRoutingEntrySchema, RigRowSchema } from '@ledge/protocol';
import { createOpenRig, readQueue, readRouting, readRow, rowFrom, type RigRun } from '../src/daemon/openrig.js';

const LIST = JSON.parse(readFileSync(new URL('./fixtures/openrig-0.7/queue-list.json', import.meta.url), 'utf8')) as Record<string, any>[];
const AT = '2026-11-08T15:05:00.000Z';
const [WAITING, OTHER_RIG, SOURCE_ONLY, WORKING] = LIST as [Record<string, any>, Record<string, any>, Record<string, any>, Record<string, any>];

describe('rowFrom: one queue record to a RigRow (shared by queue show and queue list)', () => {
  it('maps the fields and adds needsInput only when a prompt waits', () => {
    expect(rowFrom(WAITING, AT)).toEqual({
      id: 'qitem-20261108150012-1a2b3c4d5e6f7a8b', state: 'pending', summary: 'Run the build and report', from: 'operator-human@kernel', to: 'dev-build@ledge-survey',
      createdAt: '2026-11-08T15:00:12.101Z', updatedAt: '2026-11-08T15:00:12.101Z', at: AT, needsInput: { count: 1, reason: 'permission_prompt' }
    });
    expect(rowFrom(WORKING, AT)).not.toHaveProperty('needsInput');
    expect(rowFrom(SOURCE_ONLY, AT)).toMatchObject({ state: 'blocked', blockedOn: 'qitem-20261108150012-1a2b3c4d5e6f7a8b', claimedAt: '2026-11-08T14:31:00.000Z' });
    expect(RigRowSchema.safeParse(rowFrom(WAITING, AT)).success).toBe(true);
  });
  it('a prompt with no reason keeps a null reason; a record that is not a row is undefined', () => {
    const r = rowFrom({ ...WAITING, waiting: { liveness: { needsInput: { count: 2 } } } }, AT);
    expect(r!.needsInput).toEqual({ count: 2, reason: null });
    expect(rowFrom({ ...WAITING, qitemId: '--flag' }, AT)).toBeUndefined();
    expect(rowFrom('nope', AT)).toBeUndefined();
  });
  it('readRow (queue show) uses it, needsInput included', () => {
    expect(readRow(JSON.stringify(WAITING), AT)).toEqual(rowFrom(WAITING, AT));
    expect(readRow(JSON.stringify(WAITING), AT)!.needsInput).toEqual({ count: 1, reason: 'permission_prompt' });
  });
});

describe('readQueue: a rig\'s rows out of the list', () => {
  it('keeps the rows whose destination OR source ends with @<rig>, other rigs are out', () => {
    const r = readQueue(LIST, 'ledge-survey', AT)!;
    expect(r.rows.map(x => x.id)).toEqual([WAITING.qitemId, SOURCE_ONLY.qitemId, WORKING.qitemId]);
    expect(r.truncated).toBe(false);
    expect(readQueue(LIST, 'kernel', AT)!.rows.map(x => x.id)).toEqual([WAITING.qitemId, OTHER_RIG.qitemId, SOURCE_ONLY.qitemId, WORKING.qitemId]);
  });
  it('sorts newest updatedAt first whatever order OpenRig returns; ties keep its order', () => {
    const at = (id: string, tsUpdated: string) => ({ ...WAITING, qitemId: id, tsUpdated });
    const shuffled = [at('qitem-old', '2026-11-08T10:00:00.000Z'), at('qitem-new', '2026-11-08T12:00:00.000Z'), at('qitem-tie1', '2026-11-08T11:00:00.000Z'), at('qitem-tie2', '2026-11-08T11:00:00.000Z')];
    expect(readQueue(shuffled, 'ledge-survey', AT)!.rows.map(x => x.id)).toEqual(['qitem-new', 'qitem-tie1', 'qitem-tie2', 'qitem-old']);
  });
  it('matches the exact name after the last @ (not a longer rig name, not a prefix)', () => {
    expect(readQueue(LIST, 'survey', AT)!.rows).toEqual([]);
    expect(readQueue(LIST, 'ledge', AT)!.rows).toEqual([]);
  });
  it('truncated when the raw list holds the 100 asked, whatever the filter keeps', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => ({ ...OTHER_RIG, qitemId: `qitem-x${i}` }));
    expect(readQueue(hundred, 'ledge-survey', AT)).toEqual({ rows: [], truncated: true });
    expect(readQueue(hundred.slice(1), 'ledge-survey', AT)).toEqual({ rows: [], truncated: false });
  });
  it('is undefined for what is not a list; skips a record that is not a row', () => {
    expect(readQueue({ error: 'x' }, 'a', AT)).toBeUndefined();
    expect(readQueue(undefined, 'a', AT)).toBeUndefined();
    expect(readQueue([{ junk: true }, WAITING], 'ledge-survey', AT)!.rows).toHaveLength(1);
  });
});

function world(over: { http?: (path: string) => unknown; daemon?: 'running' | 'stopped'; installed?: boolean } = {}) {
  const calls: string[] = [], httpCalls: string[] = [];
  const ok = (j: unknown) => ({ code: 0, stdout: JSON.stringify(j), stderr: '' });
  const run: RigRun = async args => {
    const a = args.join(' '); calls.push(a);
    if (over.installed === false) return { code: null, stdout: '', stderr: 'not found' };
    if (a === 'status --json') return ok({ daemon: { state: over.daemon ?? 'running', reachable: (over.daemon ?? 'running') === 'running', port: 7433 }, kernel: { state: 'ready' } });
    if (a === '--version') return { code: 0, stdout: '0.7.7\n', stderr: '' };
    if (a === 'ps --json') return ok([{ rigId: '01RIGSURVEY', name: 'ledge-survey', nodeCount: 2, status: 'running' }, { rigId: '01KERNEL', name: 'kernel', nodeCount: 4, status: 'running' }]);
    if (a === 'ps --nodes -A --json') return ok([]);
    return { code: 1, stdout: '', stderr: `unexpected ${a}` };
  };
  const http = async (path: string) => { httpCalls.push(path); return over.http ? over.http(path) : undefined; };
  return { rig: createOpenRig({ run, http, now: () => 1_000_000 }), calls, httpCalls };
}

describe('OpenRig queue', () => {
  it('asks the daemon\'s list (pending, in-progress, blocked; 100) and returns the rig\'s rows, read at each ask', async () => {
    const { rig, httpCalls } = world({ http: () => LIST });
    const r = await rig.queue('ledge-survey');
    expect(httpCalls).toEqual(['/api/queue/list?state=pending,in-progress,blocked&limit=100']);
    expect(r.error).toBeUndefined();
    expect(r.rows!.map(x => x.id)).toEqual([WAITING.qitemId, SOURCE_ONLY.qitemId, WORKING.qitemId]);
    expect(r.rows![0]!.needsInput).toEqual({ count: 1, reason: 'permission_prompt' });
    await rig.queue('ledge-survey');
    expect(httpCalls).toHaveLength(2);
    expect(OpenRigQueueStateSchema.safeParse({ type: 'openrig.queueState', requestId: 'q', rig: 'ledge-survey', rows: r.rows, truncated: r.truncated }).success).toBe(true);
    expect(OpenRigQueueSchema.safeParse({ type: 'openrig.queue', requestId: 'q', rig: 'ledge-survey' }).success).toBe(true);
  });
  it('an HTTP failure or a body that is not a list is failed: no CLI fallback, state() unaffected', async () => {
    for (const http of [() => undefined, () => ({ error: 'x' })]) {
      const w = world({ http });
      const before = await w.rig.state();
      expect(await w.rig.queue('ledge-survey')).toEqual({ rows: [], truncated: false, error: 'failed' });
      expect(w.calls.filter(c => c.startsWith('queue'))).toEqual([]);
      expect(await w.rig.state()).toEqual(before);
    }
  });
  it('error vocabulary: unknown_rig, not_installed, daemon_stopped, without asking HTTP', async () => {
    const w = world({ http: () => LIST });
    expect(await w.rig.queue('nope')).toEqual({ rows: [], truncated: false, error: 'unknown_rig' });
    expect(w.httpCalls).toEqual([]);
    expect(await world({ installed: false }).rig.queue('kernel')).toEqual({ rows: [], truncated: false, error: 'not_installed' });
    expect(await world({ daemon: 'stopped' }).rig.queue('kernel')).toEqual({ rows: [], truncated: false, error: 'daemon_stopped' });
  });
});

const ROUTING = JSON.parse(readFileSync(new URL('./fixtures/openrig-0.7/recent-transitions.json', import.meta.url), 'utf8')) as unknown[];

describe('readRouting: the queue\'s routing steps (OpenRig 0.7.10 recent-transitions)', () => {
  it('keeps the row, time, actor, change, rig and summary, oldest first; an item without its row or change is left out', () => {
    const r = readRouting([...ROUTING, { ts: AT, change: 'claimed' }])!;
    expect(r.map(x => [x.qitem, x.seat, x.change, x.rig])).toEqual([
      ['qitem-20261110172122-6564b59e8db394a5', 'dev-back@ledge-dev', 'claimed', 'ledge-dev'],
      ['qitem-20261110170907-85493e3d611998a2', 'pilot-lead@ledge-dev', 'blocked', 'ledge-dev'],
      ['qitem-recovery-fef58ae7258650b0', 'stuck-sweep@system', 'completed', '']
    ]);
    expect(r[0]!.summary).toMatch(/^Refonte mobile B4/);
    expect(r[2]).not.toHaveProperty('summary');
    for (const x of r) expect(RigRoutingEntrySchema.safeParse(x).success).toBe(true);
  });
  it('keeps the last 20 of a longer list, and is undefined for what is not a list', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ qitemId: `qitem-${i}`, ts: AT, actorSession: 's@r', change: 'claimed', rig: 'r' }));
    expect(readRouting(many)!.map(x => x.qitem)).toEqual(many.slice(5).map(x => x.qitemId));
    expect(readRouting({ error: 'x' })).toBeUndefined();
  });
});

describe('OpenRig closed rows and routing', () => {
  it('asks the closed states of the rig, newest updated first, and filters by the rig again', async () => {
    const { rig, httpCalls } = world({ http: () => LIST });
    const r = await rig.closed!('ledge-survey');
    expect(httpCalls).toEqual(['/api/queue/list?state=done,handed-off,canceled,failed,denied&rig=ledge-survey&sort=updated&compact=1&limit=20']);
    expect(r.error).toBeUndefined();
    expect(r.rows.every(x => x.to.endsWith('@ledge-survey') || x.from.endsWith('@ledge-survey'))).toBe(true);
    expect(await world({ http: () => undefined }).rig.closed!('ledge-survey')).toEqual({ rows: [], error: 'failed' });
    expect(await world({ http: () => LIST }).rig.closed!('nope')).toEqual({ rows: [], error: 'unknown_rig' });
  });
  it('reads the routing of the whole machine, or says why not', async () => {
    const { rig, httpCalls } = world({ http: () => ROUTING });
    expect((await rig.routing!()).entries).toHaveLength(3);
    expect(httpCalls).toEqual(['/api/queue/recent-transitions?scope=instance&limit=20']);
    expect(await world({ http: () => 'nope' }).rig.routing!()).toEqual({ entries: [], error: 'failed' });
    expect(await world({ daemon: 'stopped' }).rig.routing!()).toEqual({ entries: [], error: 'daemon_stopped' });
    expect(await world({ installed: false }).rig.routing!()).toEqual({ entries: [], error: 'not_installed' });
  });
});
