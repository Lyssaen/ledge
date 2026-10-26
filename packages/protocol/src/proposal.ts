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
  repos: z.array(z.object({ path: z.string().min(1).max(4096), why: z.string().trim().min(1).max(200) })).min(1).max(50),
  addTo: z.string().trim().max(80).optional()
});
export type ProjectBlock = z.infer<typeof ProjectBlockSchema>;

/** What the chat harness writes in its ```ledge-close block: the session to close, as the store names it; the daemon checks it. */
export const CloseBlockSchema = z.object({ session: z.string().trim().min(1) });
export type CloseBlock = z.infer<typeof CloseBlockSchema>;

/** What the chat harness writes in its ```ledge-team block (roles spec §3.8): a folder and a template, or a name and ad hoc
 *  seats; the daemon checks the folder and the roles. */
export const TeamBlockSchema = z.object({
  cwd: z.string().trim().min(1), template: z.string().trim().min(1).max(64).optional(), name: z.string().trim().min(1).max(60).optional(),
  seats: z.array(z.object({ role: z.string().trim().min(1).max(40), tool: z.enum(['claude', 'codex', 'cursor', 'omp']).optional(), model: z.string().max(200).optional(), effort: z.string().max(20).optional(), name: z.string().max(40).optional() })).min(1).max(8).optional()
}).refine(b => !!b.template || !!b.seats?.length, 'a template or seats');
export type TeamBlock = z.infer<typeof TeamBlockSchema>;

/** What the chat harness writes in its ```ledge-task block (roles spec §3.8): a session id or `@role`, a title, a detail. */
export const TaskBlockSchema = z.object({
  to: z.string().trim().min(1).max(80), team: z.string().trim().max(40).optional(), title: z.string().trim().min(1).max(200), text: z.string().max(20000).optional()
});
export type TaskBlock = z.infer<typeof TaskBlockSchema>;

/** The fences the chat may write: `action` (action registry spec §3), and the six that came before it, still read. */
export type BlockKind = 'session' | 'relay' | 'project' | 'close' | 'team' | 'task' | 'action';
const FENCES = ['```ledge-session', '```ledge-relay', '```ledge-project', '```ledge-close', '```ledge-team', '```ledge-task', '```ledge-action'];
/** A block from its fence to the closing fence, or to the end of the text when it is not closed (yet). */
const BLOCK = /```ledge-(session|relay|project|close|team|task|action)[ \t]*\n?([\s\S]*?)(?:```|$)/g;

/** The answer without its card blocks; every block in order (#24: several sessions in one answer), and the language and content of
 *  the last one (null when there is none), which decides the turn's card. */
export function extractProposal(answer: string): { text: string; kind: BlockKind | null; raw: string | null; blocks: Array<{ kind: BlockKind; raw: string }> } {
  const found: Array<{ kind: BlockKind; raw: string }> = [];
  const text = answer.replace(BLOCK, (_m, kind: BlockKind, body: string) => { found.push({ kind, raw: body.trim() }); return ''; });
  const last = found.at(-1);
  return last ? { text: text.replace(/\n{3,}/g, '\n\n').trim(), kind: last.kind, raw: last.raw, blocks: found } : { text: answer, kind: null, raw: null, blocks: [] };
}

/** The block's JSON as a proposal, or null when it is not an object with a non-empty `cwd`. */
export function parseProposalBlock(raw: string): ProposalBlock | null {
  try { const r = ProposalBlockSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
}

/** A streamed answer as it may be shown: no block, and no fence still being typed at the end (`` ` `` … ```` ```ledge-se ````, ```` ```ledge-re ````, ```` ```ledge-pro ````, ```` ```ledge-cl ````). */
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

/** The block's JSON as a close, or null when it lacks a non-blank session. */
export function parseCloseBlock(raw: string): CloseBlock | null {
  try { const r = CloseBlockSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
}

/** The block's JSON as a team, or null when it has no folder, or neither a template nor seats. */
export function parseTeamBlock(raw: string): TeamBlock | null {
  try { const r = TeamBlockSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
}

/** The block's JSON as a task, or null when it lacks a target or a title. */
export function parseTaskBlock(raw: string): TaskBlock | null {
  try { const r = TaskBlockSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
}

/** The block's JSON as a project proposal, or null when it breaks the schema (a name, 1 to 50 repositories with a reason, the bounds). */
export function parseProjectBlock(raw: string): ProjectBlock | null {
  try { const r = ProjectBlockSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
}
