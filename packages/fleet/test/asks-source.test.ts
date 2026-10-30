import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Ask, ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE } from '../src/machines';

function peer() {
  const sent: Array<Record<string, unknown>> = []; let onMsg = (_: ServerMessage) => {}; let onSt = (_: DaemonStatus) => {}; let status: DaemonStatus = 'connecting';
  const client: DaemonClient = { connect() {}, close() {}, send(m) { sent.push(m as never); }, status: () => status, onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } };
  return { client, sent, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } };
}
const snap: ServerMessage = { type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.30.0', install: 'npm', systemd: true, routing: true, asks: true } };
const A = '2026-10-30T08:00:00.000Z', B = '2026-10-30T08:01:00.000Z';
const ask = (id: string, extra: Partial<Ask> = {}): Ask => ({ id, from: 'ab12', fromName: 'Nova', question: 'Quelle base ?', options: 'A, B', at: A, state: 'open', ...extra });
const MAC = { id: 'mac', label: 'Mac', ssh: 'mac' };
function setupTwo() {
  const peers = [peer(), peer()];
  const api = createFleetClient([LOCAL_MACHINE, MAC], o => (o.url === LOCAL_MACHINE.url ? peers[0]! : peers[1]!).client, {});
  api.connect(); peers.forEach(p => p.set('open')); peers[0]!.emit(snap); peers[1]!.emit({ ...snap, sshAlias: 'mac' } as ServerMessage);
  return { api, local: peers[0]!, mac: peers[1]! };
}
beforeEach(() => localStorage.clear());
afterEach(() => { vi.useRealTimers(); });

describe('asks from every machine', () => {
  it('keeps the open asks of every machine with their machine, oldest first, and drops answered ones on ask.updated', () => {
    const { api, local, mac } = setupTwo();
    expect(api.fleet!.asks()).toEqual([]);
    local.emit({ type: 'asks', asks: [ask('a000002', { at: B })] });
    mac.emit({ type: 'asks', asks: [ask('a000001', { from: 'cd34', fromName: 'Pim' })] });
    expect(api.fleet!.asks().map(a => [a.id, a.machine, a.from])).toEqual([['a000001', 'mac', 'cd34'], ['a000002', 'local', 'ab12']]);
    const before = api.fleet!.asks();
    local.emit({ type: 'ask.updated', ask: ask('a000002', { at: B, state: 'answered', answer: { text: 'A', at: B }, closedAt: B }) });
    expect(api.fleet!.asks().map(a => a.id)).toEqual(['a000001']);
    expect(api.fleet!.asks()).toBe(api.fleet!.asks()); // a stable snapshot for useSyncExternalStore
    expect(before).not.toBe(api.fleet!.asks());
    mac.emit({ type: 'ask.updated', ask: ask('a000003', { at: B }) });
    expect(api.fleet!.asks().map(a => a.id)).toEqual(['a000001', 'a000003']);
  });

  it('a new asks list of a machine replaces its previous one', () => {
    const { api, mac } = setupTwo();
    mac.emit({ type: 'asks', asks: [ask('a000001')] });
    mac.emit({ type: 'asks', asks: [] });
    expect(api.fleet!.asks()).toEqual([]);
  });

  it('answerAsk routes ask.answer to the ask\'s machine without machineId and resolves on its ask.result', async () => {
    const { api, local, mac } = setupTwo();
    mac.emit({ type: 'asks', asks: [ask('a000001')] });
    const done = api.fleet!.answerAsk('mac', 'a000001', 'B');
    expect(local.sent.filter(m => m.type === 'ask.answer')).toEqual([]);
    const sent = mac.sent.find(m => m.type === 'ask.answer')!;
    expect(sent).toEqual({ type: 'ask.answer', rid: expect.any(String), id: 'a000001', text: 'B' });
    expect(sent).not.toHaveProperty('machineId');
    mac.emit({ type: 'ask.result', rid: sent.rid as string, ask: ask('a000001', { state: 'answered', answer: { text: 'B', at: B }, closedAt: B }) });
    await expect(done).resolves.toEqual({ ok: true });
  });

  it('answerAsk resolves { ok: false, reason } on a refusal, and « hors ligne » when the machine is not connected', async () => {
    const { api, mac } = setupTwo();
    const refused = api.fleet!.answerAsk('mac', 'a000001', 'B');
    const sent = mac.sent.find(m => m.type === 'ask.answer')!;
    mac.emit({ type: 'ask.result', rid: sent.rid as string, code: 'closed', reason: 'déjà répondue' });
    await expect(refused).resolves.toEqual({ ok: false, reason: 'déjà répondue' });
    mac.set('closed' as DaemonStatus);
    await expect(api.fleet!.answerAsk('mac', 'a000001', 'B')).resolves.toEqual({ ok: false, reason: 'hors ligne' });
    await expect(api.fleet!.answerAsk('nowhere', 'a000001', 'B')).resolves.toEqual({ ok: false, reason: 'hors ligne' });
  });

  it('answerAsk gives up after 4 s without an ask.result', async () => {
    vi.useFakeTimers();
    const { api } = setupTwo();
    const done = api.fleet!.answerAsk('local', 'a000001', 'B');
    await vi.advanceTimersByTimeAsync(4001);
    await expect(done).resolves.toEqual({ ok: false, reason: 'pas de réponse du daemon' });
  });

  it('an older daemon that never sends asks leaves asks() empty', () => {
    const { api, local } = setupTwo();
    local.emit({ type: 'session.removed', id: 'x' });
    expect(api.fleet!.asks()).toEqual([]);
  });

  it('ask messages of a machine do not reach the machine listeners', () => {
    const { api, mac } = setupTwo();
    const seen: string[] = []; api.fleet!.onMachineMessage((_, m) => seen.push(m.type));
    mac.emit({ type: 'asks', asks: [] }); mac.emit({ type: 'ask.updated', ask: ask('a000001') });
    expect(seen).toEqual([]);
  });
});
