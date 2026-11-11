import { z } from 'zod';
import type { Pending, Tool } from './session.js';

/** What the user answers to a permission, a diff or a plan: `always` stops asking (see DECISION_OFFERS). */
export const DecisionSchema = z.enum(['accept', 'deny', 'always']);
export type Decision = z.infer<typeof DecisionSchema>;

/** Who took a decision: the PC (any local front: desktop, overlay, TUI, island) or a linked device, named as it was then.
 *  Set by the daemon only (the phone gateway for a device); what a front sends for it is never trusted. */
export const DecidedBySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pc') }),
  z.object({ kind: z.literal('device'), id: z.string().min(1).max(100), name: z.string().min(1).max(60) })
]);
export type DecidedBy = z.infer<typeof DecidedBySchema>;

/** The longest note a refusal carries to the agent. */
export const NOTE_MAX = 4000;

/** The `code` of a refusal whose deny happened but whose note could not be typed (the input box did not come back). */
export const NOTE_NOT_TYPED = 'note_not_typed';

/** Ce qu'un harnais laisse répondre au-delà d'accept / deny, par sorte de demande : `always` (permission : ne plus demander ;
 *  plan : approuver et accepter les modifications automatiquement) et une note (refuser avec un texte que l'agent lit). */
export const DECISION_OFFERS: Record<Tool, { always: readonly Pending['kind'][]; note: readonly Pending['kind'][] }> = {
  claude: { always: ['permission', 'diff', 'plan'], note: ['permission', 'diff', 'plan'] },
  codex: { always: ['permission', 'diff'], note: ['permission', 'diff', 'plan'] },
  cursor: { always: [], note: ['permission', 'plan'] },
  /** OMP answers its own native requests (spec 2026-10-20 §3.3): no « always », no note until those are typed. */
  omp: { always: [], note: [] }
};

export function offers(tool: Tool, kind: Pending['kind'], what: 'always' | 'note'): boolean {
  return DECISION_OFFERS[tool][what].includes(kind);
}

/** What an offered « always » grants, so every front names it the same: Desktop's button and title, the phone's card. */
export type AlwaysScope = 'project' | 'edits' | 'session' | 'plan';

/** Claude Code's file tools: their « always » turns on accept-edits for the whole session. */
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** What « always » really grants (the option adapters/claude.ts and codex.ts pick on the dialog): Claude's Bash rule goes to
 *  the project's settings, its file tools switch the session to accept-edits, its plan option is accept-edits or auto mode
 *  (2.1); Codex's « don't ask again » holds for that command or those files until the session ends. Only meaningful where
 *  `offers(tool, kind, 'always')`. */
export function alwaysScope(tool: Tool, p: Pick<Pending, 'kind' | 'tool'>): AlwaysScope {
  if (tool !== 'claude') return 'session';
  if (p.kind === 'plan') return 'plan';
  return p.kind === 'diff' || EDIT_TOOLS.has(p.tool ?? '') ? 'edits' : 'project';
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
