import { MandateCategorySchema, type Escalation, type MandateCategory, type RigResultCode } from '@ledge/protocol';
import { log } from '../../log.js';
import type { Answers } from '../openrig/answer.js';
import type { EscalationPatch } from '../openrig/bridge.js';
import type { LedgeThread } from '../ledgeThread.js';
import { GRACE_MS, guardDecide, validAnswers } from './guard.js';
import type { BrainEvent } from './inbox.js';
import { fallbackRuleText, type Memory } from './memory.js';
import type { Mandate } from './mandate.js';

/** Without a decide or an ask from the brain, a grace ends here: back to `pending`, without advice. */
export const GRACE_CAP_MS = 600_000;

export type DecideCode = Extract<RigResultCode, 'mandate' | 'invalid' | 'already_answered' | 'failed' | 'unreachable' | 'openrig_down'>;
export type DecideResult = { ok: boolean; line: string; code?: DecideCode };
export type AskResult = { ok: boolean; line: string; code?: Extract<RigResultCode, 'invalid' | 'already_answered' | 'failed'> };

export interface Deciding {
  /** Each new escalation: a `decision` with questions enters grace when the brain is on; every pending one is pushed to the brain. */
  arrived(e: Escalation): void;
  /** `ledge brain decide`: the guard, then the answer, held until graceUntil; the line is for the brain. */
  decide(id: string, answers: Record<string, string>, claimed: string, o: { rule?: string; why?: string }): Promise<DecideResult>;
  /** `ledge brain ask`: category (optional), advice, state pending; never refused by the guard. */
  ask(id: string, category: string | undefined, advice: string): AskResult;
  /** The brain is down or off: every grace goes back to pending, deferred decisions are dropped. */
  release(reason: string): void;
  dispose(): void;
}

/** The slice of the OpenRig bridge grace needs (`bridge.escalation`, `bridge.patchEscalation`). */
export interface DecidingPort {
  escalation(id: string): Escalation | undefined;
  patchEscalation(id: string, p: EscalationPatch): Escalation | undefined;
}

export interface DecidingDeps {
  escalations: DecidingPort;
  answers: Answers;
  thread: Pick<LedgeThread, 'append'>;
  memory: Memory;
  inbox: { push(e: BrainEvent): boolean };
  mandate: () => Mandate;
  brainOn: () => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

type Deferred = { answers: Record<string, string>; category: MandateCategory; rule?: string; why?: string; timer: unknown };

const pad = (n: number): string => String(n).padStart(2, '0');
const clock = (ms: number): string => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const closed = (e: Escalation): boolean => e.state === 'answered' || e.state === 'closed';
/** « <question> → <label> » per answered question: what the decision says, for the thread and the memory. */
const summaryOf = (e: Escalation, answers: Record<string, string>): string => {
  const parts = e.questions.flatMap(q => answers[q.id] === undefined ? [] : [`${q.question} → ${q.options.find(o => o.id === answers[q.id])?.label ?? answers[q.id]}`]);
  return parts.length ? parts.join(' ; ') : e.summary;
};

/**
 * Grace and the brain's decisions. Everything here lives in memory only: a daemon restart drops the grace overlays (the bridge's
 * patches are in memory too) and the deferred decisions, so the escalation falls back to `pending` and the user answers it.
 * The first answer wins: a user answer during grace cancels the deferred decision, and `answers.answer` refuses a late one anyway.
 */
export function createDeciding(d: DecidingDeps): Deciding {
  const now = d.now ?? (() => Date.now());
  const setTimer = d.setTimer ?? ((fn: () => void, ms: number) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return t; });
  const clearTimer = d.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  /** Escalations this module put in grace, with their arrival (the cap counts from it). */
  const graced = new Map<string, number>();
  const caps = new Map<string, unknown>();
  const deferred = new Map<string, Deferred>();

  const clearCap = (id: string): void => { const t = caps.get(id); if (t !== undefined) { clearTimer(t); caps.delete(id); } };
  const dropDeferred = (id: string): void => { const x = deferred.get(id); if (x) { clearTimer(x.timer); deferred.delete(id); } };
  /** Back to pending (graceUntil removed) when it is still in grace; forgets the grace either way. */
  const ungrace = (id: string, extra: EscalationPatch = {}): void => {
    clearCap(id); dropDeferred(id); graced.delete(id);
    const e = d.escalations.escalation(id);
    if (e && !closed(e)) d.escalations.patchEscalation(id, { state: 'pending', graceUntil: undefined, ...extra });
  };
  const armCap = (id: string): void => {
    clearCap(id);
    const at = graced.get(id); if (at === undefined) return;
    caps.set(id, setTimer(() => { caps.delete(id); if (!deferred.has(id)) { log(`brain: grace of ${id} capped, back to pending`); ungrace(id); } }, Math.max(0, at + GRACE_CAP_MS - now())));
  };
  const push = (e: BrainEvent): void => { try { d.inbox.push(e); } catch (err) { log(`brain: inbox push failed: ${(err as Error).message}`); } };

  async function apply(id: string, x: Omit<Deferred, 'timer'>): Promise<DecideResult> {
    const e = d.escalations.escalation(id);
    if (!e) return { ok: false, code: 'failed', line: `Aucune escalade ${id}.` };
    const r = await d.answers.answer(id, x.answers, 'ledge', x.rule ? { rule: x.rule } : {});
    if (!r.ok) {
      // A failed answer puts the escalation back as it was (grace): released meanwhile, or with the brain off, nobody would take
      // it out of grace again, so it goes back to pending (F-I10).
      if (!graced.has(id) || !d.brainOn()) ungrace(id);
      else if (!caps.has(id)) armCap(id);
      return { ok: false, code: r.code, line: `Pas appliqué : ${r.reason}.` };
    }
    clearCap(id); graced.delete(id);
    const decision = d.memory.record({ by: 'ledge', category: x.category, escalationId: id, summary: summaryOf(e, x.answers), answers: x.answers,
      ...(x.rule ? { rule: x.rule } : {}), ...(x.why ? { why: x.why } : {}), at: new Date(now()).toISOString(), from: e.from, ...(e.rigId ? { rigId: e.rigId } : {}) });
    d.thread.append({ kind: 'decided', decisionId: decision.id });
    return { ok: true, line: `Appliqué pour ${e.from} : ${decision.summary}.` };
  }

  function askImpl(id: string, category: string | undefined, advice: string, fromGuard: boolean): AskResult {
    const e = d.escalations.escalation(id);
    if (!e) return { ok: false, code: 'failed', line: `Aucune escalade ${id}.` };
    if (closed(e)) return { ok: false, code: 'already_answered', line: `L'escalade ${id} a déjà sa réponse.` };
    let cat: MandateCategory | undefined;
    if (category !== undefined && category !== '') {
      const p = MandateCategorySchema.safeParse(category);
      if (!p.success) return { ok: false, code: 'invalid', line: `Catégorie inconnue : ${category}.` };
      cat = p.data;
    }
    const text = advice.trim();
    if (!text && !fromGuard) return { ok: false, code: 'invalid', line: "L'avis est vide." };
    ungrace(id, { ...(cat ? { category: cat } : {}), ...(text ? { advice: text } : {}) });
    return { ok: true, line: `Remonté à l'utilisateur${text ? ' avec ton avis' : ''}.` };
  }

  const unsubscribe = d.answers.onAnswered(e => {
    if (e.answer?.by !== 'user') return;   // a Ledge answer is recorded by `apply`
    clearCap(e.id); dropDeferred(e.id); graced.delete(e.id);
    // An uncategorised escalation is recorded without a category, never a guessed one (F-I1).
    const decision = d.memory.record({ by: 'user', ...(e.category ? { category: e.category } : {}), escalationId: e.id, summary: summaryOf(e, e.answer.answers), answers: e.answer.answers,
      at: e.answer.at, from: e.from, ...(e.rigId ? { rigId: e.rigId } : {}) });
    // A correction (« Revenir dessus »): the corrected decision points to this one.
    if (e.correcting) d.memory.markRevisited(e.correcting, decision.id);
    push({ kind: 'answered', escalation: e });
    const pair = d.memory.repeatedUserAnswer(decision, id => d.escalations.escalation(id));
    if (!pair) return;
    const from = pair.decisions.join(',');
    const question = e.questions[0]?.question ?? e.summary;
    if (d.brainOn()) {
      push({ kind: 'state', text: `L'utilisateur a tranché deux fois pareil en ${pair.category} (« ${question} → ${pair.label} ») : propose une règle avec \`ledge brain remember "…" --from ${from}\`.` });
    } else d.memory.propose(fallbackRuleText(question, pair.label), pair.category, from);
  });

  return {
    arrived(e) {
      if (closed(e) || !d.brainOn()) return;   // without a brain: pending, without advice (spec §6)
      if (e.intent === 'decision' && e.source !== 'ask' && e.questions.length > 0 && e.state === 'pending') {
        const at = now();
        const next = d.escalations.patchEscalation(e.id, { state: 'grace', graceUntil: new Date(at + GRACE_MS).toISOString() });
        if (!next) return;
        graced.set(e.id, at); armCap(e.id);
        push({ kind: 'escalation', escalation: next, rules: d.memory.rules().filter(r => r.status === 'active') });
        return;
      }
      // An update, a free ask: for information only, it stays pending.
      push({ kind: 'escalation', escalation: e, rules: d.memory.rules().filter(r => r.status === 'active') });
    },

    async decide(id, answers, claimed, o) {
      const e = d.escalations.escalation(id);
      if (!e) return { ok: false, code: 'failed', line: `Aucune escalade ${id}.` };
      if (closed(e)) return { ok: false, code: 'already_answered', line: `L'escalade ${id} a déjà sa réponse.` };
      const verdict = guardDecide(e, claimed, answers, d.mandate());
      if (!verdict.ok) {
        askImpl(id, verdict.category, '', true);
        push({ kind: 'refused', escalationId: id, reason: verdict.reason });
        return { ok: false, code: 'mandate', line: `Refusé par le garde : ${verdict.reason}. C'est remonté à l'utilisateur ; complète ton avis avec \`ledge brain ask ${id} --advice "…"\`.` };
      }
      if (e.intent === 'update') return { ok: false, code: 'invalid', line: 'Une mise à jour se lit, elle ne se tranche pas.' };
      const bad = validAnswers(e, answers);
      if (bad) return { ok: false, code: 'invalid', line: `Réponse invalide : ${bad}.` };
      const x = { answers, category: verdict.category, ...(o.rule ? { rule: o.rule } : {}), ...(o.why ? { why: o.why } : {}) };
      const until = e.graceUntil ? Date.parse(e.graceUntil) : NaN;
      if (Number.isFinite(until) && now() < until) {
        dropDeferred(id); clearCap(id);   // the latest decide wins; a deferred decision counts as the brain's action
        const timer = setTimer(() => {
          deferred.delete(id);
          const cur = d.escalations.escalation(id);
          if (!cur || closed(cur)) return;   // the user answered first
          void apply(id, x).then(r => {
            if (!r.ok) push({ kind: 'state', text: `Ta décision sur ${id} n'a pas pu partir (${r.code}) : ${r.line}` });
          }).catch(err => log(`brain: deferred decision on ${id} threw: ${(err as Error).message}`));
        }, until - now());
        deferred.set(id, { ...x, timer });
        return { ok: true, line: `Noté : je l'applique à ${clock(until)} si l'utilisateur n'a pas répondu.` };
      }
      return apply(id, x);
    },

    ask(id, category, advice) { return askImpl(id, category, advice, false); },

    release(reason) {
      const ids = new Set([...graced.keys(), ...deferred.keys()]);
      if (ids.size) log(`brain: ${reason}, ${ids.size} grace(s) back to pending`);
      for (const id of ids) ungrace(id);
    },

    dispose() {
      unsubscribe();
      for (const t of caps.values()) clearTimer(t);
      for (const x of deferred.values()) clearTimer(x.timer);
      caps.clear(); deferred.clear(); graced.clear();
    },
  };
}
