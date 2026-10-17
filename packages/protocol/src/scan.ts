import { z } from 'zod';

/** Lot 11: a machine lists its Git repositories, for Ledge's project proposals. `machineId`: routing by the fleet, removed before the daemon. */
export const ReposScanSchema = z.object({ type: z.literal('repos.scan'), requestId: z.string().min(1).max(100), machineId: z.string().optional() });
/** `branch` null when HEAD names no branch; `remote` the origin normalised by `repositoryId` (no credentials, no query), absent without one. */
export const FoundRepoSchema = z.object({ path: z.string(), branch: z.string().nullable(), remote: z.string().optional() });
/** `truncated`: the walk stopped at a bound (folders, time, repositories), so the list is partial.
 *  `error`: set by the fleet when the machine could not answer ('offline', 'outdated'). */
export const ReposFoundSchema = z.object({ type: z.literal('repos.found'), requestId: z.string(), repos: z.array(FoundRepoSchema).max(500), truncated: z.boolean(), error: z.string().optional() });
export type ReposScan = z.infer<typeof ReposScanSchema>;
export type FoundRepo = z.infer<typeof FoundRepoSchema>;
export type ReposFound = z.infer<typeof ReposFoundSchema>;
