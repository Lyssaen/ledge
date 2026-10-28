import { z } from 'zod';
import { AutonomySchema, ToolSchema } from './session.js';
import { EffortSchema, ModelIdSchema } from './models.js';
import { DefinitionHashSchema, DefinitionScopeSchema, ROLE_PROMPT_MAX, RoleIdSchema, SeatsSchema, TeamNameSchema, TemplateIdSchema } from './teams.js';
import type { PhoneClientMessage } from './phone.js';

/** What the phone sees of the role and team definitions: names and ids only, never a path (every object is strict). */
const scope = DefinitionScopeSchema;
/** A project's name, as the phone knows it; `null` for a home definition. */
const projectName = z.string().max(80).nullable();

/** `cut`: the prompt was shortened to fit the frame, the editor asks `teams.role` for the whole. `shadows`: it hides a home role of the same id; `shadowed`: a repository role hides it. */
export const PhoneRoleSchema = z.object({
  id: RoleIdSchema, label: z.string().min(1).max(40), prompt: z.string().max(ROLE_PROMPT_MAX), cut: z.literal(true).optional(),
  tool: ToolSchema.optional(), model: ModelIdSchema.optional(), effort: EffortSchema.optional(), autonomy: AutonomySchema.optional(),
  scope, project: projectName, hash: DefinitionHashSchema, shadows: z.literal(true).optional(), shadowed: z.literal(true).optional()
}).strict();
export type PhoneRole = z.infer<typeof PhoneRoleSchema>;

export const PhoneTemplateSchema = z.object({ id: TemplateIdSchema, name: TeamNameSchema, seats: SeatsSchema, scope, project: projectName, hash: DefinitionHashSchema }).strict();
export type PhoneTemplate = z.infer<typeof PhoneTemplateSchema>;

/** A file that could not be read: its name (never a path), where it lives, and why. */
export const PhoneProblemSchema = z.object({ file: z.string().max(80), scope, project: projectName, reason: z.string().max(200) }).strict();
export type PhoneProblem = z.infer<typeof PhoneProblemSchema>;

export const PhoneCatalogSchema = z.object({
  /** The names of the projects with a local repository: the ones a « Dépôt » scope or a « Lever » can name. */
  projects: z.array(z.string().max(80)).max(50),
  roles: z.array(PhoneRoleSchema).max(200), templates: z.array(PhoneTemplateSchema).max(100), problems: z.array(PhoneProblemSchema).max(50)
}).strict();
export type PhoneCatalog = z.infer<typeof PhoneCatalogSchema>;

export const TEAMS_OPERATION_TYPES = ['role.write', 'role.delete', 'template.write', 'template.delete', 'team.launch', 'team.compose', 'team.seat', 'team.dissolve'] as const;
/** The phone's writes and live-team changes: what a passkey assertion over `teamsDigest` covers. */
export type TeamsOperation = Extract<PhoneClientMessage, { type: (typeof TEAMS_OPERATION_TYPES)[number] }>;
export const isTeamsOperation = (m: { type: string }): m is TeamsOperation => (TEAMS_OPERATION_TYPES as readonly string[]).includes(m.type);

/** `define`: role and template files; `team`: live teams. */
export const teamsPurpose = (type: TeamsOperation['type']): 'define' | 'team' => type.startsWith('team.') ? 'team' : 'define';

/** JSON with the keys of every object sorted, and `undefined` fields dropped: the same content always gives the same text. */
export function canonicalJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x !== null && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => [k, sort(o[k])]));
    }
    return x;
  };
  return JSON.stringify(sort(v));
}

/** The lowercase sha256 of an operation without its `op` and `assertion`, which the challenge's subject carries. It runs in a browser and in Node. */
export async function teamsDigest(m: TeamsOperation): Promise<string> {
  const { op: _op, assertion: _assertion, ...rest } = m;
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(rest))));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
