import { z } from 'zod';

// Wire shapes of OpenRig 0.6.x responses (facts D1, D4, D11). Passthrough, minimal required fields: a new OpenRig field never breaks a parse.
export const HealthSchema = z.object({ status: z.string().optional(), semver: z.string().optional(), pid: z.number().optional() }).passthrough();
export const PsEntrySchema = z.object({ rigId: z.string(), rigName: z.string().optional(), status: z.string().optional() }).passthrough();
export const NodeEntrySchema = z.object({ logicalId: z.string(), canonicalSessionName: z.string().nullish(), sessionStatus: z.string().nullish(), activityState: z.object({ activity: z.string() }).passthrough().nullish() }).passthrough();
export const KernelStatusSchema = z.object({ state: z.string().optional(), kernel_state: z.string().optional() }).passthrough();
export const QueueRowSchema = z.object({ qitemId: z.string(), sourceSession: z.string().optional(), destinationSession: z.string(), state: z.string() }).passthrough();
export const OutboxRowSchema = z.object({ outboxId: z.string(), senderSession: z.string().optional(), destinationSession: z.string().optional(), deliveryState: z.string().optional() }).passthrough();

export type Health = z.infer<typeof HealthSchema>;
export type PsEntry = z.infer<typeof PsEntrySchema>;
export type NodeEntry = z.infer<typeof NodeEntrySchema>;
export type KernelStatus = z.infer<typeof KernelStatusSchema>;
export type QueueRow = z.infer<typeof QueueRowSchema>;
export type OutboxRow = z.infer<typeof OutboxRowSchema>;
