import { z } from 'zod';

/** A session's context as its agent last reported it (context handover spec §3.1): tokens used of its window. */
export const ContextSchema = z.object({ used: z.number().int().min(0), window: z.number().int().positive(), at: z.string().datetime() });
export type Context = z.infer<typeof ContextSchema>;

/** Past this share of its window a session is « near its limit » (§3.2). */
export const CONTEXT_NEAR = 0.8;
/** How much of its window a session uses, 0 to 1; undefined when not measured. */
export const contextShare = (c: Context | undefined): number | undefined => (c ? Math.min(1, c.used / c.window) : undefined);
export const contextNear = (c: Context | undefined): boolean => (contextShare(c) ?? 0) >= CONTEXT_NEAR;

/** The relief of a session (§3.3), as the one relieved carries it. */
export const HandoverStateSchema = z.enum(['briefing', 'launching', 'done', 'failed']);
export type HandoverState = z.infer<typeof HandoverStateSchema>;
export const HandoverSchema = z.object({
  state: HandoverStateSchema, at: z.string().datetime(),
  /** The relief, once launched. */
  to: z.string().optional(), toName: z.string().optional(),
  reason: z.string().optional(),
  /** Started by Ledge itself (a seat working without asking), not by the user. */
  auto: z.literal(true).optional()
});
export type Handover = z.infer<typeof HandoverSchema>;
/** The session a relief took over from. */
export const RelievesSchema = z.object({ id: z.string(), name: z.string(), at: z.string().datetime() });
export type Relieves = z.infer<typeof RelievesSchema>;

/** The longest brief a session may write. */
export const BRIEF_MAX = 20_000;

export const SessionHandoverSchema = z.object({ type: z.literal('session.handover'), rid: z.string().min(1).max(100), id: z.string().min(1) });
export const HandoverBriefSchema = z.object({ type: z.literal('handover.brief'), rid: z.string().min(1).max(100), by: z.string().min(1), text: z.string().min(1).max(BRIEF_MAX) });
export const HandoverShowSchema = z.object({ type: z.literal('handover.show'), rid: z.string().min(1).max(100), by: z.string().min(1) });
export const SessionHandoverResultSchema = z.object({ type: z.literal('session.handover.result'), rid: z.string(), ok: z.boolean(), reason: z.string().optional() });
export const HandoverResultSchema = z.object({ type: z.literal('handover.result'), rid: z.string(), text: z.string().optional(), reason: z.string().optional() });
