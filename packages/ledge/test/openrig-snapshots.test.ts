import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OpenRigActionSchema, OpenRigSnapshotListSchema, OpenRigSnapshotsSchema, RigSnapshotIdSchema, rigCommands, showRigCommand } from '@ledge/protocol';
import { createOpenRig, readSnapshotTable, readSnapshots, type RigRun } from '../src/daemon/openrig.js';

const read = (f: string) => readFileSync(new URL(`./fixtures/openrig-0.7/${f}`, import.meta.url), 'utf8');
const HTTP = JSON.parse(read('snapshots-survey.json')) as unknown[];
const TABLE = read('snapshot-list.txt');

describe('snapshot actions in rigCommands', () => {
  it('rig.snapshot takes a snapshot by rig name', () => {
    expect(rigCommands({ kind: 'rig.snapshot', rig: 'ledge-survey' })).toEqual([['snapshot', 'ledge-survey']]);
    expect(showRigCommand(rigCommands({ kind: 'rig.snapshot', rig: 'ledge-survey' })[0]!)).toBe('rig snapshot ledge-survey');
  });
  it('rig.start with a snapshot restores that one; without it nothing changes', () => {
    const id = '01M6XTAV9KM2HVRS841K1FQ6RV';
    expect(rigCommands({ kind: 'rig.start', rig: 'starter', snapshot: id })).toEqual([['restore', id, '--rig', 'starter']]);
    expect(showRigCommand(rigCommands({ kind: 'rig.start', rig: 'starter', snapshot: id })[0]!)).toBe(`rig restore ${id} --rig starter`);
    expect(rigCommands({ kind: 'rig.start', rig: 'starter' })).toEqual([['up', 'starter', '--existing', '--yes', '--json']]);
  });
  it('a snapshot id is 26 characters of 0-9 A-Z', () => {
    expect(RigSnapshotIdSchema.safeParse('01M6XTAV9KM2HVRS841K1FQ6RV').success).toBe(true);
    for (const bad of ['', 'abc', '01m6xtav9km2hvrs841k1fq6rv', '--rig', '01M6XTAV9KM2HVRS841K1FQ6R', '01M6XTAV9KM2HVRS841K1FQ6RVX']) expect(RigSnapshotIdSchema.safeParse(bad).success).toBe(false);
    expect(OpenRigActionSchema.safeParse({ kind: 'rig.start', rig: 'a', snapshot: '--force' }).success).toBe(false);
    expect(OpenRigActionSchema.safeParse({ kind: 'rig.snapshot', rig: '-x' }).success).toBe(false);
  });
  it('the messages parse', () => {
    expect(OpenRigSnapshotsSchema.safeParse({ type: 'openrig.snapshots', requestId: 's', rig: 'a' }).success).toBe(true);
    expect(OpenRigSnapshotListSchema.safeParse({ type: 'openrig.snapshotList', requestId: 's', rig: 'a', snapshots: [{ id: 'x', kind: 'manual', status: 'complete', createdAt: '2026-11-08 14:52:23' }] }).success).toBe(true);
  });
});

function world(over: { http?: (path: string) => unknown; now?: () => number; run?: RigRun; actOutput?: string } = {}) {
  const calls: string[] = [], httpCalls: string[] = [];
  const ok = (j: unknown) => ({ code: 0, stdout: JSON.stringify(j), stderr: '' });
  const run: RigRun = over.run ?? (async args => {
    const a = args.join(' '); calls.push(a);
    if (a === 'status --json') return ok({ daemon: { state: 'running', reachable: true, port: 7433 }, kernel: { state: 'ready' } });
    if (a === '--version') return { code: 0, stdout: '0.7.7\n', stderr: '' };
    if (a === 'ps --json') return ok([{ rigId: '01RIGSURVEY', name: 'ledge-survey', nodeCount: 2, status: 'running' }]);
    if (a === 'ps --nodes -A --json') return ok([]);
    if (a === 'snapshot list 01RIGSURVEY' || a === 'snapshot list ledge-survey') return { code: 0, stdout: TABLE, stderr: '' };
    if (args[0] === 'snapshot' || args[0] === 'restore') return { code: 0, stdout: over.actOutput ?? 'Snapshot created: 01M6XTAV9KM2HVRS841K1FQ6RV\n', stderr: '' };
    return { code: 1, stdout: '', stderr: `unexpected ${a}` };
  });
  const http = async (path: string) => { httpCalls.push(path); return over.http ? over.http(path) : undefined; };
  const rig = createOpenRig({ run, http, ...(over.now ? { now: over.now } : {}) });
  return { rig, calls, httpCalls };
}

describe('OpenRig snapshots: from HTTP', () => {
  it('newest first, without data, only id / kind / status / createdAt', async () => {
    const { rig, httpCalls } = world({ http: () => HTTP });
    const r = await rig.snapshots('ledge-survey');
    expect(httpCalls).toEqual(['/api/rigs/01RIGSURVEY/snapshots']);
    expect(r.error).toBeUndefined();
    expect(r.snapshots).toEqual([
      { id: '01M6XTDV03ZVK8BG4WYNVFRBPX', kind: 'auto-pre-down', status: 'complete', createdAt: '2026-11-08 14:54:01' },
      { id: '01M6XTDQFZAA76XGBJMYCHJH62', kind: 'auto-periodic', status: 'complete', createdAt: '2026-11-08 14:53:57' },
      { id: '01M6XTAV9KM2HVRS841K1FQ6RV', kind: 'manual', status: 'complete', createdAt: '2026-11-08 14:52:23' }
    ]);
    expect(JSON.stringify(r)).not.toContain('"data"');
    expect(OpenRigSnapshotListSchema.safeParse({ type: 'openrig.snapshotList', requestId: 's', rig: 'ledge-survey', snapshots: r.snapshots }).success).toBe(true);
  });
  it('keeps the 20 most recent', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `ID${i}`, kind: 'manual', status: 'complete', createdAt: `2026-11-08 10:${String(i).padStart(2, '0')}:00`, data: { big: 1 } }));
    const out = readSnapshots(many)!;
    expect(out).toHaveLength(20);
    expect(out[0]!.id).toBe('ID29');
    expect(out.at(-1)!.id).toBe('ID10');
    expect(readSnapshots({})).toBeUndefined();
    expect(readSnapshots([{ nope: 1 }])).toEqual([]);
  });
});

describe('OpenRig snapshots: the text fallback', () => {
  it('parses the table', () => {
    expect(readSnapshotTable(TABLE)).toHaveLength(5);
    expect(readSnapshotTable(TABLE)[2]).toEqual({ id: '01M6XTDAXG4GTF6A77NXM5NJRB', kind: 'pre_restore', status: 'complete', createdAt: '2026-11-08 14:53:44' });
    expect(readSnapshotTable('')).toEqual([]);
    expect(readSnapshotTable('No snapshots found.\n')).toEqual([]);
  });
  it('is used when HTTP fails or is not the right shape', async () => {
    for (const http of [() => undefined, () => { throw new Error('boom'); }, () => ({ nodes: 1 })]) {
      const { rig, calls } = world({ http });
      const r = await rig.snapshots('ledge-survey');
      expect(calls.some(c => c.startsWith('snapshot list'))).toBe(true);
      expect(r.snapshots!.map(s => s.kind)).toEqual(['auto-pre-down', 'auto-periodic', 'pre_restore', 'auto-pre-down', 'manual']);
    }
  });
  it('a failing table is the rig error', async () => {
    const { rig } = world({ http: () => undefined, run: async args => (args[0] === 'status' ? { code: 0, stdout: JSON.stringify({ daemon: { state: 'running', reachable: true, port: 1 } }), stderr: '' }
      : args[0] === 'ps' ? { code: 0, stdout: JSON.stringify(args.includes('--nodes') ? [] : [{ rigId: 'R', name: 'x', status: 'running' }]), stderr: '' } : { code: 1, stdout: '', stderr: 'boom\n' }) });
    expect(await rig.snapshots('x')).toEqual({ error: 'boom' });
  });
});

describe('OpenRig snapshots: errors and freshness', () => {
  it('unknown_rig, not_installed, daemon_stopped', async () => {
    expect(await world({ http: () => HTTP }).rig.snapshots('nope')).toEqual({ error: 'unknown_rig' });
    const none = createOpenRig({ run: async () => ({ code: null, stdout: '', stderr: '' }), http: async () => undefined });
    expect(await none.snapshots('kernel')).toEqual({ error: 'not_installed' });
    const stopped = createOpenRig({ run: async args => (args[0] === 'status' ? { code: 0, stdout: JSON.stringify({ daemon: { state: 'stopped' } }), stderr: '' } : { code: 1, stdout: '', stderr: '' }), http: async () => undefined });
    expect(await stopped.snapshots('kernel')).toEqual({ error: 'daemon_stopped' });
  });
  it('is never cached: a list after an action shows the new snapshot', async () => {
    const { rig, httpCalls } = world({ http: () => HTTP });
    await rig.snapshots('ledge-survey');
    expect(await rig.act({ kind: 'rig.snapshot', rig: 'ledge-survey' })).toMatchObject({ ok: true, commands: ['rig snapshot ledge-survey'] });
    await rig.snapshots('ledge-survey');
    expect(httpCalls).toHaveLength(2);
  });
  it('rig.snapshot and a restore run without --json and report the result', async () => {
    const { rig, calls } = world();
    expect(await rig.act({ kind: 'rig.start', rig: 'ledge-survey', snapshot: '01M6XTAV9KM2HVRS841K1FQ6RV' })).toMatchObject({ ok: true, commands: ['rig restore 01M6XTAV9KM2HVRS841K1FQ6RV --rig ledge-survey'] });
    expect(calls).toContain('restore 01M6XTAV9KM2HVRS841K1FQ6RV --rig ledge-survey');
    const bad = world({ run: async () => ({ code: 1, stdout: '', stderr: 'Restore conflict: rig may still be running. Stop the rig first with: rig down x\n' }) });
    expect(await bad.rig.act({ kind: 'rig.snapshot', rig: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('Restore conflict') });
  });
});
