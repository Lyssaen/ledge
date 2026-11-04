import { z } from 'zod';

/**
 * The desktop's terminal (spec 2026-11-04): one tmux control client on the session's machine, xterm.js the only
 * emulator. Bytes travel as base64 so a sequence split across frames stays intact. The harness pane is `term.watch`.
 * A shell born beside the daemon is `term.shell` and every later message of it carries `shell`.
 */

/** Raw bytes in one `term.output`, before base64. A UTF-8 character is never split. */
export const TERM_CHUNK = 16_384;
/** Base64 of `TERM_CHUNK` bytes, with a little room. */
export const TERM_CHUNK_B64 = 22_000;
/** The first screen, as `capture-pane` prints it. */
export const TERM_PANE_SCREEN_MAX = 65_536;
/** What one `term.input` carries: xterm's string, a paste cut into several. */
export const PANE_INPUT_MAX = 4_096;

const id = z.string().min(1).max(200);
const cols = z.number().int().min(2).max(500);
const rows = z.number().int().min(2).max(200);
/** Which shell of the session. Absent: the harness pane. Safe on a command line, and short enough for a tab key. */
const shell = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

/** Starts the stream. `readOnly`: a subagent's view of its parent, which never resizes the pane and never types. */
export const TermWatchSchema = z.object({
  type: z.literal('term.watch'), id, cols, rows,
  readOnly: z.literal(true).optional()
});
/** A login shell in its own short tmux session, drawn by the same stream. */
export const TermShellSchema = z.object({ type: z.literal('term.shell'), id, shell, cols, rows });
export const TermUnwatchSchema = z.object({ type: z.literal('term.unwatch'), id, shell: shell.optional() });
export const TermInputSchema = z.object({ type: z.literal('term.input'), id, shell: shell.optional(), data: z.string().min(1).max(PANE_INPUT_MAX) });
export const TermResizeSchema = z.object({ type: z.literal('term.resize'), id, shell: shell.optional(), cols, rows });

/** `ended`: the session is gone. `gone`: its tmux went. `failed`: the stream could not start. */
export const PaneExitWhySchema = z.enum(['ended', 'gone', 'failed']);
export type PaneExitWhy = z.infer<typeof PaneExitWhySchema>;

export const TermOpenedSchema = z.object({
  type: z.literal('term.opened'), id, shell: shell.optional(), cols, rows,
  screen: z.string().max(TERM_PANE_SCREEN_MAX),
  cursor: z.object({ x: z.number().int().nonnegative().max(1000), y: z.number().int().nonnegative().max(1000) })
});
export const TermOutputSchema = z.object({ type: z.literal('term.output'), id, shell: shell.optional(), data: z.string().min(1).max(TERM_CHUNK_B64) });
export const TermSizeSchema = z.object({ type: z.literal('term.size'), id, shell: shell.optional(), cols, rows });
export const TermExitSchema = z.object({ type: z.literal('term.exit'), id, shell: shell.optional(), why: PaneExitWhySchema });
