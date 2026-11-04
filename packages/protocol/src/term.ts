import { z } from 'zod';

/**
 * The desktop's agent screen (spec 2026-11-04): one tmux control client on the session's machine, xterm.js the only
 * emulator. Bytes travel as base64 so a sequence split across frames stays intact. Shells stay on the local
 * pseudo-terminal; this stream is the harness pane only.
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

/** Starts the stream. `readOnly`: a subagent's view of its parent, which never resizes the pane and never types. */
export const TermWatchSchema = z.object({
  type: z.literal('term.watch'), id, cols, rows,
  readOnly: z.literal(true).optional()
});
export const TermUnwatchSchema = z.object({ type: z.literal('term.unwatch'), id });
export const TermInputSchema = z.object({ type: z.literal('term.input'), id, data: z.string().min(1).max(PANE_INPUT_MAX) });
export const TermResizeSchema = z.object({ type: z.literal('term.resize'), id, cols, rows });

/** `ended`: the session is gone. `gone`: its tmux went. `failed`: the stream could not start. */
export const PaneExitWhySchema = z.enum(['ended', 'gone', 'failed']);
export type PaneExitWhy = z.infer<typeof PaneExitWhySchema>;

export const TermOpenedSchema = z.object({
  type: z.literal('term.opened'), id, cols, rows,
  screen: z.string().max(TERM_PANE_SCREEN_MAX),
  cursor: z.object({ x: z.number().int().nonnegative().max(1000), y: z.number().int().nonnegative().max(1000) })
});
export const TermOutputSchema = z.object({ type: z.literal('term.output'), id, data: z.string().min(1).max(TERM_CHUNK_B64) });
export const TermSizeSchema = z.object({ type: z.literal('term.size'), id, cols, rows });
export const TermExitSchema = z.object({ type: z.literal('term.exit'), id, why: PaneExitWhySchema });
