/** The comic balloon's situation. Urgency is the array order: an approval outranks a finished notice. */
export type SayKind = 'approval' | 'question' | 'diff' | 'plan' | 'error' | 'ledge' | 'finished';
export const SAY_PRIORITY: readonly SayKind[] = ['approval', 'question', 'diff', 'plan', 'error', 'ledge', 'finished'];

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
