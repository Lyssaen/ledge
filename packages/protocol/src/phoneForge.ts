import { z } from 'zod';
import { FollowedSessionSchema, ForgeStatusSchema, PrDetailSchema, PullRequestSchema, dropUnknownForges, dropUnknownPrs } from './forge.js';

/**
 * Pull and merge requests on the phone (refonte mobile B5, `daemon.forge`): what the Desktop's MR/PR view reads and does (lots 8a and 8b),
 * passed through the phone gateway. Nothing but the forge's own data: no PC path, no CLI message. Contract: docs/mobile-forge-contract.md.
 */

/** The bounds of the list: a phone message must fit the sealed frame (about 1 MiB once padded). */
export const PHONE_FORGE_PRS_MAX = 100;
export const PHONE_FORGE_FOLLOWED_MAX = 200;
/** What a detail may weigh as JSON before the gateway cuts it: patches go first, then the oldest discussions, then the oldest commits. */
export const PHONE_FORGE_BYTES = 800_000;
/** The longest description or comment a phone gets; longer ones end with « … » and the detail says `cut`. */
export const PHONE_FORGE_TEXT_MAX = 8000;
/** The most of a job's log a phone gets: its last characters, after « … » (the daemon already keeps its last 60 lines). */
export const PHONE_FORGE_LOG_MAX = 64_000;
/** The longest CLI line a phone gets with a failed action (redacted by the daemon, then shortened). */
export const PHONE_FORGE_MESSAGE_MAX = 500;

/** A forge's status as the phone gets it: its state and times, never the CLI's message (it may hold a path or a host's own words). */
export const PhoneForgeStatusSchema = ForgeStatusSchema.omit({ message: true });
export type PhoneForgeStatus = z.infer<typeof PhoneForgeStatusSchema>;

/**
 * Why a read could not be answered: `unavailable` (not a request this PC follows, or no forge on this PC), `failed` (gh or glab failed),
 * `too_large` (even cut down, the detail would not fit a phone's frame).
 */
export const PhoneForgeErrorSchema = z.enum(['unavailable', 'failed', 'too_large']);
export type PhoneForgeError = z.infer<typeof PhoneForgeErrorSchema>;

/**
 * Why an action did not run, as the Desktop's codes: `stale` (a merge of a head that has moved), `busy` (a rerun while the pipeline runs),
 * `not_offered` (a merge the forge would refuse now: the detail's `mergeBlockers` say why), `unavailable` (not followed, or no forge), `failed`.
 */
export const PhoneForgeActErrorSchema = z.enum(['stale', 'busy', 'not_offered', 'unavailable', 'failed']);
export type PhoneForgeActError = z.infer<typeof PhoneForgeActErrorSchema>;
/** Why the action was not even tried: the device check, or no forge on this PC. */
export const PhoneForgeRejectedSchema = z.enum(['confirm_required', 'assertion_invalid', 'assertion_expired', 'unavailable']);
export type PhoneForgeRejected = z.infer<typeof PhoneForgeRejectedSchema>;

export const PhoneForgeStateSchema = z.object({
  /** Newest change first. A request whose forge, state or pipeline an older phone does not know is dropped, not the message. */
  prs: z.preprocess(dropUnknownPrs, z.array(PullRequestSchema).max(PHONE_FORGE_PRS_MAX)),
  forges: z.preprocess(dropUnknownForges, z.array(PhoneForgeStatusSchema).max(20)),
  followed: z.preprocess(dropUnknownForges, z.array(FollowedSessionSchema).max(PHONE_FORGE_FOLLOWED_MAX))
});
export type PhoneForgeState = z.infer<typeof PhoneForgeStateSchema>;

export { PrDetailSchema as PhonePrDetailSchema };
