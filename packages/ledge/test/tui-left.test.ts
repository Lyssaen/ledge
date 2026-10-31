import { describe, it, expect } from 'vitest';
import type { Escalation } from '@ledge/protocol';
import { focusOrder, leftRows, seatStateLabel, type LeftRow } from '../src/tui/model/left.js';
import { C } from '../src/tui/theme.js';
import { MOCKUP_OPENRIG, mockupEscalations, mockupRigs, mockupSeatSession, mockupSessions, PROJECTS } from './tui-fixture.js';

const ledge = { preview: 'Une décision t’attend · factory', unread: 1 };
const rowsOf = (o: Partial<Parameters<typeof leftRows>[0]> = {}): LeftRow[] => leftRows({
  sessions: [...mockupSessions(), mockupSeatSession()], projects: PROJECTS, rigs: mockupRigs(), escalations: mockupEscalations(), openrig: [MOCKUP_OPENRIG], ledge, ...o
});

describe('ledge tui: the left column', () => {
  it('starts with Ledge’s row', () => {
    expect(rowsOf()[0]).toEqual({ kind: 'ledge', ...ledge });
  });

  it('a paired seat leaves Projets and sits under its rig', () => {
    const rows = rowsOf();
    expect(rows.some(r => r.kind === 'session' && r.s.id === 'build')).toBe(false);
    const factory = rows.findIndex(r => r.kind === 'rig' && r.rig.id === 'factory');
    const build = rows.findIndex(r => r.kind === 'seat' && r.seat.name === 'build');
    expect(factory).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(factory);
    expect((rows[build] as Extract<LeftRow, { kind: 'seat' }>).session?.id).toBe('build');
    // The project counts its standalone sessions only.
    expect(rows.find(r => r.kind === 'project' && r.label === 'Ledge')).toMatchObject({ count: 3 });
  });

  it('À toi lists escalations before waiting sessions, with Ledge s’en occupe… in grace', () => {
    const [esc] = mockupEscalations();
    const grace: Escalation = { ...esc!, id: 'q-120', createdAt: new Date(Date.now() - 60_000).toISOString(), state: 'grace' };
    const done: Escalation = { ...esc!, id: 'q-100', state: 'answered' };
    const yours = rowsOf({ escalations: [grace, esc!, done] }).filter((r): r is Extract<LeftRow, { kind: 'yours' }> => r.kind === 'yours');
    expect(yours.map(r => r.item.escalation?.id ?? r.item.session?.id)).toEqual(['q-117', 'q-120', 'otto', 'luna']);
    expect(yours[0]!.item).toMatchObject({ glyph: 'approval', who: 'orch-lead', where: 'factory', text: 'Sessions : passer du fichier JSON à SQLite ?' });
    expect(yours[1]!.item.text).toBe('Ledge s’en occupe…');
    expect(yours[2]!.item).toMatchObject({ glyph: 'approval', who: 'Otto', where: 'Ledge', text: 'npm test' });
    expect(yours[3]!.item).toMatchObject({ glyph: 'question', who: 'Luna', where: 'Website' });
  });

  it('a seat whose escalation is open reads Attend Ledge', () => {
    const lead = mockupRigs()[0]!.seats[0]!;
    expect(seatStateLabel(lead, mockupEscalations())).toEqual({ glyph: 'approval', color: C.yellow, label: 'Attend Ledge' });
    expect(seatStateLabel(lead, [])).toMatchObject({ glyph: 'working', label: 'Au travail' });
    expect(seatStateLabel(lead, mockupEscalations().map(e => ({ ...e, state: 'answered' as const })))).toMatchObject({ label: 'Au travail' });
  });

  it('available seats fold into one line', () => {
    const rows = rowsOf();
    expect(rows.filter(r => r.kind === 'seat' && r.rig.id === 'factory').map(r => (r as Extract<LeftRow, { kind: 'seat' }>).seat.name)).toEqual(['orch-lead', 'build', 'qa', 'review-a']);
    expect(rows.find(r => r.kind === 'idle' && r.rig.id === 'factory')).toMatchObject({ names: ['review-b', 'design'] });
    expect(rows.find(r => r.kind === 'rig' && r.rig.id === 'factory')).toMatchObject({ working: 4, total: 6, place: { kind: 'project', name: 'Ledge' } });
  });

  it('the kernel row comes last, with its state', () => {
    const rows = rowsOf();
    expect(rows.at(-1)).toMatchObject({ kind: 'kernel', machine: 'local', state: 'running', seats: ['operator', 'queue'] });
    expect(rows.some(r => r.kind === 'rig' && r.rig.kernel)).toBe(false);
  });

  it('without OpenRig anywhere, no rig row and no kernel row', () => {
    const rows = rowsOf({ rigs: [], escalations: [], openrig: [] });
    expect(rows.some(r => r.kind === 'rig' || r.kind === 'kernel')).toBe(false);
  });

  it('focusOrder walks Ledge, À toi, the sessions, the rigs and their seats, the kernel', () => {
    const order = focusOrder(rowsOf());
    expect(order[0]).toEqual({ kind: 'ledge' });
    expect(order[1]).toEqual({ kind: 'yours', id: 'e:local:q-117' });
    expect(order[2]).toEqual({ kind: 'yours', id: 'otto' });
    expect(order).toContainEqual({ kind: 'session', id: 'nova' });
    expect(order).toContainEqual({ kind: 'rig', machine: 'local', rigId: 'factory' });
    expect(order).toContainEqual({ kind: 'seat', machine: 'local', rigId: 'factory', ref: 'build@factory' });
    expect(order.at(-1)).toEqual({ kind: 'kernel', machine: 'local' });
  });
});
