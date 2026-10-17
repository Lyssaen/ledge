import { z } from 'zod';

/** The launch form asks a machine about the folders it is about to use: do they exist, and on which Git branch. */
export const ReposInspectSchema = z.object({
  type: z.literal('repos.inspect'), requestId: z.string().min(1).max(100),
  paths: z.array(z.string().min(1)).min(1).max(50), machineId: z.string().optional()
});
/** `branch` is null when the folder is not a Git repository. */
export const RepoInfoSchema = z.object({ path: z.string(), exists: z.boolean(), branch: z.string().nullable() });
export const ReposInfoSchema = z.object({ type: z.literal('repos.info'), requestId: z.string(), repos: z.array(RepoInfoSchema) });
export type ReposInspect = z.infer<typeof ReposInspectSchema>;
export type RepoInfo = z.infer<typeof RepoInfoSchema>;
export type ReposInfo = z.infer<typeof ReposInfoSchema>;
