import { z } from 'zod';
import {
  GoalSchema, OpenRigStateSchema, RigRoleSchema, RigRoutingEntrySchema, RigSchema, RigSeatPermissionSchema, type OpenRigAction
} from './openrig.js';
import { RigRowSchema } from './rigMessages.js';

/**
 * Rigs and the kernel on the phone (refonte mobile B4, `daemon.rigs`): what the Desktop's Rigs view, Rig tab and kernel read and do on this
 * PC's OpenRig (lots 7a-7d), passed through the phone gateway, with the PC's paths left out. Contract: docs/mobile-openrig-contract.md.
 */

/** Why a read could not be answered, as a code (never the PC's words): `unknown_rig`, `not_installed` (no `rig` on the PC), `daemon_stopped`
 *  (OpenRig's daemon does not run), `unavailable` (anything else: OpenRig did not answer, the read failed or timed out). */
export const PhoneRigErrorSchema = z.enum(['unknown_rig', 'not_installed', 'daemon_stopped', 'unavailable']);
export type PhoneRigError = z.infer<typeof PhoneRigErrorSchema>;
/** A daemon's own error string as a phone code. */
export const phoneRigError = (e: string | undefined): PhoneRigError =>
  e === 'unknown_rig' || e === 'not_installed' || e === 'daemon_stopped' ? e : 'unavailable';

/** The longest OpenRig sentence a phone gets (a failed action's last line, a seat's permission summary). */
export const PHONE_RIG_TEXT_MAX = 500;
export const PHONE_RIGS_MAX = 50;
export const PHONE_RIG_SEATS_MAX = 200;
export const PHONE_RIG_ROWS_MAX = 100;
export const PHONE_RIG_SUMMARY_MAX = 200;
export const PHONE_GOALS_MAX = 50;

/** A rig as the phone gets it: no spec file path. */
export const PhoneRigSchema = RigSchema.omit({ specPath: true }).extend({ nodes: RigSchema.shape.nodes.max(PHONE_RIG_SEATS_MAX) });
/** OpenRig on this PC as the phone gets it: the daemon's state, port and start, never its message (it may hold a path). */
export const PhoneOpenRigStateSchema = OpenRigStateSchema.extend({
  daemon: OpenRigStateSchema.shape.daemon.omit({ message: true, pid: true }),
  rigs: z.array(PhoneRigSchema).max(PHONE_RIGS_MAX)
});
export type PhoneOpenRigState = z.infer<typeof PhoneOpenRigStateSchema>;

/** A queue row as the phone gets it: the PC's, its summary shortened. */
export const PhoneRigQueueRowSchema = RigRowSchema.extend({ summary: z.string().max(PHONE_RIG_SUMMARY_MAX).optional() });
export const PhoneRigRoutingSchema = RigRoutingEntrySchema.extend({ summary: z.string().max(PHONE_RIG_SUMMARY_MAX).optional() });
export const PhoneRigPermissionSchema = RigSeatPermissionSchema.extend({ summary: z.string().max(PHONE_RIG_TEXT_MAX).optional(), error: z.string().max(PHONE_RIG_TEXT_MAX).optional() });
/** A goal given to the operator as the phone gets it (`openrig.goals`), whole: its proposal, its question and its trail. */
export const PhoneGoalSchema = GoalSchema;

/** Seat counts per role (`pod.member` -> 0..9), as `openrig.seats` takes them. */
export const RigSeatCountsSchema = z.record(RigRoleSchema, z.number().int().min(0).max(9));

/**
 * Whether an action needs the device's passkey on the phone: what stops something (a rig, the kernel, the daemon, a restart, which stops
 * first, a deletion, a seat moved to the other harness) and what lets agents run without asking (`full_bypass`, `yolo`, or the spec's policy, which may be `yolo`). Starts, snapshots and other permissions do not.
 */
export function rigActNeedsCheck(a: OpenRigAction): boolean {
  switch (a.kind) {
    case 'daemon.stop': case 'daemon.restart': case 'kernel.stop': case 'kernel.restart': case 'rig.stop': case 'rig.restart': return true;
    // A move to the other harness stops the seat now (a successor takes its context).
    case 'seat.set': return a.permissions === 'full_bypass' || (a.runtime !== undefined && !a.dryRun);
    case 'rig.permissions': return a.mode === 'full_bypass';
    // `spec` puts back what the rig's spec gives each seat, which may be `yolo`: the phone cannot know, so it always asks.
    case 'rig.policy': return a.policy === 'yolo' || a.policy === 'spec';
    default: return false;
  }
}

/** Why an action, a change of seats or a goal was refused before it ran: the passkey's, or no OpenRig on the gateway. */
export const PhoneRigRejectedSchema = z.enum(['confirm_required', 'assertion_invalid', 'assertion_expired', 'unavailable']);
