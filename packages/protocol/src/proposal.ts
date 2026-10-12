import { z } from 'zod';

/** What the chat harness writes in its ```ledge-session block (spec 2026-10-12 §3); the daemon resolves `cwd`. */
export const ProposalBlockSchema = z.object({ cwd: z.string().trim().min(1), prompt: z.string().optional() });
export type ProposalBlock = z.infer<typeof ProposalBlockSchema>;

/** What the chat harness writes in its ```ledge-relay block (spec 2026-10-12 relay §3); the daemon checks the session. */
export const RelayBlockSchema = z.object({ session: z.string().trim().min(1), text: z.string().trim().min(1) });
export type RelayBlock = z.infer<typeof RelayBlockSchema>;

const FENCES = ['```ledge-session', '```ledge-relay'];
/** A block from its fence to the closing fence, or to the end of the text when it is not closed (yet). */
const BLOCK = /```ledge-(session|relay)[ \t]*\n?([\s\S]*?)(?:```|$)/g;

/** The answer without its card blocks, and the language and content of the last one (null when there is none). */
export function extractProposal(answer: string): { text: string; kind: 'session' | 'relay' | null; raw: string | null } {
  const found: Array<{ kind: 'session' | 'relay'; raw: string }> = [];
  const text = answer.replace(BLOCK, (_m, kind: 'session' | 'relay', body: string) => { found.push({ kind, raw: body.trim() }); return ''; });
  const last = found.at(-1);
  return last ? { text: text.replace(/\n{3,}/g, '\n\n').trim(), kind: last.kind, raw: last.raw } : { text: answer, kind: null, raw: null };
}

/** The block's JSON as a proposal, or null when it is not an object with a non-empty `cwd`. */
export function parseProposalBlock(raw: string): ProposalBlock | null {
  try { const r = ProposalBlockSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
}

/** A streamed answer as it may be shown: no block, and no fence still being typed at the end (`` ` `` … ```` ```ledge-se ````, ```` ```ledge-re ````). */
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
