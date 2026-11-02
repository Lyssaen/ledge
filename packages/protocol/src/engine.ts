import { z } from 'zod';

/** Which engine runs the teams: Ledge's own, or OpenRig. One global setting, `teams.engine`. */
export const TeamsEngineSchema = z.enum(['ledge', 'openrig']);
export type TeamsEngine = z.infer<typeof TeamsEngineSchema>;
export const DEFAULT_TEAMS_ENGINE: TeamsEngine = 'ledge';

/** Server: the engine in force, whether OpenRig is reachable, and whether any team is running. */
export const TeamsEngineStateSchema = z.object({ type: z.literal('teams.engine'), engine: TeamsEngineSchema, openrigAvailable: z.boolean(), running: z.boolean() });
/** Client: switch the engine. */
export const TeamsEngineSetSchema = z.object({ type: z.literal('teams.engine.set'), rid: z.string().min(1).max(100), engine: TeamsEngineSchema });
/** One other machine's answer to the set its local daemon passed on (one engine for every machine); `reason` when it refused. */
export const TeamsEnginePeerSchema = z.object({ machine: z.string(), ok: z.boolean(), reason: z.string().optional() });
export type TeamsEnginePeer = z.infer<typeof TeamsEnginePeerSchema>;
/** Server: the answer to `teams.engine.set`. `peers`: the machines it was passed on to (those whose daemon knows the engine), when any. */
export const TeamsEngineResultSchema = z.object({ type: z.literal('teams.engine.result'), rid: z.string(), ok: z.boolean(), reason: z.string().optional(), peers: z.array(TeamsEnginePeerSchema).optional() });
