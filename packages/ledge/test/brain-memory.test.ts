import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Escalation, LedgeDecision } from '@ledge/protocol';
import { createMemory, fallbackRuleText, type Memory } from '../src/daemon/brain/memory.js';

let dir: string; let n: number; let mem: Memory;
const mk = (): Memory => createMemory({ dir, now: () => '2026-10-31T10:00:00.000Z', uuid: () => `id${++n}` });
beforeEach(() => { dir = join(mkdtempSync(join(tmpdir(), 'mem-')), 'memoire'); n = 0; mem = mk(); });

const esc = (id: string, label: string): Escalation => ({ id, source: 'rig', machine: 'm', from: 'a@r', intent: 'decision', summary: 's',
  questions: [{ id: 'q1', question: 'Comment fusionner ?', options: [{ id: 'o1', label }, { id: 'o2', label: 'Autre' }] }],
  createdAt: '2026-10-31T09:00:00.000Z', state: 'answered' });
const escs: Record<string, Escalation> = { e1: esc('e1', 'Merge'), e2: esc('e2', ' merge. '), e3: esc('e3', 'merge'), e4: esc('e4', 'Rebase') };
const lookup = (id: string): Escalation | undefined => escs[id];
const dec = (escalationId: string, extra: Partial<LedgeDecision> = {}): Omit<LedgeDecision, 'id'> =>
  ({ escalationId, by: 'user', category: 'git', summary: 's', answers: { q1: 'o1' }, at: '2026-10-31T09:00:00.000Z', ...extra });

describe('brain memory', () => {
  it('decisions persist and come back newest first', () => {
    mem.record(dec('e1', { at: '2026-10-31T09:00:00.000Z' }));
    mem.record(dec('e2', { at: '2026-10-31T09:05:00.000Z' }));
    const again = mk().decisions();
    expect(again.map(d => d.escalationId)).toEqual(['e2', 'e1']);
    expect(mem.decisions({ limit: 1 }).map(d => d.escalationId)).toEqual(['e2']);
    expect(mem.decisions({ since: '2026-10-31T09:03:00.000Z' }).map(d => d.escalationId)).toEqual(['e2']);
  });

  it('applying a rule counts it, and changes are announced', () => {
    const r = mem.propose('x', 'git', 'd0'); mem.setRule(r.id, 'active');
    let calls = 0; const off = mem.onChange(() => { calls++; });
    mem.record(dec('e1', { by: 'ledge', rule: r.id })); mem.record(dec('e2', { by: 'ledge', rule: r.id }));
    expect(mem.rules()[0]!.appliedCount).toBe(2);
    expect(calls).toBe(2); off(); mem.record(dec('e3')); expect(calls).toBe(2);
    expect(existsSync(join(dir, 'rules.json.tmp'))).toBe(false);
  });

  it('proposes with today and activates or rejects', () => {
    const r = mem.propose('t', 'tests', 'd1,d2');
    expect(r).toMatchObject({ status: 'proposed', since: '2026-10-31', appliedCount: 0, from: 'd1,d2' });
    expect(mem.setRule(r.id, 'active')?.status).toBe('active');
    expect(mem.rules()[0]!.status).toBe('active');
    expect(mem.setRule('nope', 'active')).toBeNull();
  });

  it('two identical user answers in one category are found once', () => {
    const d1 = mem.record(dec('e1'));
    expect(mem.repeatedUserAnswer(d1, lookup)).toBeNull();
    const d2 = mem.record(dec('e2'));
    const found = mem.repeatedUserAnswer(d2, lookup);
    expect(found).toEqual({ category: 'git', label: ' merge. ', decisions: [d1.id, d2.id] });
    mem.propose(fallbackRuleText('Comment fusionner ?', 'merge'), 'git', `${d1.id},${d2.id}`);
    const d3 = mem.record(dec('e3'));
    expect(mem.repeatedUserAnswer(d3, lookup)).toBeNull();
  });

  it('a rule from one of the decisions also covers the pair', () => {
    const d1 = mem.record(dec('e1')); const d2 = mem.record(dec('e2'));
    mem.propose('autre texte', 'git', `${d1.id},zz`);
    expect(mem.repeatedUserAnswer(d2, lookup)).toBeNull();
  });

  it('different labels, categories or Ledge decisions do not count', () => {
    mem.record(dec('e1'));
    expect(mem.repeatedUserAnswer(mem.record(dec('e4')), lookup)).toBeNull();
    expect(mem.repeatedUserAnswer(mem.record(dec('e2', { category: 'tests' })), lookup)).toBeNull();
    expect(mem.repeatedUserAnswer(mem.record(dec('e2', { by: 'ledge' })), lookup)).toBeNull();
    const l = mem.record(dec('e1', { by: 'ledge' }));
    expect(mem.repeatedUserAnswer({ ...mem.record(dec('e3', { category: 'code' })) }, lookup)).toBeNull();
    expect(l.by).toBe('ledge');
  });

  it('a rejected proposal is removed', () => {
    const r = mem.propose('t', 'git', 'd1,d2');
    expect(mem.setRule(r.id, 'rejected')).toEqual(r);
    expect(mem.rules()).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, 'rules.json'), 'utf8'))).toEqual([]);
    expect(mem.setRule(r.id, 'rejected')).toBeNull();
  });

  it('markRevisited appends an updated line, last line wins', () => {
    const d1 = mem.record(dec('e1'));
    const u = mem.markRevisited(d1.id, 'd9');
    expect(u?.revisitedBy).toBe('d9');
    expect(mem.decisions()).toHaveLength(1);
    expect(mem.decisions()[0]!.revisitedBy).toBe('d9');
    expect(readFileSync(join(dir, 'decisions.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);
    expect(mem.markRevisited('nope', 'x')).toBeNull();
  });

  it('a torn decisions.jsonl line is skipped', () => {
    mem.record(dec('e1'));
    appendFileSync(join(dir, 'decisions.jsonl'), '{"id":"zz","escal\n{"id":1}\n');
    writeFileSync(join(dir, 'rules.json'), '{broken');
    expect(mem.decisions()).toHaveLength(1);
    expect(mem.rules()).toEqual([]);
  });
});
