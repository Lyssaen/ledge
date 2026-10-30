import { z } from 'zod';

// Wire shapes of OpenRig 0.6.x responses (facts D1, D4, D11). Passthrough, minimal required fields: a new OpenRig field never breaks a parse.
export const HealthSchema = z.object({ status: z.string().optional(), semver: z.string().optional(), pid: z.number().optional() }).passthrough();
export const PsEntrySchema = z.object({ rigId: z.string(), rigName: z.string().optional(), status: z.string().optional() }).passthrough();
export const NodeEntrySchema = z.object({ logicalId: z.string(), canonicalSessionName: z.string().nullish(), sessionStatus: z.string().nullish(), activityState: z.object({ activity: z.string() }).passthrough().nullish() }).passthrough();
export const KernelStatusSchema = z.object({ state: z.string().optional(), kernel_state: z.string().optional() }).passthrough();
export const QueueRowSchema = z.object({ qitemId: z.string(), sourceSession: z.string().optional(), destinationSession: z.string(), state: z.string() }).passthrough();
export const OutboxRowSchema = z.object({ outboxId: z.string(), senderSession: z.string().optional(), destinationSession: z.string().optional(), deliveryState: z.string().optional() }).passthrough();
export const SpecEntrySchema = z.object({ id: z.string(), name: z.string(), sourceType: z.string().optional(), sourcePath: z.string().optional(), summary: z.string().optional() }).passthrough();
export const SpecDetailSchema = z.object({ entry: SpecEntrySchema, yaml: z.string() }).passthrough();

/** OpenRig time (SQLite "YYYY-MM-DD HH:MM:SS", UTC, or ISO) to an ISO datetime; null when absent or unparsable. */
export function openrigTime(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(v) ? `${v.replace(' ', 'T')}Z` : v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export type Health = z.infer<typeof HealthSchema>;
export type PsEntry = z.infer<typeof PsEntrySchema>;
export type NodeEntry = z.infer<typeof NodeEntrySchema>;
export type KernelStatus = z.infer<typeof KernelStatusSchema>;
export type QueueRow = z.infer<typeof QueueRowSchema>;
export type OutboxRow = z.infer<typeof OutboxRowSchema>;
export type SpecEntry = z.infer<typeof SpecEntrySchema>;
