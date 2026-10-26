import { z } from 'zod';

/** A session's context as its agent last reported it (context handover spec §3.1): tokens used of its window. */
export const ContextSchema = z.object({ used: z.number().int().min(0), window: z.number().int().positive(), at: z.string().datetime() });
export type Context = z.infer<typeof ContextSchema>;

/** Past this share of its window a session is « near its limit » (§3.2), unless the user set another threshold. */
export const CONTEXT_NEAR = 0.8;
/** The threshold the user may choose (Settings › General « Contexte max »), in steps of 5 %. */
export const CONTEXT_NEAR_MIN = 0.5;
export const CONTEXT_NEAR_MAX = 0.95;
export const ContextPrefsSchema = z.object({ near: z.number().min(CONTEXT_NEAR_MIN).max(CONTEXT_NEAR_MAX) });
export type ContextPrefs = z.infer<typeof ContextPrefsSchema>;
/** How much of its window a session uses, 0 to 1; undefined when not measured. */
export const contextShare = (c: Context | undefined): number | undefined => (c ? Math.min(1, c.used / c.window) : undefined);
export const contextNear = (c: Context | undefined, near: number = CONTEXT_NEAR): boolean => (contextShare(c) ?? 0) >= near;

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

/** The threshold the daemon keeps (`context.set`), told after every snapshot and on each change (`context.prefs`). */
export const ContextSetSchema = z.object({ type: z.literal('context.set'), prefs: ContextPrefsSchema });
export const ContextPrefsMessageSchema = z.object({ type: z.literal('context.prefs'), prefs: ContextPrefsSchema });
export const SessionHandoverSchema = z.object({ type: z.literal('session.handover'), rid: z.string().min(1).max(100), id: z.string().min(1) });
export const HandoverBriefSchema = z.object({ type: z.literal('handover.brief'), rid: z.string().min(1).max(100), by: z.string().min(1), text: z.string().min(1).max(BRIEF_MAX) });
export const HandoverShowSchema = z.object({ type: z.literal('handover.show'), rid: z.string().min(1).max(100), by: z.string().min(1) });
export const SessionHandoverResultSchema = z.object({ type: z.literal('session.handover.result'), rid: z.string(), ok: z.boolean(), reason: z.string().optional() });
export const HandoverResultSchema = z.object({ type: z.literal('handover.result'), rid: z.string(), text: z.string().optional(), reason: z.string().optional() });
