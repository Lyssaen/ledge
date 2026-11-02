import { z } from 'zod';
import { ToolSchema } from './session.js';

/** Where a slash command comes from: the agent itself, the project's or the user's folder, a plugin, an OMP extension. */
export const SlashSourceSchema = z.enum(['builtin', 'project', 'user', 'plugin', 'extension']);
export type SlashSource = z.infer<typeof SlashSourceSchema>;

/** At most this many commands in a listing, and these lengths: a listing travels to the phone too. */
export const SLASH_COMMANDS_MAX = 400;
export const SLASH_DESCRIPTION_MAX = 300;

/**
 * A slash command an agent offers in a session, as `/name`. `blocked`: Ledge does not send it at all (`panel`: it opens a
 * terminal panel whatever follows it; `close`: it ends the session, which « Fermer » does). `bare`: sent without
 * arguments it opens a terminal panel, so it is sent only with some.
 */
export const SlashCommandSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(SLASH_DESCRIPTION_MAX).optional(),
  argumentHint: z.string().max(200).optional(),
  aliases: z.array(z.string().min(1).max(200)).max(10).optional(),
  source: SlashSourceSchema,
  blocked: z.enum(['panel', 'close']).optional(),
  bare: z.literal('panel').optional()
});
export type SlashCommand = z.infer<typeof SlashCommandSchema>;

/** A front asks the session's machine which slash commands its agent offers there. */
export const SessionCommandsSchema = z.object({ type: z.literal('session.commands'), requestId: z.string().min(1).max(100), id: z.string() });
/** `error` when the agent could not be asked (`unsupported` for an agent Ledge does not list yet, `offline`, `outdated`,
 *  the probe's own failure): `commands` is then empty, and a command typed by hand still goes. */
export const SessionCommandsListingSchema = z.object({
  type: z.literal('session.commands.listing'), requestId: z.string(), id: z.string(), tool: ToolSchema.optional(),
  commands: z.array(SlashCommandSchema).max(SLASH_COMMANDS_MAX), error: z.string().max(200).optional()
});
export type SessionCommands = z.infer<typeof SessionCommandsSchema>;
export type SessionCommandsListing = z.infer<typeof SessionCommandsListingSchema>;
