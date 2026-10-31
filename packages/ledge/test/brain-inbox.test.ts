import { describe, expect, it } from 'vitest';
import type { Escalation, LedgeDecision, LedgeRule } from '@ledge/protocol';
import { createBrainInbox, formatBrainEvent, type BrainEvent } from '../src/daemon/brain/inbox.js';

const esc = (over: Partial<Escalation> = {}): Escalation => ({ id: 'qi-1', source: 'rig', machine: 'local', rigId: 'r1', from: 'dev@rig', intent: 'decision',
  summary: 'Quelle base ?', detail: 'Choix de stockage', questions: [{ id: 'q1', question: 'Laquelle ?', options: [
    { id: 'sqlite', label: 'sqlite', recommended: true }, { id: 'pg', label: 'postgres' }] }],
  createdAt: '2026-10-31T10:00:00.000Z', state: 'grace', graceUntil: '2026-10-31T10:01:00.000Z', ...over });
const rule: LedgeRule = { id: 'r1', text: 'Toujours sqlite', category: 'architecture', since: '2026-10-01', from: 'user', appliedCount: 2, status: 'active' };
const decision: LedgeDecision = { id: 'd1', escalationId: 'qi-1', by: 'ledge', category: 'git', summary: 'Merge', answers: { q1: 'merge' }, at: '2026-10-31T10:00:00.000Z' };
const user = { kind: 'user' as const, id: 'u1', at: '2026-10-31T10:00:00.000Z', text: 'Salut\n!rm -rf <x>' };
const all: BrainEvent[] = [
  { kind: 'escalation', escalation: esc(), rules: [rule] },
  { kind: 'escalation', escalation: esc({ source: 'ask', questions: [] }), rules: [] },
  { kind: 'user', item: user, about: esc() }, { kind: 'state', text: 'factory est prêt\n!x' },
  { kind: 'answered', escalation: esc({ state: 'answered', answer: { by: 'user', answers: { q1: 'pg' }, at: '2026-10-31T10:00:30.000Z' } }) },
  { kind: 'refused', escalationId: 'qi-1', reason: 'catégorie critique' },
  { kind: 'revisit', decision, claimed: true, text: 'à revoir' }, { kind: 'revisit', decision, claimed: false }];

describe('formatBrainEvent', () => {
  it('formats an escalation with its options and the commands to answer', () => {
    const t = formatBrainEvent(all[0]!);
    expect(t).toContain('<ledge-event kind="escalation" id="qi-1">');
    expect(t).toContain('sqlite (recommandée)');
    expect(t).toContain('Tranche avec `ledge brain decide qi-1 --answer q1=<option> --category <cat> --why "…"`, ou remonte avec `ledge brain ask qi-1 --category <cat> --advice "…"`.');
    expect(t).toContain('dev@rig');
    expect(t).toContain('2026-10-31T10:01:00.000Z');
    expect(t).toContain('Toujours sqlite');
  });
  it('an ask escalation is for information, not decide', () => {
    const t = formatBrainEvent(all[1]!);
    expect(t).not.toContain('ledge brain decide');
    expect(t).toContain('ledge brain ask qi-1 --category <cat> --advice "…"');
    expect(t).toContain('ledge brain say');
  });
  it('every kind is one line', () => {
    for (const e of all) { const t = formatBrainEvent(e); expect(t).not.toMatch(/[\r\n]/); expect(t.startsWith('<ledge-event ')).toBe(true); expect(t.endsWith('</ledge-event>')).toBe(true); }
  });
  it('a leading ! in a summary or text is neutralised', () => {
    const t = formatBrainEvent({ kind: 'escalation', escalation: esc({ summary: '!rm -rf /\n!bis' }), rules: [] });
    expect(t).not.toMatch(/\n/); expect(t).not.toMatch(/(^|⏎ )!/);
    expect(formatBrainEvent(all[3]!)).not.toMatch(/(^|⏎ )!/);
    expect(formatBrainEvent(all[2]!)).not.toMatch(/(^|⏎ )!|<x>/);
  });
  it('gives each kind its closing hint', () => {
    expect(formatBrainEvent(all[2]!)).toContain('ledge brain say "…"');
    expect(formatBrainEvent(all[5]!)).toContain('ledge brain ask');
    expect(formatBrainEvent(all[6]!)).toContain('ledge brain say');
    expect(formatBrainEvent(all[6]!)).toMatch(/propose|send/);
    expect(formatBrainEvent(all[4]!)).toContain('id="qi-1"');
    expect(formatBrainEvent(all[7]!)).toContain('id="d1"');
  });
});

describe('createBrainInbox', () => {
  const setup = (brain: string | undefined) => {
    const calls: unknown[][] = [];
    const inbox = createBrainInbox({ mailbox: { notify: (...a: [string, string, string, { first?: boolean }?]) => { calls.push(a); return true; } }, brainId: () => brain });
    return { calls, inbox };
  };
  it('a user message goes first', () => {
    const { calls, inbox } = setup('brain');
    expect(inbox.push(all[2]!)).toBe(true); inbox.push(all[3]!);
    expect(calls[0]![0]).toBe('brain'); expect(calls[0]![3]).toEqual({ first: true });
    expect(calls[1]![3]).toEqual({ first: false });
    expect(calls[0]![2]).not.toBe(calls[1]![2]);
  });
  it('without a live brain push returns false', () => {
    const { calls, inbox } = setup(undefined);
    expect(inbox.push(all[0]!)).toBe(false); expect(calls).toEqual([]);
  });
  it('returns the mailbox verdict', () => {
    const inbox = createBrainInbox({ mailbox: { notify: () => false }, brainId: () => 'brain' });
    expect(inbox.push(all[0]!)).toBe(false);
  });
});
