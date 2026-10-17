import { z } from 'zod';
import type { Pending, Tool } from './session.js';

/** What the user answers to a permission, a diff or a plan: `always` stops asking (see DECISION_OFFERS). */
export const DecisionSchema = z.enum(['accept', 'deny', 'always']);
export type Decision = z.infer<typeof DecisionSchema>;

/** The longest note a refusal carries to the agent. */
export const NOTE_MAX = 4000;

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
