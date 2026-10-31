import { describe, it, expect } from 'vitest';
import type { ChatTurn, Escalation, Exchange, LedgeDecision, LedgeThreadItem } from '@ledge/protocol';
import { feedLines, localDay, pinnedEscalation, relativeAge, threadRows } from '../src/chat/ledge/threadModel';
import { frThread } from './ledge-thread-copy-fixture';

const at = (day: string, hm: string) => `${day}T${hm}:00.000Z`;
const D1 = '2026-10-28', D2 = '2026-10-29', D3 = '2026-10-30';
const esc = (over: Partial<Escalation> = {}): Escalation => ({
  id: 'qi-1', source: 'rig', machine: 'local', rigId: 'factory', from: 'orch-lead@factory', intent: 'decision',
  summary: 'Sessions : passer du fichier JSON à SQLite ?', questions: [], createdAt: at(D3, '12:00'), state: 'pending', ...over
});
const xc = (id: string, hm: string, over: Partial<Exchange> = {}): Exchange => ({
  id, machine: 'local', rigId: 'factory', from: 'build@factory', to: 'review-a@factory', kind: 'message', text: `text ${id}`, at: at(D3, hm), ...over
});
const turn = (qid: string): ChatTurn => ({ qid, question: 'q', askedAt: at(D3, '12:00'), steps: [] });
const ctx = (over: Partial<Parameters<typeof threadRows>[1]> = {}): Parameters<typeof threadRows>[1] => ({
  escalations: new Map(), exchanges: () => [], chat: [], today: D3, days: frThread.days, ...over
});

describe('threadRows', () => {
  it('inserts day separators and resolves turns by qid', () => {
    const items: LedgeThreadItem[] = [
      { kind: 'user', id: 'u1', at: at(D1, '12:00'), text: 'hello' },
      { kind: 'ledge', id: 'l1', at: at(D2, '12:00'), text: 'hi', qid: 'q-1' },
      { kind: 'ledge', id: 'l2', at: at(D3, '12:00'), text: 'again' },
      { kind: 'user', id: 'u2', at: at(D3, '12:05'), text: 'ok', to: '@build' }
    ];
    const rows = threadRows(items, ctx({ chat: [turn('local:other'), turn('local:q-1')] }));
    expect(rows.map(r => r.kind)).toEqual(['day', 'user', 'day', 'ledge', 'day', 'ledge', 'user']);
    expect(rows.filter(r => r.kind === 'day').map(r => r.kind === 'day' && r.label)).toEqual(['28/10', 'HIER', "AUJOURD'HUI"]);
    const ledge = rows[3]!;
    expect(ledge.kind === 'ledge' && ledge.turn?.qid).toBe('local:q-1');
    expect(rows[5]!.kind === 'ledge' && rows[5]!.turn).toBeUndefined();
    expect(rows[6]!.kind === 'user' && rows[6]!.to).toBe('@build');
  });

  it('qualifies the raw qid as the fleet does (encoded)', () => {
    const rows = threadRows([{ kind: 'ledge', id: 'l1', at: at(D3, '12:00'), text: 'x', qid: 'q 1/a' }], ctx({ chat: [turn('local:q%201%2Fa')] }));
    expect(rows[1]!.kind === 'ledge' && rows[1]!.turn?.qid).toBe('local:q%201%2Fa');
  });

  it('resolves escalations, decisions and exchanges, counting the missing ones', () => {
    const e = esc();
    const decision: LedgeDecision = { id: 'd1', escalationId: 'qi-1', by: 'ledge', category: 'git', summary: 'merge, pas de rebase', answers: {}, at: at(D3, '12:10') };
    const items: LedgeThreadItem[] = [
      { kind: 'escalation', id: 'e1', at: at(D3, '12:00'), escalationId: 'qi-1' },
      { kind: 'decided', id: 'dd', at: at(D3, '12:10'), decisionId: 'd1' },
      { kind: 'exchanges', id: 'g1', at: at(D3, '12:20'), machine: 'local', rigId: 'factory', from: at(D3, '12:20'), to: at(D3, '12:22'), exchangeIds: ['x1', 'gone', 'x2'] }
    ];
    const asked: string[] = [];
    const rows = threadRows(items, ctx({
      escalations: new Map([['qi-1', e]]), decisions: new Map([['d1', decision]]),
      exchanges: (m, r) => { asked.push(`${m}/${r}`); return [xc('x2', '12:22'), xc('x1', '12:20'), xc('other', '12:21')]; }
    }));
    expect(rows[1]!.kind === 'escalation' && rows[1]!.escalation).toBe(e);
    expect(rows[2]!.kind === 'decided' && rows[2]!.decision).toBe(decision);
    expect(rows[2]!.kind === 'decided' && rows[2]!.to).toBe('orch-lead');
    const g = rows[3]!;
    expect(g.kind === 'exchanges' && g.exchanges.map(x => x.id)).toEqual(['x1', 'x2']);
    expect(g.kind === 'exchanges' && g.missing).toBe(1);
    expect(asked).toEqual(['local/factory']);
  });

  it('counts every exchange missing when the rig exchanges are not loaded', () => {
    const rows = threadRows([{ kind: 'exchanges', id: 'g1', at: at(D3, '12:20'), machine: 'local', rigId: 'factory', from: at(D3, '12:20'), to: at(D3, '12:22'), exchangeIds: ['a', 'b'] }],
      ctx({ exchanges: () => null }));
    expect(rows[1]!.kind === 'exchanges' && rows[1]!.missing).toBe(2);
  });

  it('localDay reads the local calendar day', () => {
    const d = new Date(2026, 9, 30, 23, 30);
    expect(localDay(d.toISOString())).toBe('2026-10-30');
  });
});

describe('feedLines', () => {
  it('expands groups into one line per exchange and drops them with onlyLedge', () => {
    const items: LedgeThreadItem[] = [
      { kind: 'exchanges', id: 'g1', at: at(D3, '12:20'), machine: 'local', rigId: 'factory', from: at(D3, '12:20'), to: at(D3, '12:22'), exchangeIds: ['x1', 'x2', 'x3'] },
      { kind: 'user', id: 'u1', at: at(D3, '12:30'), text: 'Pourquoi ?', to: '@build' }
    ];
    const rows = threadRows(items, ctx({ exchanges: () => [xc('x1', '12:20'), xc('x2', '12:21'), xc('x3', '12:22')] }));
    const rigName = (m: string, r: string) => `${r}@${m}`;
    const all = feedLines(rows, { onlyLedge: false, rigName });
    expect(all).toHaveLength(4);
    expect(all[0]).toMatchObject({ kind: 'exchange', rigName: 'factory@local', at: at(D3, '12:20') });
    expect(all[3]).toEqual({ at: at(D3, '12:30'), kind: 'user', text: 'Pourquoi ?', to: '@build' });
    expect(feedLines(rows, { onlyLedge: true, rigName })).toHaveLength(1);
  });

  it('keeps Ledge bubbles and decisions, skips empty pending bubbles', () => {
    const decision: LedgeDecision = { id: 'd1', escalationId: 'qi-1', by: 'ledge', category: 'git', summary: 'merge', answers: {}, at: at(D3, '12:10') };
    const items: LedgeThreadItem[] = [
      { kind: 'ledge', id: 'l1', at: at(D3, '12:00'), text: 'Il approchait 82 %' },
      { kind: 'ledge', id: 'l2', at: at(D3, '12:01'), text: '', pending: true },
      { kind: 'decided', id: 'dd', at: at(D3, '12:10'), decisionId: 'd1' }
    ];
    const rows = threadRows(items, ctx({ decisions: new Map([['d1', decision]]), escalations: new Map([['qi-1', esc({ from: 'build@factory' })]]) }));
    expect(feedLines(rows, { onlyLedge: true, rigName: () => '' })).toEqual([
      { at: at(D3, '12:00'), kind: 'ledge', text: 'Il approchait 82 %' },
      { at: at(D3, '12:10'), kind: 'decided', text: 'merge', to: 'build' }
    ]);
  });
});

describe('pinnedEscalation', () => {
  it('is the oldest pending decision, grace included, updates excluded', () => {
    const list = [
      esc({ id: 'new', createdAt: at(D3, '12:30') }),
      esc({ id: 'upd', intent: 'update', createdAt: at(D3, '11:00') }),
      esc({ id: 'done', state: 'answered', createdAt: at(D3, '10:00') }),
      esc({ id: 'grace', state: 'grace', createdAt: at(D3, '11:30') })
    ];
    expect(pinnedEscalation(list)?.id).toBe('grace');
    expect(pinnedEscalation(list.filter(e => e.id !== 'grace'))?.id).toBe('new');
    expect(pinnedEscalation([esc({ intent: 'update' })])).toBeUndefined();
  });
});

describe('relativeAge', () => {
  const now = at(D3, '12:00');
  it('words minutes, hours and days through the copy', () => {
    expect(relativeAge(at(D3, '11:56'), now, frThread.age)).toBe('il y a 4 min');
    expect(relativeAge(at(D3, '09:00'), now, frThread.age)).toBe('il y a 3 h');
    expect(relativeAge(at(D1, '12:00'), now, frThread.age)).toBe('il y a 2 j');
    expect(relativeAge(at(D3, '11:59'), now, frThread.age, { bare: true })).toBe('1 min');
    expect(relativeAge(now, now, frThread.age)).toBe("à l'instant");
  });
});
