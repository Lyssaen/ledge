import { MandateCategorySchema, parseMandate, type Escalation, type LedgeDecision, type LedgeRule, type MandateCategory } from '@ledge/protocol';
import { localDay } from '@ledge/ui/chat/ledge/threadModel';

/** The categories in the mandate's own order (git, tests, context, code, design, architecture, critical). */
export const CATEGORIES: readonly MandateCategory[] = MandateCategorySchema.options;
const WEEK_MS = 7 * 86_400_000;

/** The decisions of the local day `today` (`YYYY-MM-DD`), in the order given; `by` keeps only Ledge's or only the user's. */
export function decisionsToday(decisions: readonly LedgeDecision[], today: string, by?: 'ledge' | 'user'): LedgeDecision[] {
  return decisions.filter(d => localDay(d.at) === today && (by === undefined || d.by === by));
}

/** The two columns of « Ce que Ledge tranche »: `self` is the file's « Ledge tranche seul » (the daemon's own parser, so the guard and the
 *  tab never disagree); `user` is every other category, in the canonical order. An unreadable mandate gives everything to the user. */
export function mandateSides(text: string): { self: MandateCategory[]; user: MandateCategory[]; readable: boolean } {
  const m = parseMandate(text);
  return { self: m.self, user: CATEGORIES.filter(c => !m.self.includes(c)), readable: m.readable };
}

/** Per category (C20): `week` = its decisions (Ledge's and the user's) of the last 7 days up to `now`; `pending` = its escalations still
 *  `pending` (an escalation in grace is Ledge's for now, not yet the user's). */
export function categoryStats(decisions: readonly LedgeDecision[], escalations: readonly Escalation[], now: string): Record<MandateCategory, { week: number; pending: number }> {
  const end = Date.parse(now);
  const out = Object.fromEntries(CATEGORIES.map(c => [c, { week: 0, pending: 0 }])) as Record<MandateCategory, { week: number; pending: number }>;
  for (const d of decisions) {
    const t = Date.parse(d.at);
    if (t <= end && end - t < WEEK_MS) out[d.category].week += 1;
  }
  for (const e of escalations) if (e.state === 'pending' && e.category) out[e.category].pending += 1;
  return out;
}

/** Souvenirs' filters: who decided, the category, the rig (by id); each one left out keeps everything. */
export function filterMemories(decisions: readonly LedgeDecision[], f: { by?: 'ledge' | 'user'; category?: MandateCategory; rig?: string }): LedgeDecision[] {
  return decisions.filter(d => (f.by === undefined || d.by === f.by) && (f.category === undefined || d.category === f.category) && (f.rig === undefined || d.rigId === f.rig));
}

/** The words of « D'où elle vient » (French by default, the tab passes its language's). */
export interface RuleSourceCopy { twice: string; order: string; answerTo(seat: string): string }
const FR_SOURCE: RuleSourceCopy = { twice: 'tu as tranché deux fois pareil', order: 'ta consigne', answerTo: seat => `ta réponse à ${seat}` };

/**
 * « D'où elle vient »: `rule.from` is the comma-separated ids of the decisions it came from (`ledge brain remember --from`, or the two
 * same answers the daemon noticed). Mapping:
 * - two ids or more → « tu as tranché deux fois pareil »;
 * - one decision of the user's, for a seat → « ta réponse à <siège> » (the seat's name, without `@rig`);
 * - one decision of Ledge's → what it settled (its summary, e.g. « force-push refusé »);
 * - anything else (no id, an id no longer among the decisions, a user answer with no seat) → « ta consigne ».
 */
export function ruleSource(rule: LedgeRule, decisions: readonly LedgeDecision[], copy: RuleSourceCopy = FR_SOURCE): string {
  const ids = rule.from.split(',').map(x => x.trim()).filter(Boolean);
  if (ids.length >= 2) return copy.twice;
  const d = ids.length === 1 ? decisions.find(x => x.id === ids[0]) : undefined;
  if (!d) return copy.order;
  if (d.by === 'ledge') return d.summary;
  return d.from ? copy.answerTo(d.from.split('@')[0]!) : copy.order;
}

const HOME_MANDATE = /^(?:\/home\/[^/]+|\/root|\/Users\/[^/]+)\/\.ledge\/mandat\.md$/;

/** Where the mandate and the memory are, as the tab writes them: `~/.ledge/…` when the daemon's path is the default one with the home
 *  expanded (or not sent yet); else the real path (a LEDGE_HOME elsewhere), the memory beside it. */
export function mandatePath(path: string | undefined): { file: string; memory: string } {
  if (path === undefined || HOME_MANDATE.test(path)) return { file: '~/.ledge/mandat.md', memory: '~/.ledge/memoire/' };
  return { file: path, memory: `${path.slice(0, path.lastIndexOf('/') + 1)}memoire/` };
}

/** `YYYY-MM-DD…` → « jj/mm ». */
export const dayMonth = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
