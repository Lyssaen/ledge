import { describe, expect, it } from 'vitest';
import type { Escalation, LedgeDecision, LedgeRule, MandateCategory } from '@ledge/protocol';
import { categoryStats, decisionsToday, filterMemories, mandatePath, mandateSides, ruleSource } from '../src/chat/mandate/model';

/** A local instant of `day` at hh:mm. */
const at = (day: string, h: number, m = 0) => { const [y, mo, d] = day.split('-').map(Number); return new Date(y!, mo! - 1, d!, h, m).toISOString(); };
const dec = (id: string, iso: string, by: 'ledge' | 'user' = 'ledge'): LedgeDecision => ({ id, escalationId: `e-${id}`, by, category: 'git', summary: id, answers: {}, at: iso });

describe('decisionsToday', () => {
  const list = [dec('late', at('2026-10-31', 23, 50)), dec('mine', at('2026-10-31', 12), 'user'), dec('early', at('2026-10-31', 0, 5)), dec('yesterday', at('2026-10-30', 23, 59))];
  it('keeps the decisions of the local day, in the order given', () => {
    expect(decisionsToday(list, '2026-10-31').map(d => d.id)).toEqual(['late', 'mine', 'early']);
  });
  it('filters by who decided', () => {
    expect(decisionsToday(list, '2026-10-31', 'ledge').map(d => d.id)).toEqual(['late', 'early']);
    expect(decisionsToday(list, '2026-10-31', 'user').map(d => d.id)).toEqual(['mine']);
  });
  it('nothing for another day', () => expect(decisionsToday(list, '2026-11-01')).toEqual([]));
});

const NOW = '2026-10-31T12:00:00.000Z';
const ago = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
const mk = (id: string, o: Partial<LedgeDecision> = {}): LedgeDecision => ({ id, escalationId: `e-${id}`, by: 'ledge', category: 'git', summary: id, answers: {}, at: ago(1), ...o });
const esc = (id: string, category: MandateCategory | undefined, state: Escalation['state'] = 'pending'): Escalation => ({ id, source: 'rig', machine: 'local', from: 'build@factory',
  intent: 'decision', summary: id, questions: [], createdAt: NOW, state, ...(category ? { category } : {}) });

describe('categoryStats', () => {
  it('counts this week (Ledge\'s decisions only) and pending', () => {
    const { category: _c, ...bare } = mk('none');
    const decisions = [mk('a'), mk('a2', { at: ago(6.9) }), mk('b', { by: 'user', at: ago(1) }), mk('old', { at: ago(7.5) }), mk('t', { category: 'tests' }),
      mk('later', { at: '2026-11-02T00:00:00.000Z' }), bare, { ...bare, id: 'none-user', by: 'user' as const }];
    const escalations = [esc('p1', 'architecture'), esc('p2', 'architecture', 'grace'), esc('p3', 'architecture', 'answered'), esc('p4', 'git'), esc('p5', undefined)];
    const s = categoryStats(decisions, escalations, NOW);
    expect(s.git).toEqual({ week: 2, pending: 1 });
    expect(s.tests).toEqual({ week: 1, pending: 0 });
    expect(s.architecture).toEqual({ week: 0, pending: 1 });
    expect(s.critical).toEqual({ week: 0, pending: 0 });
    expect(Object.keys(s)).toHaveLength(7);
  });
});

describe('mandateSides', () => {
  it('self from the file, the rest to the user, in the canonical order', () => {
    const text = '## Ledge tranche seul\n- tests : t\n- design : d\n- nope : x\n\n## Te revient toujours\n- git : g\n';
    expect(mandateSides(text)).toEqual({ self: ['tests'], user: ['git', 'context', 'code', 'design', 'architecture', 'critical'], readable: true });
  });
  it('an unreadable mandate gives everything to the user', () => {
    expect(mandateSides('n’importe quoi').self).toEqual([]);
    expect(mandateSides('n’importe quoi').user).toHaveLength(7);
  });
});

describe('filterMemories', () => {
  const list = [mk('a', { rigId: 'r1' }), mk('b', { by: 'user', category: 'tests', rigId: 'r2' }), mk('c', { by: 'user', rigId: 'r1' })];
  it('filters by who, category and rig, and combines them', () => {
    expect(filterMemories(list, {}).map(d => d.id)).toEqual(['a', 'b', 'c']);
    expect(filterMemories(list, { by: 'user' }).map(d => d.id)).toEqual(['b', 'c']);
    expect(filterMemories(list, { category: 'git' }).map(d => d.id)).toEqual(['a', 'c']);
    expect(filterMemories(list, { rig: 'r1', by: 'user' }).map(d => d.id)).toEqual(['c']);
  });
  it('a decision without a category shows in the full history only', () => {
    const { category: _c, ...bare } = mk('u', { by: 'user' });
    expect(filterMemories([...list, bare], {}).map(d => d.id)).toEqual(['a', 'b', 'c', 'u']);
    expect(filterMemories([...list, bare], { by: 'user' }).map(d => d.id)).toEqual(['b', 'c', 'u']);
    expect(filterMemories([...list, bare], { category: 'git' }).map(d => d.id)).toEqual(['a', 'c']);
  });
});

describe('ruleSource', () => {
  const rule = (from: string, status: LedgeRule['status'] = 'active'): LedgeRule => ({ id: 'r', text: 'x', category: 'git', since: '2026-10-26', from, appliedCount: 0, status });
  const list = [mk('d1', { summary: 'force-push refusé' }), mk('d2', { by: 'user', from: 'orch-lead@factory' }), mk('d3', { by: 'user' })];
  it('two decisions or more: « tu as tranché deux fois pareil »', () => expect(ruleSource(rule('d2,d3', 'proposed'), list)).toBe('tu as tranché deux fois pareil'));
  it('one answer of yours: « ta réponse à <siège> »', () => expect(ruleSource(rule('d2'), list)).toBe('ta réponse à orch-lead'));
  it('one decision of Ledge: what it settled', () => expect(ruleSource(rule('d1'), list)).toBe('force-push refusé'));
  it('nothing known: « ta consigne »', () => {
    expect(ruleSource(rule(''), list)).toBe('ta consigne');
    expect(ruleSource(rule('user'), list)).toBe('ta consigne');
    expect(ruleSource(rule('gone'), list)).toBe('ta consigne');
  });
  it('a user answer with no seat is still yours', () => expect(ruleSource(rule('d3'), list)).toBe('ta consigne'));
});

describe('mandatePath', () => {
  it('the home-expanded default reads ~/.ledge/mandat.md; another place is shown as is', () => {
    expect(mandatePath('/home/paradow/.ledge/mandat.md')).toEqual({ file: '~/.ledge/mandat.md', memory: '~/.ledge/memoire/' });
    expect(mandatePath('/root/.ledge/mandat.md').file).toBe('~/.ledge/mandat.md');
    expect(mandatePath(undefined).file).toBe('~/.ledge/mandat.md');
    expect(mandatePath('/tmp/x/mandat.md')).toEqual({ file: '/tmp/x/mandat.md', memory: '/tmp/x/memoire/' });
  });
});
