import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { LedgeDecisionSchema, LedgeRuleSchema, type Escalation, type LedgeDecision, type LedgeRule, type MandateCategory } from '@ledge/protocol';

export interface Memory {
  rules(): LedgeRule[];
  /** Newest first. `since` keeps decisions whose `at` is >= the ISO string. */
  decisions(o?: { limit?: number; since?: string }): LedgeDecision[];
  /** Appends a line to decisions.jsonl; bumps the rule's appliedCount when `d.rule` names one. */
  record(d: Omit<LedgeDecision, 'id'>): LedgeDecision;
  propose(text: string, category: MandateCategory, from: string): LedgeRule;
  /** 'rejected' removes the rule from the file and returns the removed rule; null when the id is unknown. */
  setRule(id: string, status: 'active' | 'rejected'): LedgeRule | null;
  /** `by` is the id of the new decision. Appends an updated line for the same id (last line wins on read). */
  markRevisited(decisionId: string, by: string): LedgeDecision | null;
  repeatedUserAnswer(d: LedgeDecision, escalations: (id: string) => Escalation | undefined): { category: MandateCategory; label: string; decisions: [string, string] } | null;
  onChange(fn: () => void): () => void;
}

/** « <question> → <libellé> » */
export function fallbackRuleText(question: string, label: string): string { return `${question} → ${label}`; }

/** Lowercase, collapsed spaces, no trailing punctuation. */
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s.,;:!?…]+$/u, '');

export function createMemory(o: { dir: string; now?: () => string; uuid?: () => string }): Memory {
  const now = o.now ?? (() => new Date().toISOString());
  const uuid = o.uuid ?? randomUUID;
  const rulesPath = join(o.dir, 'rules.json');
  const decisionsPath = join(o.dir, 'decisions.jsonl');
  const listeners = new Set<() => void>();
  const changed = (): void => { for (const f of [...listeners]) f(); };

  const readRules = (): LedgeRule[] => {
    try {
      const raw: unknown = JSON.parse(readFileSync(rulesPath, 'utf8'));
      if (!Array.isArray(raw)) return [];
      return raw.flatMap(r => { const p = LedgeRuleSchema.safeParse(r); return p.success ? [p.data] : []; });
    } catch { return []; }
  };
  const writeRules = (rules: LedgeRule[]): void => {
    mkdirSync(o.dir, { recursive: true });
    const tmp = `${rulesPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(rules, null, 2));
    renameSync(tmp, rulesPath);
  };
  /** Chronological, deduplicated by id (the last line of an id wins); torn or invalid lines are skipped. */
  const readDecisions = (): LedgeDecision[] => {
    let text: string;
    try { text = readFileSync(decisionsPath, 'utf8'); } catch { return []; }
    const byId = new Map<string, LedgeDecision>();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let json: unknown;
      try { json = JSON.parse(line); } catch { continue; }
      const p = LedgeDecisionSchema.safeParse(json);
      if (!p.success) continue;
      byId.delete(p.data.id); // keeps first-appearance order irrelevant: re-set below
      byId.set(p.data.id, p.data);
    }
    return [...byId.values()];
  };
  const appendDecision = (d: LedgeDecision): void => {
    mkdirSync(o.dir, { recursive: true });
    appendFileSync(decisionsPath, `${JSON.stringify(d)}\n`);
  };

  /** What an answer says: the label of the chosen option of the escalation's only question (or the raw answer when it matches no option). */
  const answerLabel = (d: LedgeDecision, esc: Escalation | undefined): string | undefined => {
    if (!esc || esc.questions.length !== 1) return undefined;
    const q = esc.questions[0]!;
    const a = d.answers[q.id];
    if (a === undefined) return undefined;
    return q.options.find(op => op.id === a)?.label ?? a;
  };

  return {
    rules: readRules,
    decisions(opt = {}) {
      let all = readDecisions().reverse();
      // Order by `at`, newest first; ties keep the later-written line first (stable on the reversed list).
      all = all.map((d, i) => ({ d, i })).sort((a, b) => (a.d.at < b.d.at ? 1 : a.d.at > b.d.at ? -1 : a.i - b.i)).map(x => x.d);
      if (opt.since) all = all.filter(d => d.at >= opt.since!);
      return opt.limit === undefined ? all : all.slice(0, opt.limit);
    },
    record(d) {
      const full: LedgeDecision = { ...d, id: uuid() };
      appendDecision(full);
      if (d.rule) {
        const rules = readRules();
        const r = rules.find(x => x.id === d.rule);
        if (r) { r.appliedCount += 1; writeRules(rules); }
      }
      changed();
      return full;
    },
    propose(text, category, from) {
      const rule: LedgeRule = { id: uuid(), text, category, since: now().slice(0, 10), from, appliedCount: 0, status: 'proposed' };
      writeRules([...readRules(), rule]);
      changed();
      return rule;
    },
    setRule(id, status) {
      const rules = readRules();
      const r = rules.find(x => x.id === id);
      if (!r) return null;
      if (status === 'rejected') writeRules(rules.filter(x => x.id !== id));
      else { r.status = 'active'; writeRules(rules); }
      changed();
      return r;
    },
    markRevisited(decisionId, by) {
      const cur = readDecisions().find(x => x.id === decisionId);
      if (!cur) return null;
      const next = { ...cur, revisitedBy: by };
      appendDecision(next);
      changed();
      return next;
    },
    repeatedUserAnswer(d, escalations) {
      if (d.by !== 'user') return null;
      const label = answerLabel(d, escalations(d.escalationId));
      if (!label) return null;
      const want = norm(label);
      const prev = readDecisions().reverse().find(p => p.id !== d.id && p.by === 'user' && p.category === d.category
        && norm(answerLabel(p, escalations(p.escalationId)) ?? '') === want);
      if (!prev) return null;
      // Already covered: an active or proposed rule of this category that came from either decision (its `from` is "id1,id2"),
      // or whose normalized text contains the normalized label.
      const covered = readRules().some(r => r.category === d.category
        && (r.from.split(',').map(s => s.trim()).some(id => id === d.id || id === prev.id) || norm(r.text).includes(want)));
      if (covered) return null;
      return { category: d.category, label, decisions: [prev.id, d.id] };
    }
    ,
    onChange(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }
  };
}
