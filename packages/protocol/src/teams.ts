import { z } from 'zod';
import { AutonomySchema, ToolSchema } from './session.js';
import { ModelIdSchema, EffortSchema } from './models.js';

/** A role id: the name of its file, `@<id>` inside a team. */
export const RoleIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
export const ROLE_LABEL_MAX = 40;
export const ROLE_PROMPT_MAX = 8000;

/** A role (`.ledge/roles/<id>.md`): a label, a prompt, and the launch defaults it asks for. The repository's wins over the home's:
 *  `shadows` is then the path of the home role of the same id it hides (absent otherwise, and from older daemons). */
export const RoleSchema = z.object({
  id: RoleIdSchema, label: z.string().min(1).max(ROLE_LABEL_MAX), prompt: z.string().max(ROLE_PROMPT_MAX),
  tool: ToolSchema.optional(), model: ModelIdSchema.optional(), effort: EffortSchema.optional(), autonomy: AutonomySchema.optional(),
  source: z.enum(['repo', 'home']), path: z.string(), shadows: z.string().optional()
});
export type Role = z.infer<typeof RoleSchema>;

/** A file that could not be read as a role or a team, and why: skipped, never fatal. */
export const DefinitionProblemSchema = z.object({ path: z.string(), reason: z.string() });
export type DefinitionProblem = z.infer<typeof DefinitionProblemSchema>;

export const TEAM_SEATS_MAX = 8;
/** One seat of a team: a role, and what it may change of the role's defaults; `name` is the bot name it would like. */
export const SeatSchema = z.object({
  role: RoleIdSchema, tool: ToolSchema.optional(), model: ModelIdSchema.optional(), effort: EffortSchema.optional(), name: z.string().min(1).max(40).optional()
});
export type Seat = z.infer<typeof SeatSchema>;

/** A role is unique in a team: `@role` must name one seat. */
const uniqueRoles = (seats: readonly { role: string }[]) => new Set(seats.map(s => s.role)).size === seats.length;
export const SeatsSchema = z.array(SeatSchema).min(1).max(TEAM_SEATS_MAX).refine(uniqueRoles, 'a role twice in one team');

export const TeamNameSchema = z.string().trim().min(1).max(60);
/** A team template (`.ledge/teams/<id>.yaml`). */
export const TeamTemplateSchema = z.object({ id: z.string().min(1).max(64), name: TeamNameSchema, seats: SeatsSchema, source: z.enum(['repo', 'home']), path: z.string() });
export type TeamTemplate = z.infer<typeof TeamTemplateSchema>;

export const TeamIdSchema = z.string().regex(/^team-[0-9a-f]{4,8}$/);
export const TeamStateSchema = z.enum(['active', 'resting', 'dissolved']);
export type TeamState = z.infer<typeof TeamStateSchema>;

/** A live team (spec §3.3): bound to one project and one folder, its seats and the session each one holds (null: free,
 *  or never started). It outlives its sessions (resting) until it is dissolved. */
export const TeamSchema = z.object({
  id: TeamIdSchema, name: TeamNameSchema, template: z.string().optional(), project: z.string().nullable(), machine: z.string(), cwd: z.string(),
  state: TeamStateSchema,
  seats: z.array(z.object({ role: RoleIdSchema, sessionId: z.string().nullable() })).max(TEAM_SEATS_MAX * 2),
  createdAt: z.string(), updatedAt: z.string(), restingAt: z.string().optional(), dissolvedAt: z.string().optional()
});
export type Team = z.infer<typeof TeamSchema>;

/** The client's requests about roles and teams. `machineId` is the fleet's routing, removed before the daemon. */
export const RolesListSchema = z.object({ type: z.literal('roles.list'), cwd: z.string().min(1).optional(), requestId: z.string().max(100).optional(), machineId: z.string().optional() });
export const RolesListingSchema = z.object({ type: z.literal('roles.listing'), requestId: z.string().optional(), roles: z.array(RoleSchema), templates: z.array(TeamTemplateSchema).default([]), problems: z.array(DefinitionProblemSchema) });

/** `team.launch`: a template by id, or ad hoc seats (the chat card's); with `qid`, the chat's team card of that turn. */
export const TeamLaunchSchema = z.object({
  type: z.literal('team.launch'), rid: z.string().min(1).max(100), cwd: z.string().min(1).optional(), template: z.string().min(1).max(64).optional(),
  seats: SeatsSchema.optional(), name: TeamNameSchema.optional(), qid: z.string().min(1).optional(), machineId: z.string().optional()
});
export const TeamJoinSchema = z.object({ type: z.literal('team.join'), team: TeamIdSchema, session: z.string().min(1), role: RoleIdSchema });
export const TeamLeaveSchema = z.object({ type: z.literal('team.leave'), team: TeamIdSchema, session: z.string().min(1) });
export const TeamResumeSchema = z.object({ type: z.literal('team.resume'), team: TeamIdSchema });
export const TeamDissolveSchema = z.object({ type: z.literal('team.dissolve'), team: TeamIdSchema });
/** The chat's « Enregistrer »: an ad hoc team written as `~/.ledge/teams/<name>.yaml`. */
export const TeamSaveSchema = z.object({ type: z.literal('team.save'), rid: z.string().min(1).max(100), name: TeamNameSchema, seats: SeatsSchema, qid: z.string().min(1).optional() });

export const TeamsMessageSchema = z.object({ type: z.literal('teams'), teams: z.array(TeamSchema) });
export const TeamUpdatedSchema = z.object({ type: z.literal('team.updated'), team: TeamSchema });
export const TeamLaunchedSchema = z.object({ type: z.literal('team.launched'), rid: z.string(), team: TeamSchema });
/** A launch refused, or stopped part way: the seats already started stay (`team`), the user sees them and may close them. */
export const TeamFailedSchema = z.object({ type: z.literal('team.failed'), rid: z.string(), reason: z.string(), team: TeamSchema.optional() });
export const TeamSavedSchema = z.object({ type: z.literal('team.saved'), rid: z.string(), path: z.string().optional(), reason: z.string().optional() });

/** A team's live seats, as `@role` would name them. */
export const isTeamLive = (t: Pick<Team, 'state'>): boolean => t.state !== 'dissolved';
