import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { RigSpecInfo, ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE } from '../src/machines';
import { forgetRigSpecs, useRigSpecs } from '../src/specs';

function peer() {
  const sent: Array<Record<string, unknown>> = []; let onMsg = (_: ServerMessage) => {}; let onSt = (_: DaemonStatus) => {}; let status: DaemonStatus = 'connecting';
  const client: DaemonClient = { connect() {}, close() {}, send(m) { sent.push(m as never); }, status: () => status, onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } };
  return { client, sent, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } };
}
const snap: ServerMessage = { type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.30.0', install: 'npm', systemd: true, routing: true } };
const EC2 = { id: 'ec2', label: 'EC2', ssh: 'ec2' };
const spec: RigSpecInfo = { id: 'starter', name: 'Starter', source: 'builtin', seats: [] };
function setup() {
  const peers = [peer(), peer()];
  const api = createFleetClient([LOCAL_MACHINE, EC2], o => (o.url === LOCAL_MACHINE.url ? peers[0]! : peers[1]!).client, {});
  const got: ServerMessage[] = []; api.onMessage(m => got.push(m));
  api.connect(); peers.forEach(p => p.set('open')); peers[0]!.emit(snap); peers[1]!.emit({ ...snap, sshAlias: 'ec2' } as ServerMessage);
  const specs = () => got.filter((m): m is Extract<ServerMessage, { type: 'rig.specs' }> => m.type === 'rig.specs');
  return { api, local: peers[0]!, ec2: peers[1]!, specs };
}

describe('rig.specs routing', () => {
  it('routes to its machine (local by default), rewrites machine, relays only the machine asked', () => {
    const { api, local, ec2, specs } = setup();
    api.send({ type: 'rig.specs.request', requestId: 'r1', machineId: 'ec2' });
    api.send({ type: 'rig.specs.request', requestId: 'r2' });
    expect(ec2.sent).toEqual([{ type: 'rig.specs.request', requestId: 'r1' }]);
    expect(local.sent).toEqual([{ type: 'rig.specs.request', requestId: 'r2' }]);
    local.emit({ type: 'rig.specs', requestId: 'r1', machine: 'local', specs: [spec] }); // not the machine asked
    expect(specs()).toEqual([]);
    ec2.emit({ type: 'rig.specs', requestId: 'r1', machine: 'local', specs: [spec] });
    ec2.emit({ type: 'rig.specs', requestId: 'r1', machine: 'local', specs: [spec] }); // answered already
    expect(specs()).toEqual([{ type: 'rig.specs', requestId: 'r1', machine: 'ec2', specs: [spec] }]);
    local.emit({ type: 'rig.specs', requestId: 'r2', machine: 'local', specs: [] });
    expect(specs().at(-1)).toMatchObject({ requestId: 'r2', machine: 'local' });
  });
  it('answers failed when the machine is unavailable or drops, unsupported when its daemon refuses', () => {
    const { api, ec2, specs } = setup();
    api.send({ type: 'rig.specs.request', requestId: 'r3', machineId: 'ec2' });
    ec2.emit({ type: 'error', message: 'invalid message', request: 'rig.specs.request' });
    expect(specs().at(-1)).toEqual({ type: 'rig.specs', requestId: 'r3', machine: 'ec2', specs: [], error: 'unsupported' });
    api.send({ type: 'rig.specs.request', requestId: 'r4', machineId: 'ec2' });
    ec2.set('unreachable');
    api.send({ type: 'rig.specs.request', requestId: 'r5', machineId: 'ec2' });
    expect(specs().slice(-2).map(m => [m.requestId, m.machine, m.error])).toEqual([['r4', 'ec2', 'failed'], ['r5', 'ec2', 'failed']]);
  });
});

describe('useRigSpecs', () => {
  beforeEach(forgetRigSpecs);
  const fake = () => {
    const sent: Array<Record<string, unknown>> = []; const ls = new Set<(m: ServerMessage) => void>();
    const client = { send: (m: never) => { sent.push(m); }, onMessage: (fn: (m: ServerMessage) => void) => { ls.add(fn); return () => { ls.delete(fn); }; } } as unknown as DaemonClient;
    return { client, sent, emit: (m: ServerMessage) => ls.forEach(f => f(m)) };
  };
  it('asks once per machine, keeps the answer, does not keep an error', () => {
    const f = fake();
    const { result, rerender } = renderHook(({ m }: { m: string | null }) => useRigSpecs(f.client, m), { initialProps: { m: 'ec2' as string | null } });
    expect(result.current.status).toBe('loading');
    expect(f.sent).toEqual([{ type: 'rig.specs.request', requestId: expect.any(String), machineId: 'ec2' }]);
    act(() => f.emit({ type: 'rig.specs', requestId: f.sent[0]!.requestId as string, machine: 'ec2', specs: [], error: 'failed' }));
    expect(result.current).toMatchObject({ status: 'ready', specs: [], error: 'failed' });
    rerender({ m: null }); expect(result.current.status).toBe('idle');
    rerender({ m: 'ec2' }); expect(f.sent).toHaveLength(2); // error not kept: asked again
    act(() => f.emit({ type: 'rig.specs', requestId: f.sent[1]!.requestId as string, machine: 'ec2', specs: [spec] }));
    expect(result.current).toMatchObject({ status: 'ready', specs: [spec] });
    rerender({ m: null }); rerender({ m: 'ec2' });
    expect(f.sent).toHaveLength(2); expect(result.current.specs).toEqual([spec]); // kept
    rerender({ m: 'local' }); expect(f.sent).toHaveLength(3);
  });
  it('refreshes a cached catalog for the selected machine', () => {
    const f = fake();
    const { result } = renderHook(() => useRigSpecs(f.client, 'local'));
    act(() => f.emit({ type: 'rig.specs', requestId: f.sent[0]!.requestId as string, machine: 'local', specs: [spec] }));
    act(() => result.current.refresh());
    expect(result.current.status).toBe('loading');
    expect(f.sent).toHaveLength(2);
    const added = { ...spec, id: 'ledge-development', name: 'ledge-development' };
    act(() => f.emit({ type: 'rig.specs', requestId: f.sent[1]!.requestId as string, machine: 'local', specs: [spec, added] }));
    expect(result.current.specs).toEqual([spec, added]);
  });

});
