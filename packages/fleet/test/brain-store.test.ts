import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { BrainStatus, LedgeDecision, LedgeRule, ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE } from '../src/machines';
import { daemonStore } from '../src/store';
import { revisitDecision, setBrain, useBrainStatus, useLedgeDecisions, useLedgeRules, useMandate } from '../src/brain';

const decision = (id: string, at: string, by: 'ledge' | 'user' = 'ledge'): LedgeDecision =>
  ({ id, escalationId: `e-${id}`, by, category: 'git', summary: `résumé ${id}`, answers: {}, at });
const rule: LedgeRule = { id: 'r1', text: 'merge, pas de rebase', category: 'git', since: '2026-10-26', from: 'user', appliedCount: 3, status: 'active' };
const status: BrainStatus = { state: 'on', tool: 'claude', enabled: true, contextPct: 34 };
const fake = () => { const sent: Array<Record<string, unknown>> = []; const client = { connect() {}, close() {}, send: (m: unknown) => { sent.push(m as never); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} } as unknown as DaemonClient; return { client, sent }; };

beforeEach(() => daemonStore.reset());

describe('brain state in the store', () => {
  it('starts empty', () => {
    const s = daemonStore.getState();
    expect(s.mandate).toBeUndefined();
    expect(s.rules).toEqual([]);
    expect(s.decisions).toEqual([]);
    expect(s.brain).toBeUndefined();
  });
  it('mandate, rules, decisions and brain.status are applied as the daemon sends them', () => {
    daemonStore.apply({ type: 'mandate', text: '# Mandat', path: '~/.ledge/mandat.md' });
    daemonStore.apply({ type: 'rules', items: [rule] });
    daemonStore.apply({ type: 'decisions', items: [decision('d2', '2026-10-31T09:00:00.000Z'), decision('d1', '2026-10-30T09:00:00.000Z')] });
    daemonStore.apply({ type: 'brain.status', status });
    const s = daemonStore.getState();
    expect(s.mandate).toEqual({ text: '# Mandat', path: '~/.ledge/mandat.md' });
    expect(s.rules).toEqual([rule]);
    expect(s.decisions.map(d => d.id)).toEqual(['d2', 'd1']);
    expect(s.brain).toEqual(status);
  });
  it('a new list replaces the old one; a snapshot keeps what was held', () => {
    daemonStore.apply({ type: 'decisions', items: [decision('d1', '2026-10-30T09:00:00.000Z')] });
    daemonStore.apply({ type: 'decisions', items: [decision('d3', '2026-10-31T10:00:00.000Z')] });
    daemonStore.apply({ type: 'snapshot', sessions: [], recents: [] });
    expect(daemonStore.getState().decisions.map(d => d.id)).toEqual(['d3']);
  });
  it('the hooks follow the store; useLedgeDecisions is a map by id', () => {
    const { result } = renderHook(() => ({ m: useMandate(), r: useLedgeRules(), d: useLedgeDecisions(), b: useBrainStatus() }));
    expect(result.current.d.size).toBe(0);
    act(() => {
      daemonStore.apply({ type: 'decisions', items: [decision('d1', '2026-10-30T09:00:00.000Z')] });
      daemonStore.apply({ type: 'rules', items: [rule] });
      daemonStore.apply({ type: 'mandate', text: 'x', path: 'p' });
      daemonStore.apply({ type: 'brain.status', status });
    });
    expect(result.current.d.get('d1')?.summary).toBe('résumé d1');
    expect(result.current.r).toEqual([rule]);
    expect(result.current.m?.text).toBe('x');
    expect(result.current.b?.state).toBe('on');
  });
});

describe('brain senders', () => {
  it('revisitDecision sends decision.revisit, with the text when given', () => {
    const { client, sent } = fake();
    revisitDecision(client, 'd1');
    revisitDecision(client, 'd2', 'plutôt rebase');
    expect(sent.map(({ rid: _, ...m }) => m)).toEqual([{ type: 'decision.revisit', id: 'd1' }, { type: 'decision.revisit', id: 'd2', text: 'plutôt rebase' }]);
    expect(sent.every(m => typeof m.rid === 'string')).toBe(true);
  });
  it('setBrain sends brain.set', () => {
    const { client, sent } = fake();
    setBrain(client, { enabled: true });
    expect(sent.map(({ rid: _, ...m }) => m)).toEqual([{ type: 'brain.set', enabled: true }]);
  });
});

function peer() {
  const sent: Array<Record<string, unknown>> = []; let onMsg = (_: ServerMessage) => {}; let onSt = (_: DaemonStatus) => {}; let status: DaemonStatus = 'connecting';
  const client: DaemonClient = { connect() {}, close() {}, send(m) { sent.push(m as never); }, status: () => status, onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } };
  return { client, sent, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } };
}
describe('fleet routing of the brain (C25)', () => {
  const snap: ServerMessage = { type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.30.0', install: 'npm', systemd: true, routing: true } };
  function setup() {
    const peers = [peer(), peer()];
    const api = createFleetClient([LOCAL_MACHINE, { id: 'ec2', label: 'EC2', ssh: 'ec2' }], o => (o.url === LOCAL_MACHINE.url ? peers[0]! : peers[1]!).client, {});
    api.connect(); peers.forEach(p => p.set('open')); peers[0]!.emit(snap); peers[1]!.emit({ ...snap, sshAlias: 'ec2' } as ServerMessage);
    peers[0]!.sent.length = 0; peers[1]!.sent.length = 0;
    return { api, local: peers[0]!, ec2: peers[1]! };
  }
  it('mandate.update, rule.set, decision.revisit, category.escalate and brain.set go to local even when ec2 is selected', () => {
    const { api, local, ec2 } = setup();
    api.fleet!.select('ec2');
    api.send({ type: 'mandate.update', rid: 'a', text: '# M' });
    api.send({ type: 'rule.set', rid: 'b', id: 'r1', status: 'active' });
    api.send({ type: 'decision.revisit', rid: 'c', id: 'd1' });
    api.send({ type: 'category.escalate', rid: 'd', category: 'git' });
    api.send({ type: 'brain.set', rid: 'e', enabled: true });
    expect(local.sent.map(m => m.type)).toEqual(['mandate.update', 'rule.set', 'decision.revisit', 'category.escalate', 'brain.set']);
    expect(ec2.sent).toEqual([]);
  });
  it('a remote daemon\'s mandate, rules, decisions and brain.status never reach the store; the local ones do', () => {
    const { api, local, ec2 } = setup();
    const seen: ServerMessage[] = []; api.onMessage(m => seen.push(m));
    ec2.emit({ type: 'mandate', text: 'remote', path: 'p' });
    ec2.emit({ type: 'decisions', items: [] });
    ec2.emit({ type: 'rules', items: [] });
    ec2.emit({ type: 'brain.status', status });
    expect(seen).toEqual([]);
    local.emit({ type: 'mandate', text: 'local', path: 'p' });
    local.emit({ type: 'brain.status', status });
    expect(seen.map(m => m.type)).toEqual(['mandate', 'brain.status']);
  });
});
