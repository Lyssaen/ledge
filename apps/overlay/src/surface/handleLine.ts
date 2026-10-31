import type { Escalation, Exchange, MandateCategory, Rig, Session } from '@ledge/protocol';
import { isStandalone } from '@ledge/ui/rigs/model';
import { seatName } from '@ledge/ui/chat/ledge/threadModel';

/** What the closed notch says beside Ledge (spec §8.5, `nn-closed-*`). */
export type HandleLine =
  | { kind: 'calm' }
  | { kind: 'exchange'; rigName: string; from: string; to: string; text: string }
  | { kind: 'decided'; text: string }                                               // « J'ai tranché pour build : merge, pas de rebase »
  | { kind: 'forYou'; category?: MandateCategory; summary: string; count: number }; // « Architecture · orch-lead : JSON ou SQLite ? · 1 »

/** How long a decision or an exchange stays on the closed notch after it arrives. */
export const LINE_LINGER_MS = 5000;

/** The oldest standalone session waiting on the user: its name and what it asks. */
export interface WaitingSession { name: string; text: string }

const frenchSummary = (who: string, what: string) => `${who} : ${what}`;

/** The decisions that wait for the user: `decision` escalations `pending` or in `grace`, asks excepted (each ask is counted
 *  through its waiting session, once: R15). */
const waitsForYou = (e: Escalation) => e.intent === 'decision' && e.source !== 'ask' && (e.state === 'pending' || e.state === 'grace');

/**
 * The closed notch's line. In order: `forYou` while a decision waits or a session waits on the user (the count adds both; the
 * summary is the oldest escalation's, else the waiting session's « <session> : <demande> »); `decided` for 5 s after it arrives;
 * `exchange` for 5 s after it arrives; `calm` otherwise. `summary` says « who : what » in the app's language (French by default).
 */
export function handleLine(o: {
  escalations: readonly Escalation[]; attention: number; waiting?: WaitingSession;
  lastExchange?: { x: Exchange; rigName: string; seenAt: number }; lastDecided?: { text: string; seenAt: number }; now: number;
  summary?: (who: string, what: string) => string;
}): HandleLine {
  const say = o.summary ?? frenchSummary;
  let oldest: Escalation | undefined, waiting = 0;
  for (const e of o.escalations) {
    if (!waitsForYou(e)) continue;
    waiting++;
    if (!oldest || Date.parse(e.createdAt) < Date.parse(oldest.createdAt)) oldest = e;
  }
  const count = waiting + o.attention;
  if (count > 0) {
    if (oldest) return { kind: 'forYou', ...(oldest.category ? { category: oldest.category } : {}), summary: say(seatName(oldest.from), oldest.summary || oldest.questions[0]?.question || ''), count };
    return { kind: 'forYou', summary: o.waiting ? say(o.waiting.name, o.waiting.text) : '', count };
  }
  const fresh = (seenAt: number) => o.now >= seenAt && o.now - seenAt < LINE_LINGER_MS;
  if (o.lastDecided && fresh(o.lastDecided.seenAt)) return { kind: 'decided', text: o.lastDecided.text };
  if (o.lastExchange && fresh(o.lastExchange.seenAt)) {
    const { x, rigName } = o.lastExchange;
    return { kind: 'exchange', rigName, from: seatName(x.from), to: seatName(x.to), text: x.text };
  }
  return { kind: 'calm' };
}

const waitsOnUser = (s: Session) => !s.offline && (s.state === 'waiting_permission' || s.state === 'waiting_input');

/** The sessions waiting on the user, as the sidebar's « À toi » counts them: standalone and online ones only (a rig seat goes
 *  through its rig, R15), and the one waiting longest (by its last activity) with what it asks. */
export function waitingOf(sessions: readonly Session[], rigs: readonly Rig[]): { attention: number; waiting?: WaitingSession } {
  const waiting = sessions.filter(s => waitsOnUser(s) && isStandalone(s, rigs));
  if (waiting.length === 0) return { attention: 0 };
  const oldest = waiting.reduce((a, b) => (Date.parse(b.lastActivityAt) < Date.parse(a.lastActivityAt) ? b : a));
  return { attention: waiting.length, waiting: { name: oldest.name, text: oldest.pending?.text ?? '' } };
}
