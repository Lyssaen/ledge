import { ALWAYS_USER, MandateCategorySchema, type Escalation, type MandateCategory } from '@ledge/protocol';
import type { Mandate } from './mandate.js';

export const GRACE_MS = 60_000;

const WORDS = ['rm', 'rm -rf', 'drop', 'delete', 'truncate', 'force', 'force-push', '--force', 'reset --hard', 'prod', 'production', 'secret', 'secrets',
  'token', 'credentials', 'billing', 'supprimer', 'suppression', 'facturation'];
const escapeRe = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
/** Whole words only (`-` and `_` are separators, so « api-token » and « db_prod » count): « product » is not « prod ». Longest first, so « force-push » wins over « force ». */
const entries = [...WORDS].sort((a, b) => b.length - a.length)
  .map(w => ({ word: w, re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'iu') }));
export const CRITICAL_WORDS: readonly RegExp[] = entries.map(e => e.re);

/** The longest critical word found in the summary, detail, a question or an option label, or null. */
export function criticalIn(e: Escalation): string | null {
  const texts = [e.summary, e.detail ?? '', ...e.questions.flatMap(q => [q.question, ...q.options.map(o => o.label)])];
  let best: string | null = null;
  for (const t of texts) for (const { word, re } of entries) if (re.test(t) && (best === null || word.length > best.length)) best = word;
  return best;
}

export type GuardVerdict =
  | { ok: true; category: MandateCategory }
  | { ok: false; convert: 'ask'; category: MandateCategory | undefined; reason: string };

/** Steps 1-3 and 5 of the guard; `validAnswers` (step 4) is the caller's. */
export function guardDecide(e: Escalation, claimed: string, _answers: Record<string, string>, mandate: Mandate): GuardVerdict {
  const word = criticalIn(e);
  if (word) return { ok: false, convert: 'ask', category: 'critical', reason: `contient « ${word} »` };
  const parsed = MandateCategorySchema.safeParse(claimed);
  if (!parsed.success) return { ok: false, convert: 'ask', category: undefined, reason: 'catégorie inconnue' };
  const category = parsed.data;
  if ((ALWAYS_USER as readonly string[]).includes(category) || !mandate.self.includes(category)) return { ok: false, convert: 'ask', category, reason: 'te revient' };
  return { ok: true, category };
}

/** null when every question has a valid option id; otherwise why not. */
export function validAnswers(e: Escalation, answers: Record<string, string>): string | null {
  if (e.questions.length === 0) return 'aucune question : rien à trancher';
  for (const q of e.questions) {
    const a = answers[q.id];
    if (a === undefined) return `réponse manquante pour ${q.id}`;
    if (!q.options.some(o => o.id === a)) return `option inconnue pour ${q.id}`;
  }
  return null;
}
