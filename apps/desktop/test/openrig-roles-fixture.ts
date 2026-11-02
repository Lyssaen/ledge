import type { RoleDetail, RoleSeat, RoleSummary, StartupEntry } from '@ledge/protocol';

/** A small machine, shaped like `rig specs ls` on the ledge-dev machine (docs/mockups/ledge-openrig-roles.html). */
const LIB = '/home/u/.openrig/specs/openrig/agents';
const PKG = '/n/@openrig/cli/daemon/specs/agents';
const summary = (o: Partial<RoleSummary> & Pick<RoleSummary, 'id' | 'name'>): RoleSummary => ({
  source: 'user', path: `${LIB}/${o.name}/agent.yaml`, importOnly: false, seats: 0, running: 0, skills: [], startupFiles: [], seatRefs: [], ...o
});
export const ROLES: RoleSummary[] = [
  summary({ id: 'u1', name: 'ledge-developer', version: '1.0', description: 'Dev de ledge-dev — implémente dans un worktree', runtime: 'claude-code', seats: 2, running: 2, startupFiles: ['guidance/role.md'],
    seatRefs: [{ rig: 'ledge-dev', logicalId: 'dev.front', session: 'dev-front@ledge-dev' }, { rig: 'ledge-dev', logicalId: 'dev.back', session: 'dev-back@ledge-dev' }] }),
  summary({ id: 'u2', name: 'ledge-lead', description: 'Lead de ledge-dev', runtime: 'claude-code', seats: 1, running: 1, seatRefs: [{ rig: 'ledge-dev', logicalId: 'pilot.lead' }] }),
  summary({ id: 'u3', name: 'shared', description: 'Ressources communes', importOnly: true }),
  summary({ id: 'b1', name: 'pm', source: 'builtin', path: `${PKG}/pm/agent.yaml`, description: 'Product Manager agent', runtime: 'claude-code', skills: ['office-hours', 'terraform-plan'] }),
  summary({ id: 'b2', name: 'qa', source: 'builtin', path: `${PKG}/qa/agent.yaml`, description: 'QA agent — verifies by effect', runtime: 'codex' })
];

const here = (key: string) => ({ kind: 'here' as const, key });
const roleMd: StartupEntry = { kind: 'file', path: 'guidance/role.md', absolutePath: `${LIB}/developer/guidance/role.md`, size: 1843, layer: 'agent', layerInferred: false,
  delivery: 'send_text', required: true, orientation: 'role', appliesOn: ['fresh_start', 'restore'], origin: here('startup.files[0]') };
const scope: StartupEntry = { kind: 'file', path: 'guidance/scope-front.md', absolutePath: '/home/u/.ledge/rigs/ledge-dev/guidance/scope-front.md', size: 700, layer: 'member', layerInferred: true,
  delivery: 'send_text', required: true, appliesOn: ['fresh_start', 'restore'], origin: { kind: 'inherited', from: 'member', ref: 'dev.front' } };
const merge = (path: string, extra: Partial<StartupEntry> = {}): StartupEntry => ({ kind: 'file', path, absolutePath: `/o/guidance/${path}`, size: 1300, layer: 'openrig', layerInferred: true,
  delivery: 'guidance_merge', into: '/home/u/Workspace/ledge/CLAUDE.md', delivered: true, required: true, appliesOn: ['fresh_start', 'restore'], origin: { kind: 'inherited', from: 'openrig' }, ...extra });
const sourced = (value: string | null, origin: RoleSeat['runtime']['origin']) => ({ value, origin });
const member = (logicalId: string) => ({ kind: 'inherited' as const, from: 'member' as const, ref: logicalId });

const seat = (logicalId: string, own: StartupEntry[], live: boolean): RoleSeat => ({
  rig: 'ledge-dev', rigId: 'r1', rigSpecPath: '/home/u/.ledge/rigs/ledge-dev/rig.yaml', composed: true, logicalId, session: `${logicalId.replace('.', '-')}@ledge-dev`, label: 'Dev', profile: 'default',
  running: true, activity: logicalId === 'dev.front' ? 'running' : 'idle',
  runtime: sourced('claude-code', member(logicalId)), model: sourced('claude-opus-5-5', member(logicalId)), effort: sourced(null, { kind: 'inherited', from: 'launch' }),
  cwd: sourced('~/Workspace/ledge', member(logicalId)), cultureFile: sourced('CULTURE.md', { kind: 'inherited', from: 'rig', ref: 'ledge-dev' }),
  member: `- id: ${logicalId.split('.')[1]}\n  agent_ref: "path:~/.openrig/specs/openrig/agents/developer"\n  model: claude-opus-5-5`,
  memberStartup: own, roleDocs: [roleMd, ...own],
  ...(live ? { live: { resolvedSpec: { name: 'ledge-developer' }, resources: [], startup: [roleMd, merge('CULTURE-default.md'), ...own, merge('openrig-seat-skills.md', { delivered: false, required: false, origin: { kind: 'unknown', why: 'missing_from_guidance' } }),
    { kind: 'action', builtin: 'session_identity', value: 'dev-front@ledge-dev\nOpenRig session identity:', layer: 'openrig', layerInferred: false, delivery: 'send_text', appliesOn: ['fresh_start', 'restore'], origin: { kind: 'inherited', from: 'openrig', ref: 'session_identity' } }],
    skills: [{ id: 'queue-handoff' }, { id: 'refocusing' }] } } : {})
});

const uses = (declared: boolean, key: string, items: RoleDetail['profiles'][number]['uses']['skills']['items'] = []) => ({ declared, key, items });
export const DEVELOPER: RoleDetail = {
  summary: ROLES[0]!,
  file: { path: `${LIB}/developer/agent.yaml`, copies: [{ kind: 'repo', path: '/home/u/Workspace/ledge/openrig/agents/developer/agent.yaml', identical: true }] },
  role: { path: 'guidance/role.md', absolutePath: `${LIB}/developer/guidance/role.md`, origin: here('resources.guidance[0]') },
  defaults: { runtime: sourced('claude-code', here('defaults.runtime')), model: sourced(null, { kind: 'absent' }), effort: sourced(null, { kind: 'absent' }) },
  imports: [{ ref: 'local:../shared', key: 'imports[0].ref', name: 'shared', path: `${LIB}/shared/agent.yaml`, resolved: true }],
  importedBy: [],
  profiles: [{
    name: 'default', runtime: sourced('claude-code', here('defaults.runtime')), model: sourced(null, { kind: 'absent' }), effort: sourced(null, { kind: 'absent' }),
    uses: {
      skills: uses(true, 'profiles.default.uses.skills'), guidance: uses(false, 'profiles.default.uses.guidance'), subagents: uses(true, 'profiles.default.uses.subagents'),
      plugins: uses(true, 'profiles.default.uses.plugins', [{ category: 'plugin', id: 'shared:openrig-core', path: 'openrig-home:plugins/openrig-core', plugin: { skills: ['queue-handoff', 'refocusing'], hooks: 2 }, origin: { kind: 'inherited', from: 'import', ref: 'shared' } }]),
      runtimeResources: uses(true, 'profiles.default.uses.runtime_resources', [
        { category: 'runtime_resource', id: 'shared:claude-default-mcp', absolutePath: `${LIB}/shared/runtime/claude-mcp.fragment.json`, runtime: 'claude-code', type: 'claude_mcp_fragment', target: '<cwd>/.mcp.json', origin: { kind: 'inherited', from: 'import', ref: 'shared' } },
        { category: 'runtime_resource', id: 'shared:codex-default-config', runtime: 'codex', type: 'codex_config_fragment', target: '$CODEX_HOME/config.toml', origin: { kind: 'inherited', from: 'import', ref: 'shared' } }
      ])
    },
    startup: [roleMd]
  }],
  resources: [{ category: 'guidance', id: 'role', path: 'guidance/role.md', origin: here('resources.guidance[0]') }],
  seats: [seat('dev.front', [scope], true), seat('dev.back', [], false)],
  unavailable: ['harness_prompt', 'effective_settings', 'harness_own_files', 'delivered_content'],
  warnings: [], openrigVersion: '0.7.7'
};

export const FILES: Record<string, string> = {
  [`${LIB}/developer/guidance/role.md`]: '# Rôle : développeur de ledge-dev\n\nTu implémentes la tâche qui t’est assignée.\n\n## Au démarrage\n\n- `rig whoami --json`',
  '/home/u/.ledge/rigs/ledge-dev/guidance/scope-front.md': '# Ton périmètre : front-end',
  '/o/guidance/CULTURE-default.md': '# OpenRig default culture',
  [`${LIB}/developer/agent.yaml`]: 'name: ledge-developer\nversion: "1.0"\n# comment\ndefaults:\n  runtime: claude-code',
  [`${LIB}/shared/agent.yaml`]: 'name: shared\nprofiles: {}',
  [`${LIB}/shared/runtime/claude-mcp.fragment.json`]: '{ "mcpServers": {} }'
};
