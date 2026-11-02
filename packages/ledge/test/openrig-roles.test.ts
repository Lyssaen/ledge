import { describe, it, expect } from 'vitest';
import { ClientMessageSchema, RoleDetailSchema, RoleSummarySchema } from '@ledge/protocol';
import { createServer } from 'node:http';
import { createOpenRig, localGet, type RigRun } from '../src/daemon/openrig.js';
import { hasManagedBlock, importPath, layerOf, parseSpec, specPath } from '../src/daemon/openrigRoles.js';

// The ledge-dev rig as OpenRig 0.7.7 showed it on 2026-11-02 (trimmed): library under ~/.openrig/specs/openrig, the running
// rig launched from the copy Ledge composed under ~/.ledge/rigs/ledge-dev, the repository at ~/Workspace/ledge.
const H = '/home/u';
const LIB = `${H}/.openrig/specs/openrig`;
const RIG = `${H}/.ledge/rigs/ledge-dev`;
const PKG = `${H}/.nvm/lib/node_modules/@openrig/cli/daemon`;
const REPO = `${H}/Workspace/ledge`;

const LEAD = `name: ledge-lead
version: "1.0"
description: Lead de ledge-dev
defaults:
  runtime: claude-code
imports:
  - ref: local:../shared
profiles:
  default:
    uses:
      skills: []
      guidance: []
      subagents: []
      plugins: [shared:openrig-core]
      runtime_resources: [shared:claude-default-settings, shared:codex-default-config]
resources:
  guidance:
    - id: role
      path: guidance/role.md
startup:
  files:
    - path: guidance/role.md
      orientation: role
      delivery_hint: send_text
      required: true
  actions: []
`;
const DEV = LEAD.replace('name: ledge-lead', 'name: ledge-developer').replace('Lead de ledge-dev', 'Dev de ledge-dev');
const SHARED = `name: shared
version: "1.0"
resources:
  plugins:
    - id: openrig-core
      source:
        kind: local
        path: "openrig-home:plugins/openrig-core"
  runtime_resources:
    - id: claude-default-settings
      path: runtime/claude-settings.fragment.json
      runtime: claude-code
      type: claude_settings_fragment
    - id: codex-default-config
      path: runtime/codex-config.fragment.toml
      runtime: codex
      type: codex_config_fragment
profiles: {}
`;
// A builtin with two profiles, a skill only OpenRig finds at launch, and `guidance` not written in its default profile.
const PM = `name: pm
version: "1.0"
description: Product Manager agent
defaults:
  runtime: claude-code
  model: claude-opus-4-6
imports:
  - ref: local:../../shared
profiles:
  default:
    preferences:
      model: claude-sonnet-4-6
    uses:
      skills: [office-hours, shared:systematic-debugging]
      plugins: [shared:openrig-core]
  advisor:
    uses:
      skills: [shared:orchestration-team]
`;
const PM_SHARED = `name: shared
version: "1.0"
resources:
  skills:
    - id: systematic-debugging
      path: skills/process/systematic-debugging
  plugins:
    - id: openrig-core
      source: { kind: local, path: "openrig-home:plugins/openrig-core" }
`;
const RIG_YAML = `version: "0.2"
name: ledge-dev
culture_file: CULTURE.md
pods:
  - id: pilot
    members:
      - id: lead
        label: Lead
        agent_ref: path:${LIB}/agents/lead
        profile: default
        runtime: claude-code
        model: claude-opus-5-5
        cwd: ~/Workspace/ledge
  - id: dev
    members:
      - id: front
        label: Dev front
        agent_ref: path:${LIB}/agents/developer
        profile: default
        runtime: claude-code
        model: claude-opus-5-5
        cwd: ~/Workspace/ledge
        startup:
          files:
            - path: guidance/scope-front.md
              delivery_hint: send_text
              required: true
`;
const SPEC_SHOW = {
  version: '0.2', name: 'ledge-dev', cultureFile: 'CULTURE.md', permissionPolicy: 'builtin:yolo',
  pods: [
    { id: 'pilot', members: [{ id: 'lead', agentRef: `path:${LIB}/agents/lead`, profile: 'default', runtime: 'claude-code', cwd: REPO, label: 'Lead', model: 'claude-opus-5-5' }] },
    { id: 'dev', members: [{ id: 'front', agentRef: `path:${LIB}/agents/developer`, profile: 'default', runtime: 'claude-code', cwd: REPO, label: 'Dev front', model: 'claude-opus-5-5' }] }
  ]
};
const LIBRARY = [
  { id: 'f95e', kind: 'agent', name: 'ledge-lead', version: '1.0', sourceType: 'user_file', sourcePath: `${LIB}/agents/lead/agent.yaml`, relativePath: 'openrig/agents/lead/agent.yaml', summary: 'Lead de ledge-dev', resolvedSourcePath: `${LIB}/agents/lead/agent.yaml` },
  { id: '2158', kind: 'agent', name: 'ledge-developer', version: '1.0', sourceType: 'user_file', sourcePath: `${LIB}/agents/developer/agent.yaml`, relativePath: 'openrig/agents/developer/agent.yaml', resolvedSourcePath: `${LIB}/agents/developer/agent.yaml` },
  { id: '05ee', kind: 'agent', name: 'shared', version: '1.0', sourceType: 'user_file', sourcePath: `${LIB}/agents/shared/agent.yaml`, relativePath: 'openrig/agents/shared/agent.yaml', resolvedSourcePath: `${LIB}/agents/shared/agent.yaml` },
  { id: '3a28', kind: 'agent', name: 'pm', version: '1.0', sourceType: 'builtin', sourcePath: `${PKG}/specs/agents/product-management/pm/agent.yaml`, resolvedSourcePath: `${PKG}/specs/agents/product-management/pm/agent.yaml` },
  { id: 'dead', kind: 'agent', name: 'ledge-ux', sourceType: 'user_file', sourcePath: `${LIB}/agents/ux/agent.yaml` },
  { id: 'rig1', kind: 'rig', name: 'ledge-dev', sourceType: 'user_file', sourcePath: `${LIB}/rig.yaml` }
];
const node = (logicalId: string, session: string, agent: string, extra: object[] = []) => ({
  logicalId, canonicalSessionName: session, runtime: 'claude-code', model: 'claude-opus-5-5', effort: null, effortSource: 'runtime_default',
  agentRef: `path:${LIB}/agents/${agent}`, profile: 'default', resolvedSpecName: `ledge-${agent === 'lead' ? 'lead' : 'developer'}`, resolvedSpecVersion: '1.0', resolvedSpecHash: 'd2cd',
  cwd: REPO, resumeToken: 'SECRET-TOKEN', resumeCommand: "claude --resume 'SECRET-TOKEN'", recoveryGuidance: { commands: ['claude --resume SECRET-TOKEN'] },
  identityVerdict: { evidence: { observedCommand: 'claude --dangerously-skip-permissions --settings {"permissions":{}}' } }, recentEvents: [{ type: 'x' }],
  startupFiles: [
    { kind: 'file', path: 'guidance/role.md', orientation: 'role', deliveryHint: 'send_text', required: true, appliesOn: ['fresh_start', 'restore'], absolutePath: `${LIB}/agents/${agent}/guidance/role.md`, ownerRoot: `${LIB}/agents/${agent}` },
    { path: 'CULTURE-default.md', ownerRoot: `${PKG}/assets`, deliveryHint: 'guidance_merge', required: true, appliesOn: ['fresh_start', 'restore'], absolutePath: `${PKG}/assets/guidance/CULTURE-default.md` },
    { path: 'CULTURE.md', ownerRoot: RIG, deliveryHint: 'guidance_merge', required: true, appliesOn: ['fresh_start', 'restore'], absolutePath: `${RIG}/CULTURE.md` },
    ...extra,
    { path: 'openrig-onboarding-01.md', ownerRoot: `${PKG}/assets`, deliveryHint: 'guidance_merge', required: true, appliesOn: ['fresh_start'], absolutePath: `${PKG}/assets/onboarding/01-world-and-purpose.md` },
    { path: 'openrig-seat-skills.md', ownerRoot: `${PKG}/assets`, deliveryHint: 'guidance_merge', required: false, appliesOn: ['fresh_start', 'restore'], absolutePath: `${PKG}/assets/guidance/openrig-seat-skills.md` }
  ],
  startupActions: [{ type: 'send_text', value: `${session}\nOpenRig session identity:`, phase: 'after_ready', appliesOn: ['fresh_start', 'restore'], idempotent: true, builtin: 'session_identity' }],
  installedResources: [{ id: 'shared:openrig-core', category: 'plugin', targetPath: '' }, { id: 'shared:claude-default-settings', category: 'runtime_resource', targetPath: '' }]
});
const NODES: Record<string, unknown> = {
  'pilot.lead': node('pilot.lead', 'pilot-lead@ledge-dev', 'lead'),
  'dev.front': node('dev.front', 'dev-front@ledge-dev', 'developer', [{ kind: 'file', path: 'guidance/scope-front.md', deliveryHint: 'send_text', required: true, appliesOn: ['fresh_start', 'restore'], absolutePath: `${RIG}/guidance/scope-front.md`, ownerRoot: RIG }])
};
// CLAUDE.md as it was: OpenRig's blocks, but not openrig-seat-skills.md.
const CLAUDE = ['CULTURE-default.md', 'CULTURE.md', 'openrig-onboarding-01.md'].map(f => `<!-- BEGIN OpenRig MANAGED BLOCK: ${f} -->\n…\n<!-- END OpenRig MANAGED BLOCK: ${f} -->`).join('\n') + '\n# the person own notes\n';
const PLUGIN = { entry: { id: 'openrig-core', version: '0.1.23' }, skills: [{ name: 'queue-handoff', relativePath: 'skills/queue-handoff' }, { name: 'refocusing', relativePath: 'skills/refocusing' }], hooks: [{ runtime: 'claude' }, { runtime: 'codex' }] };
const LOADOUT = { seat: {}, storage: '/x', skills: [{ id: 'queue-handoff', trigger: 'Use when ending a turn', path: '/x/SKILL.md' }] };

function world(over: { files?: Record<string, string>; http?: boolean; specShow?: unknown; nodeRuntime?: string | null } = {}) {
  const files: Record<string, string> = {
    [`${LIB}/agents/lead/agent.yaml`]: LEAD, [`${LIB}/agents/lead/guidance/role.md`]: '# Rôle : lead\n',
    [`${LIB}/agents/developer/agent.yaml`]: DEV, [`${LIB}/agents/developer/guidance/role.md`]: '# Rôle : développeur\n',
    [`${LIB}/agents/shared/agent.yaml`]: SHARED, [`${LIB}/agents/shared/runtime/claude-settings.fragment.json`]: '{ "enabledMcpjsonServers": ["exa"] }',
    [`${LIB}/agents/shared/runtime/codex-config.fragment.toml`]: '[mcp_servers.exa]',
    [`${PKG}/specs/agents/product-management/pm/agent.yaml`]: PM, [`${PKG}/specs/agents/shared/agent.yaml`]: PM_SHARED,
    [`${LIB}/rig.yaml`]: RIG_YAML, [`${RIG}/rig.yaml`]: RIG_YAML, [`${RIG}/CULTURE.md`]: '# Culture\n', [`${RIG}/guidance/scope-front.md`]: '# Front\n',
    [`${PKG}/assets/guidance/CULTURE-default.md`]: '# Default\n', [`${PKG}/assets/onboarding/01-world-and-purpose.md`]: '# World\n',
    [`${PKG}/assets/guidance/openrig-seat-skills.md`]: 'seat skills',
    [`${REPO}/CLAUDE.md`]: CLAUDE, [`${REPO}/openrig/agents/lead/agent.yaml`]: LEAD, [`${REPO}/openrig/agents/developer/agent.yaml`]: DEV.replace('skills: []', 'skills: [tdd]'),
    [`${H}/.ssh/id_ed25519`]: 'PRIVATE KEY',
    ...over.files
  };
  // An override to undefined removes the file.
  for (const k of Object.keys(files)) if (files[k] === undefined) delete files[k];
  const calls: string[] = [], httpCalls: string[] = [];
  const run: RigRun = async args => {
    calls.push(args.join(' '));
    const ok = (j: unknown) => ({ code: 0, stdout: JSON.stringify(j), stderr: '' });
    const a = args.join(' ');
    if (a === 'status --json') return ok({ daemon: { state: 'running', reachable: true, port: 7433 }, kernel: { state: 'ready' } });
    if (a === '--version') return { code: 0, stdout: '0.7.7 (f3d8bac4)\n', stderr: '' };
    if (a === 'ps --json') return ok([{ rigId: '01R', name: 'ledge-dev', nodeCount: 2, runningCount: 2, status: 'running', lifecycleState: 'running' }]);
    if (a === 'ps --nodes -A --json') return ok([
      { rigId: '01R', rigName: 'ledge-dev', logicalId: 'pilot.lead', canonicalSessionName: 'pilot-lead@ledge-dev', runtime: 'claude-code', sessionStatus: 'running', lifecycleState: 'running', agentActivity: { state: 'running' } },
      { rigId: '01R', rigName: 'ledge-dev', logicalId: 'dev.front', canonicalSessionName: 'dev-front@ledge-dev', runtime: 'claude-code', sessionStatus: 'running', lifecycleState: 'running', agentActivity: { state: 'idle' } }]);
    if (a === 'specs ls --kind agent --json') return ok(LIBRARY.filter(e => e.kind === 'agent'));
    if (a === 'specs ls --json') return ok(LIBRARY);
    if (a === 'spec show 01R --json') return ok(over.specShow ?? SPEC_SHOW);
    if (a === 'plugin show openrig-core --json') return ok(PLUGIN);
    if (args[0] === 'skill' && args[1] === 'loadout') return ok(LOADOUT);
    return { code: 1, stdout: '', stderr: `unexpected ${a}` };
  };
  const roleIo = {
    read: async (p: string) => files[p] ?? null,
    stat: async (p: string) => (p in files ? { size: Buffer.byteLength(files[p]!), mtimeMs: Date.parse('2026-11-02T14:58:00Z'), file: true } : null),
    head: async (p: string, max: number) => (p in files ? files[p]!.slice(0, max) : null)
  };
  const http = async (path: string) => {
    httpCalls.push(path);
    if (over.http === false) return undefined;
    const m = /^\/api\/rigs\/01R\/nodes\/(.+)$/.exec(path);
    const n = m ? NODES[decodeURIComponent(m[1]!)] as Record<string, unknown> | undefined : undefined;
    if (!n || over.nodeRuntime === undefined) return n;
    const { runtime: _r, ...rest } = n;
    return over.nodeRuntime === null ? rest : { ...rest, runtime: over.nodeRuntime };
  };
  const fs = { read: async (p: string) => { if (p in files) return files[p]!; throw new Error('ENOENT'); }, exists: (p: string) => p in files, copyDir: async () => {}, write: async () => {} };
  const rig = createOpenRig({ run, fs, roleIo, http, home: H, rigsDir: `${H}/.ledge/rigs`, openrigHome: `${H}/.openrig` });
  return { rig, calls, httpCalls };
}

describe('OpenRig roles: the list', () => {
  it('every agent spec of the library, with its seats in the rigs the daemon knows, its skills and startup files for the search', async () => {
    const { roles, openrigVersion, error } = await world().rig.roles();
    expect(error).toBeUndefined();
    expect(openrigVersion).toBe('0.7.7');
    for (const r of roles) expect(RoleSummarySchema.parse(r)).toEqual(r);
    expect(roles.map(r => r.name)).toEqual(['ledge-lead', 'ledge-developer', 'shared', 'pm', 'ledge-ux']);
    const by = (n: string) => roles.find(r => r.name === n)!;
    expect(by('ledge-lead')).toMatchObject({ id: 'f95e', source: 'user', runtime: 'claude-code', importOnly: false, seats: 1, running: 1, startupFiles: ['guidance/role.md'] });
    expect(by('ledge-developer')).toMatchObject({ seats: 1, running: 1, seatRefs: [{ rig: 'ledge-dev', logicalId: 'dev.front', session: 'dev-front@ledge-dev' }] });
    expect(by('shared')).toMatchObject({ importOnly: true, seats: 0 });
    expect(by('pm')).toMatchObject({ source: 'builtin', seats: 0, skills: ['office-hours', 'shared:systematic-debugging', 'shared:orchestration-team'] });
    // The library still lists it, its file is gone.
    expect(by('ledge-ux')).toMatchObject({ error: 'missing', importOnly: false });
  });
  it('OpenRig stopped or absent: the error the launch form already knows', async () => {
    const stopped = createOpenRig({ run: async () => ({ code: 1, stdout: '', stderr: 'Daemon not running. Start it with: rig daemon start' }) });
    expect(await stopped.roles()).toEqual({ roles: [], error: 'daemon_stopped' });
    const absent = createOpenRig({ run: async () => ({ code: null, stdout: '', stderr: '' }) });
    expect(await absent.roles()).toEqual({ roles: [], error: 'not_installed' });
    expect(await absent.role('x')).toEqual({ error: 'not_installed' });
  });
});

describe('OpenRig roles: one role, from its spec', () => {
  it('ledge-lead: defaults, its import resolved, each uses list with where it comes from, its role.md first', async () => {
    const { role } = await world().rig.role('f95e');
    expect(RoleDetailSchema.parse(role)).toEqual(role);
    const r = role!;
    expect(r.role).toEqual({ path: 'guidance/role.md', absolutePath: `${LIB}/agents/lead/guidance/role.md`, origin: { kind: 'here', key: 'startup.files[0]' } });
    expect(r.defaults.runtime).toEqual({ value: 'claude-code', origin: { kind: 'here', key: 'defaults.runtime' } });
    expect(r.defaults.model).toEqual({ value: null, origin: { kind: 'absent' } });
    expect(r.imports).toEqual([{ ref: 'local:../shared', key: 'imports[0].ref', name: 'shared', path: `${LIB}/agents/shared/agent.yaml`, resolved: true }]);
    const p = r.profiles[0]!;
    expect(p.name).toBe('default');
    expect(p.runtime).toEqual({ value: 'claude-code', origin: { kind: 'inherited', from: 'defaults', key: 'defaults.runtime' } });
    // A written [] is « empty », not « not declared ».
    expect(p.uses.skills).toEqual({ declared: true, key: 'profiles.default.uses.skills', items: [] });
    expect(p.uses.plugins.items).toEqual([{ category: 'plugin', id: 'shared:openrig-core', path: 'openrig-home:plugins/openrig-core', absolutePath: `${H}/.openrig/plugins/openrig-core`,
      plugin: { version: '0.1.23', skills: ['queue-handoff', 'refocusing'], hooks: 2 }, origin: { kind: 'inherited', from: 'import', ref: 'shared', path: `${LIB}/agents/shared/agent.yaml` } }]);
    expect(p.uses.runtimeResources.items.map(x => [x.id, x.type, x.runtime, x.target, x.absolutePath])).toEqual([
      ['shared:claude-default-settings', 'claude_settings_fragment', 'claude-code', '<cwd>/.claude/settings.local.json', `${LIB}/agents/shared/runtime/claude-settings.fragment.json`],
      ['shared:codex-default-config', 'codex_config_fragment', 'codex', '$CODEX_HOME/config.toml', `${LIB}/agents/shared/runtime/codex-config.fragment.toml`]]);
    expect(p.startup).toEqual([{ kind: 'file', path: 'guidance/role.md', absolutePath: `${LIB}/agents/lead/guidance/role.md`, size: 15, layer: 'agent', layerInferred: false,
      delivery: 'send_text', required: true, orientation: 'role', appliesOn: ['fresh_start', 'restore'], origin: { kind: 'here', key: 'startup.files[0]' } }]);
    expect(r.resources).toEqual([{ category: 'guidance', id: 'role', path: 'guidance/role.md', absolutePath: `${LIB}/agents/lead/guidance/role.md`, origin: { kind: 'here', key: 'resources.guidance[0]' } }]);
    expect(r.unavailable).toEqual(['harness_prompt', 'effective_settings', 'delivered_content', 'harness_own_files']);
    expect(r.openrigVersion).toBe('0.7.7');
  });
  it('the repository copy, found in a seat folder under the library path: identical, or not', async () => {
    const lead = (await world().rig.role('f95e')).role!;
    expect(lead.file).toMatchObject({ path: `${LIB}/agents/lead/agent.yaml`, relativePath: 'openrig/agents/lead/agent.yaml', copies: [{ kind: 'repo', path: `${REPO}/openrig/agents/lead/agent.yaml`, identical: true }] });
    const dev = (await world().rig.role('2158')).role!;
    expect(dev.file.copies).toMatchObject([{ path: `${REPO}/openrig/agents/developer/agent.yaml`, identical: false }]);
  });
  it('a builtin with two profiles: preferences over defaults, an unwritten list « not declared », a bare skill nobody declares resolved at launch', async () => {
    const r = (await world().rig.role('3a28')).role!;
    expect(r.profiles.map(p => p.name)).toEqual(['default', 'advisor']);
    const [def, adv] = r.profiles as [typeof r.profiles[0], typeof r.profiles[0]];
    expect(def.model).toEqual({ value: 'claude-sonnet-4-6', origin: { kind: 'here', key: 'profiles.default.preferences.model' } });
    expect(adv.model).toEqual({ value: 'claude-opus-4-6', origin: { kind: 'inherited', from: 'defaults', key: 'defaults.model' } });
    expect(def.uses.guidance).toEqual({ declared: false, key: 'profiles.default.uses.guidance', items: [] });
    expect(def.uses.skills.items.map(i => [i.id, i.origin])).toEqual([
      ['office-hours', { kind: 'unknown', why: 'resolved_at_launch' }],
      ['shared:systematic-debugging', { kind: 'inherited', from: 'import', ref: 'shared', path: `${PKG}/specs/agents/shared/agent.yaml` }]]);
    // Its seats: none in a known rig.
    expect(r.seats).toEqual([]);
    expect(r.file.copies).toEqual([]);
  });
  it('an import-only spec: no profile, and the roles that import it', async () => {
    const r = (await world().rig.role('05ee')).role!;
    expect(r.summary.importOnly).toBe(true);
    expect(r.importedBy.sort()).toEqual(['ledge-developer', 'ledge-lead']);
    expect(r.resources.map(x => x.id)).toEqual(['openrig-core', 'claude-default-settings', 'codex-default-config']);
    expect(r.resources[0]!.plugin).toEqual({ version: '0.1.23', skills: ['queue-handoff', 'refocusing'], hooks: 2 });
  });
  it('an unresolved import: what comes from it is unknown with the reason; the rest shows', async () => {
    const r = (await world({ files: { [`${LIB}/agents/shared/agent.yaml`]: undefined as unknown as string } }).rig.role('f95e')).role!;
    expect(r.imports[0]).toMatchObject({ ref: 'local:../shared', resolved: false, error: 'imported file not found' });
    expect(r.profiles[0]!.uses.plugins.items[0]).toMatchObject({ id: 'shared:openrig-core', origin: { kind: 'unknown', why: 'unreadable' } });
    expect(r.defaults.runtime.value).toBe('claude-code');
  });
  it('an invalid spec: the parser line and column, no parameters', async () => {
    const bad = LEAD.replace('      guidance: []', '       guidance: []');
    const r = (await world({ files: { [`${LIB}/agents/lead/agent.yaml`]: bad } }).rig.role('f95e')).role!;
    expect(r.error).toMatchObject({ kind: 'invalid', line: expect.any(Number), col: expect.any(Number) });
    expect(r.profiles).toEqual([]);
    expect(r.summary.error).toBe('invalid');
  });
  it('a missing file, an unknown id', async () => {
    const w = world();
    expect((await w.rig.role('dead')).role!.error).toEqual({ kind: 'missing', message: 'file not found' });
    expect(await w.rig.role('nope')).toEqual({ error: 'role_not_found' });
  });
  it('a bare id two imports declare is ambiguous: Ledge does not choose', async () => {
    const two = `name: two\nversion: "1"\nimports:\n  - ref: local:../a\n  - ref: local:../b\nprofiles:\n  default:\n    uses:\n      skills: [frontend-design]\n`;
    const kit = (n: string) => `name: ${n}\nversion: "1"\nresources:\n  skills:\n    - id: frontend-design\n      path: skills/frontend-design\n`;
    const parsed = parseSpec(two);
    expect(parsed.ok).toBe(true);
    const { resolveImports, resolveProfile } = await import('../src/daemon/openrigRoles.js');
    const io = { read: async (p: string) => ({ '/s/a/agent.yaml': kit('a'), '/s/b/agent.yaml': kit('design-kit') } as Record<string, string>)[p] ?? null, stat: async () => null };
    const spec = { path: '/s/two/agent.yaml', dir: '/s/two', doc: (parsed as { ok: true; doc: Record<string, unknown> }).doc };
    const imports = await resolveImports(spec, io);
    const p = resolveProfile('default', spec, imports, { home: H, openrigHome: `${H}/.openrig` }, new Map());
    expect(p.uses.skills.items[0]).toEqual({ category: 'skill', id: 'frontend-design', origin: { kind: 'unknown', why: 'ambiguous', detail: 'a, design-kit' } });
  });
});

describe('OpenRig roles: one role, from its seats', () => {
  it('dev.front: what it runs (member over the spec), what the member adds, the startup in OpenRig order sorted into layers', async () => {
    const r = (await world().rig.role('2158')).role!;
    expect(r.seats).toHaveLength(1);
    const s = r.seats[0]!;
    expect(s).toMatchObject({ rig: 'ledge-dev', rigId: '01R', rigSpecPath: `${RIG}/rig.yaml`, composed: true, logicalId: 'dev.front', session: 'dev-front@ledge-dev', label: 'Dev front',
      profile: 'default', running: true, activity: 'idle' });
    expect(s.model).toEqual({ value: 'claude-opus-5-5', origin: { kind: 'inherited', from: 'member', ref: 'dev.front', key: 'model' } });
    expect(s.effort).toEqual({ value: null, origin: { kind: 'inherited', from: 'launch', ref: 'runtime_default' } });
    expect(s.cwd).toEqual({ value: REPO, origin: { kind: 'inherited', from: 'member', ref: 'dev.front', key: 'cwd' } });
    expect(s.cultureFile).toEqual({ value: 'CULTURE.md', origin: { kind: 'inherited', from: 'rig', ref: 'ledge-dev', key: 'culture_file', path: `${RIG}/CULTURE.md` } });
    expect(s.member).toContain('guidance/scope-front.md');
    expect(s.memberStartup).toEqual([{ kind: 'file', path: 'guidance/scope-front.md', absolutePath: `${RIG}/guidance/scope-front.md`, size: 8, layer: 'member', layerInferred: false,
      delivery: 'send_text', required: true, appliesOn: ['fresh_start', 'restore'], origin: { kind: 'inherited', from: 'member', ref: 'dev.front', key: 'startup.files[0]' } }]);
    const live = s.live!;
    expect(live.resolvedSpec).toEqual({ name: 'ledge-developer', version: '1.0', hash: 'd2cd' });
    expect(live.startup.map(e => [e.kind, e.path ?? e.builtin, e.layer, e.delivery, e.delivered, e.origin.kind])).toEqual([
      ['file', 'guidance/role.md', 'agent', 'send_text', undefined, 'here'],
      ['file', 'CULTURE-default.md', 'openrig', 'guidance_merge', true, 'inherited'],
      ['file', 'CULTURE.md', 'culture', 'guidance_merge', true, 'inherited'],
      ['file', 'guidance/scope-front.md', 'member', 'send_text', undefined, 'inherited'],
      ['file', 'openrig-onboarding-01.md', 'openrig', 'guidance_merge', true, 'inherited'],
      // Planned, but not in CLAUDE.md: the plan is not proof of delivery.
      ['file', 'openrig-seat-skills.md', 'openrig', 'guidance_merge', false, 'unknown'],
      ['action', 'session_identity', 'openrig', 'send_text', undefined, 'inherited']]);
    expect(live.startup[5]!.origin).toEqual({ kind: 'unknown', why: 'missing_from_guidance', detail: `${REPO}/CLAUDE.md` });
    expect(live.startup[1]).toMatchObject({ into: `${REPO}/CLAUDE.md`, layerInferred: true, size: 10 });
    expect(live.resources.map(x => [x.id, x.target, x.origin])).toEqual([
      ['shared:openrig-core', undefined, { kind: 'inherited', from: 'import', ref: 'shared' }],
      ['shared:claude-default-settings', `${REPO}/.claude/settings.local.json`, { kind: 'inherited', from: 'import', ref: 'shared' }]]);
    expect(live.skills).toEqual([{ id: 'queue-handoff', trigger: 'Use when ending a turn' }]);
    // The Role tab: role.md, then what is the seat's own, in delivery order.
    expect(s.roleDocs.map(e => [e.path, e.layer, e.absolutePath])).toEqual([
      ['guidance/role.md', 'agent', `${LIB}/agents/developer/guidance/role.md`], ['guidance/scope-front.md', 'member', `${RIG}/guidance/scope-front.md`]]);
  });
  it('a member that writes no runtime: its blocks go where the resolved runtime puts them (the profile’s, the defaults’)', async () => {
    const noRuntime = RIG_YAML.replace('        runtime: claude-code\n        model: claude-opus-5-5\n        cwd: ~/Workspace/ledge\n        startup:', '        model: claude-opus-5-5\n        cwd: ~/Workspace/ledge\n        startup:');
    expect(noRuntime).not.toBe(RIG_YAML);
    const shown = { ...SPEC_SHOW, pods: SPEC_SHOW.pods.map(p => ({ ...p, members: p.members.map(({ runtime: _r, ...m }) => m) })) };
    const w = world({ files: { [`${RIG}/rig.yaml`]: noRuntime }, specShow: shown, nodeRuntime: null });
    const s = (await w.rig.role('2158')).role!.seats[0]!;
    expect(s.runtime).toEqual({ value: 'claude-code', origin: { kind: 'inherited', from: 'defaults', key: 'defaults.runtime' } });
    const merged = s.live!.startup.filter(e => e.delivery === 'guidance_merge');
    expect(merged.every(e => e.into === `${REPO}/CLAUDE.md`)).toBe(true);
    expect(merged.find(e => e.path === 'CULTURE.md')!.delivered).toBe(true);
  });
  it('the runtime OpenRig launched decides over the spec: a Codex node writes into AGENTS.md', async () => {
    const w = world({ files: { [`${REPO}/AGENTS.md`]: '<!-- BEGIN OpenRig MANAGED BLOCK: CULTURE.md -->' }, nodeRuntime: 'codex' });
    const s = (await w.rig.role('2158')).role!.seats[0]!;
    const culture = s.live!.startup.find(e => e.path === 'CULTURE.md')!;
    expect(culture).toMatchObject({ into: `${REPO}/AGENTS.md`, delivered: true });
  });
  it('the node detail leaves only through named fields: no resume token, recovery command, process line or events', async () => {
    const r = (await world().rig.role('2158')).role!;
    const text = JSON.stringify(r);
    for (const leak of ['SECRET-TOKEN', 'resumeToken', 'resumeCommand', 'recoveryGuidance', 'dangerously-skip-permissions', 'identityVerdict', 'recentEvents']) expect(text).not.toContain(leak);
  });
  it('OpenRig HTTP not answering: the seat from the rig spec, no live view', async () => {
    const r = (await world({ http: false }).rig.role('2158')).role!;
    expect(r.seats[0]!.live).toBeUndefined();
    expect(r.seats[0]!.model.value).toBe('claude-opus-5-5');
    // Without OpenRig's order, the spec's: role.md, then the member's files.
    expect(r.seats[0]!.roleDocs.map(e => e.path)).toEqual(['guidance/role.md', 'guidance/scope-front.md']);
  });
});

describe('OpenRig roles: a file', () => {
  it('reads a path the role detail lists: role.md, fragment, a seat startup file, the rig spec, the repository copy', async () => {
    const w = world();
    expect(await w.rig.roleFile('2158', `${LIB}/agents/developer/guidance/role.md`)).toEqual({ content: '# Rôle : développeur\n', size: 23 });
    expect((await w.rig.roleFile('2158', `${LIB}/agents/shared/runtime/claude-settings.fragment.json`)).content).toContain('enabledMcpjsonServers');
    expect((await w.rig.roleFile('2158', `${RIG}/guidance/scope-front.md`)).content).toBe('# Front\n');
    expect((await w.rig.roleFile('2158', `${PKG}/assets/guidance/CULTURE-default.md`)).content).toBe('# Default\n');
    expect((await w.rig.roleFile('2158', `${RIG}/rig.yaml`)).content).toContain('ledge-dev');
    expect((await w.rig.roleFile('2158', `${REPO}/openrig/agents/developer/agent.yaml`)).content).toContain('[tdd]');
    expect((await w.rig.roleFile('2158', `${LIB}/agents/shared/agent.yaml`)).content).toContain('openrig-core');
  });
  it('refuses any other path: a key, CLAUDE.md itself, a relative or dotted path, another role’s file', async () => {
    const w = world();
    for (const p of [`${H}/.ssh/id_ed25519`, `${REPO}/CLAUDE.md`, 'guidance/role.md', `${LIB}/agents/developer/../../../../.ssh/id_ed25519`, `${LIB}/agents/lead/guidance/role.md`])
      expect(await w.rig.roleFile('2158', p)).toEqual({ error: 'not_allowed' });
    expect(await w.rig.roleFile('nope', '/x')).toEqual({ error: 'role_not_found' });
  });
  it('the detail is read once for a burst of files, again once its list is stale', async () => {
    const w = world();
    await w.rig.role('2158');
    const before = w.calls.filter(c => c === 'specs ls --kind agent --json').length;
    await w.rig.roleFile('2158', `${LIB}/agents/developer/guidance/role.md`);
    await w.rig.roleFile('2158', `${RIG}/CULTURE.md`);
    expect(w.calls.filter(c => c === 'specs ls --kind agent --json').length).toBe(before);
  });
  it('a file listed but gone since: missing', async () => {
    const w = world({ files: { [`${RIG}/CULTURE.md`]: undefined as unknown as string } });
    expect(await w.rig.roleFile('2158', `${RIG}/CULTURE.md`)).toEqual({ error: 'missing' });
  });
});

describe('OpenRig roles: pieces', () => {
  it('paths as specs write them', () => {
    expect(specPath('openrig-home:plugins/openrig-core', '/s', H, `${H}/.openrig`)).toBe(`${H}/.openrig/plugins/openrig-core`);
    expect(specPath('~/x', '/s', H, '/o')).toBe(`${H}/x`);
    expect(specPath('guidance/role.md', '/s/lead', H, '/o')).toBe('/s/lead/guidance/role.md');
    expect(importPath('local:../shared', '/s/lead')).toBe('/s/shared/agent.yaml');
    expect(importPath('path:/abs/kit/agent.yaml', '/s')).toBe('/abs/kit/agent.yaml');
    expect(importPath('builtin:x', '/s')).toBeNull();
  });
  it('a managed block is found by its file name', () => {
    expect(hasManagedBlock(CLAUDE, 'CULTURE.md')).toBe(true);
    expect(hasManagedBlock(CLAUDE, 'openrig-seat-skills.md')).toBe(false);
  });
  it('a file that lives nowhere known is an unknown layer', () => {
    const c = { agentDir: '/a', rigRoot: '/r', profileFiles: new Set<string>(), memberFiles: new Set<string>(), podFiles: new Set<string>(), openrigHome: `${H}/.openrig`, rig: 'x', logicalId: 'p.m', podId: 'p' };
    expect(layerOf('/elsewhere', 'f.md', c)).toBe('unknown');
    expect(layerOf(`${H}/.openrig/state/seats/01R/review.qa/codex`, 'openrig-seat-skills.md', c)).toBe('seat');
    expect(layerOf('/r', 'pod.md', { ...c, podFiles: new Set(['pod.md']) })).toBe('pod');
  });
  it('the messages a front sends parse; a path or id that is not one is refused', () => {
    const ok = (m: unknown) => ClientMessageSchema.safeParse(m).success;
    expect(ok({ type: 'openrig.roles', requestId: 'r' })).toBe(true);
    expect(ok({ type: 'openrig.role', requestId: 'r', roleId: 'f95e2928bc86da26' })).toBe(true);
    expect(ok({ type: 'openrig.roleFile', requestId: 'r', roleId: 'f95e', path: '/a/b' })).toBe(true);
    expect(ok({ type: 'openrig.role', requestId: 'r', roleId: '-rf' })).toBe(false);
    expect(ok({ type: 'openrig.roleFile', requestId: 'r', roleId: 'f95e', path: '' })).toBe(false);
  });
});

describe('OpenRig roles: the daemon HTTP read', () => {
  it('goes straight to 127.0.0.1 even with a proxy in the environment; JSON or undefined, never a throw', async () => {
    const saved = { http_proxy: process.env.http_proxy, HTTP_PROXY: process.env.HTTP_PROXY, no_proxy: process.env.no_proxy, NO_PROXY: process.env.NO_PROXY };
    process.env.http_proxy = process.env.HTTP_PROXY = 'http://192.0.2.1:3128'; delete process.env.no_proxy; delete process.env.NO_PROXY;
    const srv = createServer((req, res) => {
      if (req.url === '/api/x') { res.setHeader('content-type', 'application/json'); res.end('{"ok":1}'); }
      else if (req.url === '/api/text') res.end('not json');
      else { res.statusCode = 404; res.end(); }
    });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    try {
      expect(await localGet(port, '/api/x', 2000)).toEqual({ ok: 1 });
      expect(await localGet(port, '/api/missing', 2000)).toBeUndefined();
      expect(await localGet(port, '/api/text', 2000)).toBeUndefined();
    } finally {
      await new Promise(r => srv.close(r));
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
    expect(await localGet(port, '/api/x', 500)).toBeUndefined();
  });
});
