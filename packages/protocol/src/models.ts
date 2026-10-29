import { z } from 'zod';
import { ToolSchema } from './session.js';

/** A model id as an agent's `--model` takes it: an alias (`opus`), a full name, or Cursor's bracketed parameters
 *  (`claude-opus-4-8[effort=high]`). Never a leading `-`, which the agent would read as a flag. */
export const ModelIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@[\]=,+-]*$/, 'not a model id');
/** A reasoning effort as the agent names it (Claude Code `low`…`max`, Codex up to `ultra`). */
export const EffortSchema = z.string().min(1).max(20).regex(/^[a-z]+$/, 'not an effort');

/** A model an agent offers on a machine (#58). `efforts`: those the model takes, when the agent has a separate effort
 *  (Cursor bakes it in the id); `isDefault`: the one the agent picks when Ledge passes no `--model`. */
export const ModelChoiceSchema = z.object({
  id: ModelIdSchema, label: z.string(), description: z.string().optional(),
  efforts: z.array(EffortSchema).optional(), defaultEffort: EffortSchema.optional(), isDefault: z.boolean().optional()
});
export type ModelChoice = z.infer<typeof ModelChoiceSchema>;

/** The launch form asks a machine which models an agent offers there. */
export const ModelsListSchema = z.object({
  type: z.literal('models.list'), requestId: z.string().min(1).max(100), tool: ToolSchema, machineId: z.string().optional()
});
/** `error` when the agent could not be asked (not installed, not signed in, `offline`, `outdated`): `models` is then
 *  what Ledge knows without it, possibly empty. */
export const ModelsListingSchema = z.object({
  type: z.literal('models.listing'), requestId: z.string(), tool: ToolSchema, models: z.array(ModelChoiceSchema),
  error: z.string().optional()
});
export type ModelsList = z.infer<typeof ModelsListSchema>;
export type ModelsListing = z.infer<typeof ModelsListingSchema>;

/** Why a model change was refused (#58): travels as the `code` of an `error`, as the `reason` of a phone's failure and per seat of a team change. */
export const ModelRefusalSchema = z.enum(['not_launched', 'ended', 'no_conversation', 'not_running', 'effort_in_model', 'restart_failed', 'refused']);
export type ModelRefusal = z.infer<typeof ModelRefusalSchema>;
/** The daemon took a model change: `now` the agent restarts, `turn` it waits for the session's next free moment, `none` nothing changes. */
export const SessionModelAcceptedSchema = z.object({ type: z.literal('session.model.accepted'), id: z.string(), when: z.enum(['now', 'turn', 'none']) });
export type SessionModelAccepted = z.infer<typeof SessionModelAcceptedSchema>;
