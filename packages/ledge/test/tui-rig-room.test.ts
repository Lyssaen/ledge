import { describe, it, expect } from 'vitest';
import type { Exchange, Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { queueOf, seatAddress, seatRows } from '../src/tui/model/rigRoom.js';
import { C } from '../src/tui/theme.js';
import { mockupEscalations, mockupRigs } from './tui-fixture.js';

const at = (min: number) => new Date(Date.parse('2026-10-30T16:00:00.000Z') + min * 60_000).toISOString();
const x = (id: string, from: string, to: string, kind: Exchange['kind'], text: string, min: number): Exchange =>
  ({ id, machine: 'local', rigId: 'factory', from, to, kind, text, at: at(min) });

describe('ledge tui: a rig\'s room', () => {
  it('seatRows marks the seat whose escalation is open as Attend Ledge', () => {
    const factory = mockupRigs()[0]!;
    const build: Session = fakeSession('build', { topic: 'Reprise après reboot', context: { used: 63, window: 100, at: at(0) } });
    const rows = seatRows({ ...factory, seats: factory.seats.map(s => (s.name === 'qa' ? { ...s, contextPct: 55 } : s)) }, new Map([['build', build]]), mockupEscalations());
    // The graph's order, the seats as OpenRig lists them.
    expect(rows.map(r => r.seat.name)).toEqual(['orch-lead', 'build', 'qa', 'review-a', 'review-b', 'design']);
    expect(rows[0]!.state).toEqual({ glyph: 'approval', color: C.yellow, label: 'Attend Ledge' });
    expect(rows[1]!.state.label).toBe('Au travail');
    expect(rows[4]!.state.label).toBe('Disponible');
    expect(rows[0]!.agent).toBe('Claude Code · opus');
    // The paired session's topic and context; a seat's own contextPct wins; none measured, none shown.
    expect(rows[1]).toMatchObject({ session: build, topic: 'Reprise après reboot', ctx: 63 });
    expect(rows[2]!.ctx).toBe(55);
    expect(rows[0]!.ctx).toBeUndefined();
    expect(rows[0]!.topic).toBe('—');
    // An escalation answered no longer holds the seat.
    expect(seatRows(factory, new Map(), mockupEscalations().map(e => ({ ...e, state: 'answered' as const })))[0]!.state.label).toBe('Au travail');
  });

  it('queueOf lists tasks, handoffs and the rig\'s open escalations', () => {
    const factory = { ...mockupRigs()[0]!, seats: mockupRigs()[0]!.seats.map(s => (s.name === 'build' ? { ...s, state: 'idle' as const } : s)) };
    const exchanges = [
      x('q-114', 'orch-lead@factory', 'build@factory', 'task', 'Patch daemon', 1),
      x('o-1', 'build@factory', 'orch-lead@factory', 'message', 'Patch prêt', 2),
      x('q-116', 'orch-lead@factory', 'review-a@factory', 'task', 'Relire 3f2a1c0', 3),
      x('h-118', 'orch-lead@factory', 'qa@factory', 'handoff', 'Vérifier la reprise', 8),
      x('q-900', 'a@starter', 'b@starter', 'task', 'another rig', 9)
    ].map(e => (e.id === 'q-900' ? { ...e, rigId: 'starter' } : e));
    const escalations = mockupEscalations().map(e => ({ ...e, createdAt: at(5) }));
    const q = queueOf(factory, exchanges, escalations);
    expect(q.map(i => i.id)).toEqual(['h-118', 'q-117', 'q-116', 'q-114']);
    expect(q[1]).toMatchObject({ id: 'q-117', glyph: 'approval', to: 'ledge', title: 'Sessions : passer du fichier JSON à SQLite ?', state: 'à toi' });
    expect(q[0]).toMatchObject({ glyph: 'task', to: 'qa', state: 'en cours' });
    // build is no longer at work: its task is done.
    expect(q[3]).toMatchObject({ glyph: 'ok', to: 'build', title: 'Patch daemon', state: 'fait' });
    // A seat's earlier task is done once a later one went to it.
    const again = queueOf(factory, [...exchanges, x('q-120', 'orch-lead@factory', 'qa@factory', 'task', 'Encore', 10)], []);
    expect(again.find(i => i.id === 'h-118')!.state).toBe('fait');
    expect(again.find(i => i.id === 'q-120')!.state).toBe('en cours');
    // The long form, for the kernel's queue of every rig.
    expect(queueOf(factory, exchanges, escalations, { long: true }).map(i => i.to)).toEqual(['qa@factory', 'ledge@external', 'review-a@factory', 'build@factory']);
  });

  it('seatAddress is the seat\'s @address, its long form when another live seat answers to it', () => {
    const [factory, starter, kernel] = mockupRigs();
    const review = factory!.seats.find(s => s.name === 'review-a')!;
    expect(seatAddress(factory!, review, [factory!, starter!, kernel!])).toBe('@review-a');
    const twin = { ...starter!, seats: [...starter!.seats, { ...review, ref: 'review-a@starter' }] };
    expect(seatAddress(factory!, review, [factory!, twin, kernel!])).toBe('@review-a@factory');
    // A stopped seat is no candidate of the completion: its address all the same.
    expect(seatAddress(factory!, { ...review, state: 'stopped' }, [factory!])).toBe('@review-a');
  });
});
