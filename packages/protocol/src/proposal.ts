import { z } from 'zod';

/** What the chat harness writes in its ```ledge-session block (spec 2026-10-12 §3); the daemon resolves `cwd`. */
export const ProposalBlockSchema = z.object({ cwd: z.string().trim().min(1), prompt: z.string().optional() });
export type ProposalBlock = z.infer<typeof ProposalBlockSchema>;

/** What the chat harness writes in its ```ledge-relay block (spec 2026-10-12 relay §3); the daemon checks the session. */
export const RelayBlockSchema = z.object({ session: z.string().trim().min(1), text: z.string().trim().min(1) });
export type RelayBlock = z.infer<typeof RelayBlockSchema>;

/** What the chat harness writes in its ```ledge-project block (lot 11, task 5): a project to create, or with `addTo` the name of an
 *  existing project to complete; only paths travel (the daemon keeps those that exist), each with the LLM's reason. */
export const ProjectBlockSchema = z.object({
  name: z.string().trim().min(1).max(80), description: z.string().max(500).optional(),
  repos: z.array(z.object({ path: z.string().min(1), why: z.string().trim().min(1).max(200) })).min(1).max(50),
  addTo: z.string().trim().max(80).optional()
});
export type ProjectBlock = z.infer<typeof ProjectBlockSchema>;

export type BlockKind = 'session' | 'relay' | 'project';
const FENCES = ['```ledge-session', '```ledge-relay', '```ledge-project'];
/** A block from its fence to the closing fence, or to the end of the text when it is not closed (yet). */
const BLOCK = /```ledge-(session|relay|project)[ \t]*\n?([\s\S]*?)(?:```|$)/g;

/** The answer without its card blocks, and the language and content of the last one (null when there is none). */
export function extractProposal(answer: string): { text: string; kind: BlockKind | null; raw: string | null } {
  const found: Array<{ kind: BlockKind; raw: string }> = [];
  const text = answer.replace(BLOCK, (_m, kind: BlockKind, body: string) => { found.push({ kind, raw: body.trim() }); return ''; });
  const last = found.at(-1);
  return last ? { text: text.replace(/\n{3,}/g, '\n\n').trim(), kind: last.kind, raw: last.raw } : { text: answer, kind: null, raw: null };
}

/** The block's JSON as a proposal, or null when it is not an object with a non-empty `cwd`. */
export function parseProposalBlock(raw: string): ProposalBlock | null {
  try { const r = ProposalBlockSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
}

/** A streamed answer as it may be shown: no block, and no fence still being typed at the end (`` ` `` … ```` ```ledge-se ````, ```` ```ledge-re ````, ```` ```ledge-pro ````). */
export function hideProposal(text: string): string {
  const shown = text.replace(BLOCK, '');
  const lineStart = shown.lastIndexOf('\n') + 1;
  const tail = shown.slice(lineStart);
  // Trailing space is kept unless a block was taken out: deltas often end mid-sentence ("Deux ").
  return tail && FENCES.some(f => f.startsWith(tail)) ? shown.slice(0, lineStart).trimEnd() : text === shown ? text : shown.trimEnd();
}

/** The block's JSON as a relay, or null when it lacks a session or a non-blank text. */
export function parseRelayBlock(raw: string): RelayBlock | null {
  try { const r = RelayBlockSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
}

/** The block's JSON as a project proposal, or null when it breaks the schema (a name, 1 to 50 repositories with a reason, the bounds). */
export function parseProjectBlock(raw: string): ProjectBlock | null {
  try { const r = ProjectBlockSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
}
