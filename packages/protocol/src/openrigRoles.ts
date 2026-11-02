import { z } from 'zod';

/**
 * OpenRig roles (agent specs) of a machine, read-only (docs/mockups/ledge-openrig-roles.html, contract
 * docs/superpowers/specs/2026-11-02-openrig-roles-data.md §4). Two lenses: « from the spec », which the machine's Ledge
 * daemon resolves from the YAML (imports, profiles, `uses`) and says so; « from a seat », what OpenRig resolved when it
 * launched that seat (its node detail), which Ledge only sorts into layers.
 */

/** Why a value cannot be known here. `resolved_at_launch`: a bare skill id OpenRig looks up only when a seat starts;
 *  `not_exposed`: OpenRig publishes no such thing; `unreadable`: a file (or an import) could not be read; `ambiguous`: two
 *  imports declare a bare id; `not_found`: a `uses` id that no declared resource has; `missing_from_guidance`: a block
 *  OpenRig planned for CLAUDE.md / AGENTS.md that is not there. */
export const RoleUnknownWhySchema = z.enum(['resolved_at_launch', 'not_exposed', 'unreadable', 'ambiguous', 'not_found', 'missing_from_guidance']);
export type RoleUnknownWhy = z.infer<typeof RoleUnknownWhySchema>;

/** Where a value comes from, beyond the role's own file. */
export const RoleFromSchema = z.enum(['import', 'defaults', 'profile', 'rig', 'pod', 'member', 'launch', 'openrig', 'plugin', 'seat']);
export type RoleFrom = z.infer<typeof RoleFromSchema>;

/** A value's provenance. `here`: written in the role's file (`key`, the YAML path); `inherited`: from elsewhere, `from` and
 *  `ref` naming it (`import` `shared`, `member` `dev.front`, `rig` `ledge-dev`…), `path` the file when there is one;
 *  `absent`: written nowhere; `unknown`: not knowable here, `why` says why. */
export const OriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('here'), key: z.string().optional() }),
  z.object({ kind: z.literal('inherited'), from: RoleFromSchema, ref: z.string().optional(), key: z.string().optional(), path: z.string().optional() }),
  z.object({ kind: z.literal('absent') }),
  z.object({ kind: z.literal('unknown'), why: RoleUnknownWhySchema, detail: z.string().optional() })
]);
export type Origin = z.infer<typeof OriginSchema>;

/** A scalar with its provenance; `value` null when it is absent or unknown. */
export const SourcedStringSchema = z.object({ value: z.string().nullable(), origin: OriginSchema });
export type SourcedString = z.infer<typeof SourcedStringSchema>;

export const RoleResourceCategorySchema = z.enum(['skill', 'guidance', 'plugin', 'subagent', 'runtime_resource']);
export type RoleResourceCategory = z.infer<typeof RoleResourceCategorySchema>;

/** A resource a role declares or selects. `id`: as it takes effect (`shared:openrig-core`); `path`: as written in its spec,
 *  `absolutePath`: that file or folder on the machine (readable with `openrig.roleFile` when it is a file); `target`: where
 *  OpenRig merges a runtime resource (`<cwd>/.claude/settings.local.json`, `$CODEX_HOME/config.toml`…), `<cwd>` replaced
 *  when seen from a seat; `plugin`: what a plugin carries (`rig plugin show`). */
export const RoleResourceSchema = z.object({
  category: RoleResourceCategorySchema, id: z.string(),
  path: z.string().optional(), absolutePath: z.string().optional(),
  runtime: z.string().optional(), type: z.string().optional(), target: z.string().optional(),
  plugin: z.object({ version: z.string().optional(), skills: z.array(z.string()), hooks: z.number().int().min(0) }).optional(),
  origin: OriginSchema
});
export type RoleResource = z.infer<typeof RoleResourceSchema>;

/** One `uses` list of a profile. `declared` false: the key is not written (« not declared »), unlike a written `[]`
 *  (`declared` true, no items: « empty »). */
export const RoleUsesListSchema = z.object({ declared: z.boolean(), key: z.string(), items: z.array(RoleResourceSchema) });
export type RoleUsesList = z.infer<typeof RoleUsesListSchema>;

/** Where a startup piece comes from: the role (`agent`, `profile`), the rig (`culture`, `rig`, `pod`, `member`), OpenRig
 *  itself (`openrig`: its default culture, start and onboarding files, the identity action) or files OpenRig generated for
 *  the seat (`seat`). */
export const StartupLayerSchema = z.enum(['agent', 'profile', 'culture', 'rig', 'pod', 'member', 'openrig', 'seat', 'unknown']);
export type StartupLayer = z.infer<typeof StartupLayerSchema>;

/** A startup file or action. `file`: as written; `absolutePath`: readable with `openrig.roleFile`; `size` in bytes when the
 *  file was there. `layerInferred`: the layer is Ledge's reading of where the file lives, OpenRig does not say it.
 *  `delivery`: `send_text` typed into the terminal, `guidance_merge` a managed block of `into` (that seat's CLAUDE.md,
 *  CLAUDE.local.md or AGENTS.md, shared by the seats of the folder), `skill_install`, `auto` as written. `delivered`
 *  (guidance_merge only, seen from a seat): whether the block is in `into` now — the plan is not proof of delivery.
 *  `value`: an action's text (the seat identity OpenRig types). */
export const StartupEntrySchema = z.object({
  kind: z.enum(['file', 'action']),
  path: z.string().optional(), absolutePath: z.string().optional(), size: z.number().int().min(0).optional(),
  value: z.string().optional(), builtin: z.string().optional(),
  layer: StartupLayerSchema, layerInferred: z.boolean(),
  delivery: z.string(), into: z.string().optional(), delivered: z.boolean().optional(),
  required: z.boolean().optional(), orientation: z.string().optional(),
  appliesOn: z.array(z.string()),
  origin: OriginSchema
});
export type StartupEntry = z.infer<typeof StartupEntrySchema>;

/** Why a role's file cannot be shown: `missing` the library lists it but the file is gone; `invalid` it does not read
 *  (`line` / `col`, 1-based, when the YAML parser says where). */
export const RoleFileErrorSchema = z.object({ kind: z.enum(['missing', 'invalid']), message: z.string(), line: z.number().int().optional(), col: z.number().int().optional() });
export type RoleFileError = z.infer<typeof RoleFileErrorSchema>;

/** A role in the machine's list. `id`: its library id (names are not unique: OpenRig ships a `shared` and so may the
 *  person); `source` `builtin` shipped with OpenRig, `user` the person's library; `importOnly`: a spec without profiles,
 *  only imported by others (`shared`); `seats` / `running`: members of rigs known to the daemon that run it, and those
 *  running now. `skills` and `startupFiles`, for the list's search. */
export const RoleSummarySchema = z.object({
  id: z.string(), name: z.string(), version: z.string().optional(), description: z.string().optional(),
  source: z.enum(['builtin', 'user']), path: z.string(), runtime: z.string().optional(),
  importOnly: z.boolean(), seats: z.number().int().min(0), running: z.number().int().min(0),
  skills: z.array(z.string()), startupFiles: z.array(z.string()),
  /** The seats that run it, so a seat of the Rigs page opens its role « seen from » it (`openrig.role` with `id`, then the seat by `rig` + `logicalId`). */
  seatRefs: z.array(z.object({ rig: z.string(), logicalId: z.string(), session: z.string().optional() })),
  error: z.enum(['missing', 'invalid']).optional()
});
export type RoleSummary = z.infer<typeof RoleSummarySchema>;

export const RoleImportSchema = z.object({
  ref: z.string(), key: z.string(), name: z.string().optional(), path: z.string().optional(), version: z.string().optional(),
  resolved: z.boolean(), error: z.string().optional()
});
export type RoleImport = z.infer<typeof RoleImportSchema>;

export const RoleProfileSchema = z.object({
  name: z.string(), description: z.string().optional(),
  runtime: SourcedStringSchema, model: SourcedStringSchema, effort: SourcedStringSchema,
  uses: z.object({ skills: RoleUsesListSchema, guidance: RoleUsesListSchema, subagents: RoleUsesListSchema, plugins: RoleUsesListSchema, runtimeResources: RoleUsesListSchema }),
  /** The role's share of the startup: agent then profile files and actions, in that order. */ startup: z.array(StartupEntrySchema)
});
export type RoleProfile = z.infer<typeof RoleProfileSchema>;

/** A seat that runs the role, in a rig known to the daemon. `rigSpecPath`: the spec that launched it (`composed`: one Ledge
 *  composed under `~/.ledge/rigs`); `member`: its member block in that spec, as YAML; `memberStartup`: what the member
 *  adds to the role's startup (« on top of the role »); `live`: what OpenRig resolved at its launch (its node detail),
 *  absent when OpenRig could not be asked. */
export const RoleSeatSchema = z.object({
  rig: z.string(), rigId: z.string(), rigSpecPath: z.string().optional(), composed: z.boolean(),
  logicalId: z.string(), session: z.string().optional(), label: z.string().optional(), profile: z.string(),
  running: z.boolean(), activity: z.string(),
  runtime: SourcedStringSchema, model: SourcedStringSchema, effort: SourcedStringSchema, cwd: SourcedStringSchema, cultureFile: SourcedStringSchema,
  member: z.string().optional(), memberStartup: z.array(StartupEntrySchema),
  /** The Role tab of this seat: its role guidance (`role.md`), then the startup files of its own (member layer), in delivery
   *  order — OpenRig's when the seat was launched, else the spec's. */
  roleDocs: z.array(StartupEntrySchema),
  live: z.object({
    resolvedSpec: z.object({ name: z.string().optional(), version: z.string().optional(), hash: z.string().optional() }),
    resources: z.array(RoleResourceSchema),
    /** In the order OpenRig returns them. */ startup: z.array(StartupEntrySchema),
    /** `rig skill loadout --seat`: the skills projected for this seat; absent when it could not be read. */
    skills: z.array(z.object({ id: z.string(), trigger: z.string().optional() })).optional()
  }).optional()
});
export type RoleSeat = z.infer<typeof RoleSeatSchema>;

/** What no source gives, for the screens to name: the harness's own prompt, the settings after merge, the content actually
 *  delivered, the files the harness loads on its own (`~/.claude/CLAUDE.md`, memory, startup hooks). */
export const RoleUnavailableSchema = z.enum(['harness_prompt', 'effective_settings', 'delivered_content', 'harness_own_files']);

/** One role. `role`: its role guidance (the `role.md`), for the screens to open first; `copies`: another copy of the same
 *  file found in a seat's working folder (`<cwd>/<library relative path>`, the repository it was added from), `identical`
 *  when its bytes are the library's; `importedBy`: for an import-only spec, the roles that import it. `error`: the file
 *  cannot be shown; the rest is then what the library says. */
export const RoleDetailSchema = z.object({
  summary: RoleSummarySchema,
  file: z.object({ path: z.string(), relativePath: z.string().optional(), modifiedAt: z.string().optional(),
    copies: z.array(z.object({ kind: z.literal('repo'), path: z.string(), identical: z.boolean(), modifiedAt: z.string().optional() })) }),
  error: RoleFileErrorSchema.optional(),
  role: z.object({ path: z.string(), absolutePath: z.string(), origin: OriginSchema }).nullable(),
  defaults: z.object({ runtime: SourcedStringSchema, model: SourcedStringSchema, effort: SourcedStringSchema }),
  imports: z.array(RoleImportSchema),
  importedBy: z.array(z.string()),
  profiles: z.array(RoleProfileSchema),
  /** What the file declares in `resources`. */ resources: z.array(RoleResourceSchema),
  seats: z.array(RoleSeatSchema),
  unavailable: z.array(RoleUnavailableSchema),
  warnings: z.array(z.string()),
  openrigVersion: z.string().optional()
});
export type RoleDetail = z.infer<typeof RoleDetailSchema>;

/** Why a machine could not answer: `daemon_stopped` (OpenRig must run), `not_installed`, `role_not_found`, `busy`, the
 *  fleet's `offline` / `outdated`, or what `rig` said. */
const RoleErrorSchema = z.string();
const LibraryIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'not a library id');

/** A front asks a machine for its roles. */
export const OpenRigRolesSchema = z.object({ type: z.literal('openrig.roles'), requestId: z.string().min(1).max(100), machineId: z.string().optional() });
export const OpenRigRoleListSchema = z.object({
  type: z.literal('openrig.roleList'), requestId: z.string(), machineId: z.string().optional(),
  roles: z.array(RoleSummarySchema), openrigVersion: z.string().optional(), error: RoleErrorSchema.optional()
});
/** A front asks a machine for one role, by library id (`roleId`: `id` names a session everywhere in the protocol). */
export const OpenRigRoleSchema = z.object({ type: z.literal('openrig.role'), requestId: z.string().min(1).max(100), machineId: z.string().optional(), roleId: LibraryIdSchema });
export const OpenRigRoleDetailSchema = z.object({
  type: z.literal('openrig.roleDetail'), requestId: z.string(), machineId: z.string().optional(), roleId: z.string(),
  role: RoleDetailSchema.optional(), error: RoleErrorSchema.optional()
});
/** A front asks for a file of a role: one of the paths its detail lists (its spec and imports, their resources and
 *  startup files, its seats' startup files and rig specs, the repository copy). Any other path is refused (`not_allowed`). */
export const OpenRigRoleFileSchema = z.object({
  type: z.literal('openrig.roleFile'), requestId: z.string().min(1).max(100), machineId: z.string().optional(),
  roleId: LibraryIdSchema, path: z.string().min(1).max(4096)
});
/** A role's file. `truncated`: longer than `ROLE_FILE_MAX` bytes, cut there. `error`: `not_allowed`, `missing`, `not_a_file`,
 *  `role_not_found`, or the fleet's `offline` / `outdated`. */
export const OpenRigRoleFileContentSchema = z.object({
  type: z.literal('openrig.roleFileContent'), requestId: z.string(), machineId: z.string().optional(), roleId: z.string(), path: z.string(),
  content: z.string().optional(), size: z.number().int().min(0).optional(), truncated: z.boolean().optional(), error: RoleErrorSchema.optional()
});
export const ROLE_FILE_MAX = 512 * 1024;

export type OpenRigRoles = z.infer<typeof OpenRigRolesSchema>;
export type OpenRigRoleList = z.infer<typeof OpenRigRoleListSchema>;
export type OpenRigRole = z.infer<typeof OpenRigRoleSchema>;
export type OpenRigRoleDetail = z.infer<typeof OpenRigRoleDetailSchema>;
export type OpenRigRoleFile = z.infer<typeof OpenRigRoleFileSchema>;
export type OpenRigRoleFileContent = z.infer<typeof OpenRigRoleFileContentSchema>;
