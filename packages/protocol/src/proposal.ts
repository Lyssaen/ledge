import { z } from 'zod';

/** What the chat harness writes in its ```ledge-session block (spec 2026-10-12 §3); the daemon resolves `cwd`. */
export const ProposalBlockSchema = z.object({ cwd: z.string().trim().min(1), prompt: z.string().optional() });
export type ProposalBlock = z.infer<typeof ProposalBlockSchema>;

const FENCE = '```ledge-session';
/** A block from its fence to the closing fence, or to the end of the text when it is not closed (yet). */
const BLOCK = /```ledge-session[ \t]*\n?([\s\S]*?)(?:```|$)/g;

/** The answer without its proposal blocks, and the content of the last one (null when there is none). */
export function extractProposal(answer: string): { text: string; raw: string | null } {
  const found: string[] = [];
  const text = answer.replace(BLOCK, (_m, body: string) => { found.push(body.trim()); return ''; });
  return found.length === 0 ? { text: answer, raw: null } : { text: text.replace(/\n{3,}/g, '\n\n').trim(), raw: found.at(-1)! };
}

/** The block's JSON as a proposal, or null when it is not an object with a non-empty `cwd`. */
export function parseProposalBlock(raw: string): ProposalBlock | null {
  try { const r = ProposalBlockSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
}

/** A streamed answer as it may be shown: no block, and no fence still being typed at the end (`` ` `` … ```` ```ledge-se ````). */
export function hideProposal(text: string): string {
  const shown = text.replace(BLOCK, '');
  const lineStart = shown.lastIndexOf('\n') + 1;
  const tail = shown.slice(lineStart);
  // Trailing space is kept unless a block was taken out: deltas often end mid-sentence ("Deux ").
  return tail && FENCE.startsWith(tail) ? shown.slice(0, lineStart).trimEnd() : text === shown ? text : shown.trimEnd();
}
