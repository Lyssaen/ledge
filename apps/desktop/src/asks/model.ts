import type { HumanAsk, OpenRigAnswered, Session } from '@ledge/protocol';

/** « À toi »'s sections for OpenRig's asks (docs/mockups/ledge-human-operator-ab-lot1.html): a decision with buttons goes to
 *  « Décisions », a decision without buttons and a row parked on the person to « Questions », a piece of news to « Nouvelles ». */
export type AskSection = 'decisions' | 'questions' | 'updates';
export const ASK_SECTIONS: readonly AskSection[] = ['decisions', 'questions', 'updates'];

export const sectionOf = (a: HumanAsk): AskSection =>
  a.kind === 'update' ? 'updates' : a.kind === 'decision' && a.questions.length > 0 ? 'decisions' : 'questions';

/** The card's pill: what the ask is. */
export const pillOf = (a: HumanAsk): 'decision' | 'question' | 'update' | 'parked' =>
  a.kind === 'update' ? 'update' : a.kind === 'parked' ? 'parked' : a.questions.length > 0 ? 'decision' : 'question';

/** The sidebar's mark on the asking seat's row: only what waits on an answer, the most pressing first (decision, waiting on
 *  you, question); a piece of news marks nothing and counts in no rig (design-ux). */
const MARK_RANK = { decision: 0, parked: 1, question: 2 } as const;
export function markOf(asks: readonly HumanAsk[]): 'decision' | 'parked' | 'question' | null {
  let best: 'decision' | 'parked' | 'question' | null = null;
  for (const a of asks) {
    const p = pillOf(a);
    if (p === 'update') continue;
    if (best === null || MARK_RANK[p] < MARK_RANK[best]) best = p;
  }
  return best;
}

/** The ask's asks per section, in the order the daemon sends them (critical, urgent, then the most recent). */
export function bySection(asks: readonly HumanAsk[]): Record<AskSection, HumanAsk[]> {
  const out: Record<AskSection, HumanAsk[]> = { decisions: [], questions: [], updates: [] };
  for (const a of asks) out[sectionOf(a)].push(a);
  return out;
}

/** The Ledge session that follows the asking seat, if any (its mascot, its name, the sidebar's marks). */
export const sessionOfAsk = (a: HumanAsk, sessions: readonly Session[]): Session | undefined =>
  sessions.find(s => s.rig?.seat === a.from.seat && s.state !== 'exited');

/** The seat's role as the sidebar writes it: `pilot.lead` → `pilot`, `design.ux` stays. */
export const shortRole = (role: string | null): string | null => role?.replace(/\.agent$|\.lead$|\.worker$/, '') ?? null;

/** Who asks: the followed session's name (« Bix »), else the seat's role, else the seat itself. */
export function whoOf(a: HumanAsk, session: Session | undefined): { name: string; role: string | null } {
  const role = shortRole(a.from.role);
  if (session) return { name: session.name, role };
  return { name: role ?? a.from.seat.split('@')[0] ?? a.from.seat, role: null };
}

/** How an answer ended, for the card: done (sent, or settled elsewhere), recorded (other questions wait), or not sent (why, retry). */
export type AnswerEnd =
  | { kind: 'sent' } | { kind: 'already' }
  | { kind: 'recorded'; remaining: readonly string[] }
  | { kind: 'failed'; error: string; message?: string };

export function endOf(r: OpenRigAnswered): AnswerEnd {
  if (r.ok) return r.outcome === 'recorded' ? { kind: 'recorded', remaining: r.remaining ?? [] } : r.outcome === 'already' ? { kind: 'already' } : { kind: 'sent' };
  // A closed or vanished row is no error: it was settled elsewhere (the card says so, then goes).
  if (r.error === 'closed' || r.error === 'not_found') return { kind: 'already' };
  return { kind: 'failed', error: r.error ?? 'unreachable', ...(r.message ? { message: r.message } : {}) };
}

/** How long the « Envoyé à … » / « Déjà réglée ailleurs » line stays before the card goes. */
export const DONE_MS = 1_500;
