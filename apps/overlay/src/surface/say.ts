import type { Session } from '@ledge/protocol';
import type { Messages } from '../i18n/messages.js';

/** What Ledge may speak about in the notch. Urgency is the array order: a session's request outranks an urgent rig ask, which
 *  outranks a point, which outranks Ledge's unread reply (operator spec, board 6). */
export type SayKind = 'approval' | 'question' | 'diff' | 'plan' | 'rigask' | 'point' | 'error' | 'ledge' | 'finished';
export const SAY_PRIORITY: readonly SayKind[] = ['approval', 'question', 'diff', 'plan', 'rigask', 'point', 'error', 'ledge', 'finished'];
/** The kinds that hang a short balloon under the notch; the others speak in the bubble. */
export type BalloonKind = Exclude<SayKind, 'rigask' | 'point'>;
/** How long a balloon stays on the handle once seen; the situation itself (unread, pending) outlives it. */
export const SAY_LINGER_MS = 5000;

export interface SayCandidate { id: string; kind: SayKind; seed: string }

/** A live session that should speak on the handle, or null while it is only working or idle. */
export function sayKindOf(session: { state: string; pending?: { kind: string } | null }): SayKind | null {
  const kind = session.pending?.kind;
  if (session.state === 'waiting_permission' || session.state === 'waiting_input') {
    if (kind === 'diff') return 'diff';
    if (kind === 'plan') return 'plan';
    if (session.state === 'waiting_input' || kind === 'question') return 'question';
    return 'approval';
  }
  if (session.state === 'error') return 'error';
  return null;
}

/** A tool whose request text is a shell command, which Ledge says it « wants to run ». */
const SHELL_TOOL = /bash|shell|exec|command|terminal/i;

/** The heading of a session's request in Ledge's words: the session's name, said in bold, then what it wants, with any
 *  command between backticks for the inline renderer. */
export function ledgeSentence(s: Session, t: Messages): { who: string; rest: string } {
  const p = s.pending;
  const text = p?.text?.trim() ?? '';
  const words = t.bubble.sentence;
  if (p?.kind === 'question' || (s.state === 'waiting_input' && p?.kind !== 'diff' && p?.kind !== 'plan')) return { who: s.name, rest: text ? words.asks(text) : words.asksNothing };
  if (p?.kind === 'diff' || p?.kind === 'plan') return { who: s.name, rest: words.review(p.kind) };
  if (!text) return { who: s.name, rest: words.waits };
  if (!p?.tool || SHELL_TOOL.test(p.tool)) return { who: s.name, rest: words.run(text) };
  return { who: s.name, rest: words.use(p.tool, text) };
}

const hash = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) >>> 0;
  return h;
};

/** One line from the catalogue, stable for a given seed so a rerender does not swap the joke. */
export function pickSay(variants: readonly string[], seed: string): string {
  return variants[hash(seed) % variants.length] ?? variants[0] ?? '';
}

/** The single balloon to show: the most urgent candidate, first in list when kinds tie. */
export function pickSpeaker(candidates: readonly SayCandidate[]): SayCandidate | null {
  let best: SayCandidate | null = null;
  let bestRank = SAY_PRIORITY.length;
  for (const c of candidates) {
    const rank = SAY_PRIORITY.indexOf(c.kind);
    if (rank < bestRank) { best = c; bestRank = rank; }
  }
  return best;
}
