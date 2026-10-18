import { z } from 'zod';
import type { Pending, Tool } from './session.js';

/** What the user answers to a permission, a diff or a plan: `always` stops asking (see DECISION_OFFERS). */
export const DecisionSchema = z.enum(['accept', 'deny', 'always']);
export type Decision = z.infer<typeof DecisionSchema>;

/** The longest note a refusal carries to the agent. */
export const NOTE_MAX = 4000;

/** The `code` of a refusal whose deny happened but whose note could not be typed (the input box did not come back). */
export const NOTE_NOT_TYPED = 'note_not_typed';

/** Ce qu'un harnais laisse répondre au-delà d'accept / deny, par sorte de demande : `always` (permission : ne plus demander ;
 *  plan : approuver et accepter les modifications automatiquement) et une note (refuser avec un texte que l'agent lit). */
export const DECISION_OFFERS: Record<Tool, { always: readonly Pending['kind'][]; note: readonly Pending['kind'][] }> = {
  claude: { always: ['permission', 'diff', 'plan'], note: ['permission', 'diff', 'plan'] },
  codex: { always: ['permission', 'diff'], note: ['permission', 'diff', 'plan'] },
  cursor: { always: [], note: ['permission', 'plan'] }
};

export function offers(tool: Tool, kind: Pending['kind'], what: 'always' | 'note'): boolean {
  return DECISION_OFFERS[tool][what].includes(kind);
}

/** cyrb53: a fast 53-bit string hash, the same in Node and the browser (no async crypto). */
function cyrb53(str: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** A request's fingerprint over everything a decision answers (what is asked, the plan's body, the options, who asks):
 *  the same on the front that showed it and in the daemon about to type, so a request changed under its label is told apart. */
export function pendingKey(p: Pending): string {
  const s = JSON.stringify([p.kind, p.text, p.body ?? null, p.tool ?? null, p.options ?? null, p.optionDetails ?? null, p.helperId ?? null]);
  return cyrb53(s, 0) + cyrb53(s, 1);
}
