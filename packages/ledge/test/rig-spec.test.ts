import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { RigLaunchSchema, RigSpecSchema, type RigLaunch } from '@ledge/protocol';
import { changesSpec, composeSpec, expandEdge, readSpec, seatIds } from '../src/daemon/rigSpec.js';
import { createOpenRig, readCheck, type RigRun } from '../src/daemon/openrig.js';

// OpenRig 0.6.14's shipped starter (daemon/specs/rigs/launch/starter/rig.yaml).
const STARTER = `version: "0.2"
name: starter
summary: >
  A Claude Code builder and a Codex reviewer in your repository.

culture_file: CULTURE.md

pods:
  - id: dev
    label: Project
    members:
      - id: build
        agent_ref: "local:../../../agents/development/implementer"
        runtime: claude-code
        profile: default
        cwd: "."
        startup:
          files:
            - path: guidance/lead-first-move.md
              delivery_hint: send_text
              required: true
      - id: review
        agent_ref: "local:../../../agents/development/qa"
        runtime: codex
        model: gpt-6-astra
        profile: default
        cwd: "."
    edges:
      - kind: delegates_to
        from: build
        to: review

edges: []
`;
const DIR = '/opt/openrig/daemon/specs/rigs/launch/starter';
const launch = (l: Partial<RigLaunch>): RigLaunch => RigLaunchSchema.parse({ spec: 'starter', cwd: '/w/ledge', name: 'ledge-scale', ...l });

describe('rig specs', () => {
  it('reads a spec\'s roles, harnesses, models and links', () => {
    expect(readSpec(STARTER, { name: 'starter', source: 'builtin', path: `${DIR}/rig.yaml` })).toEqual({
      name: 'starter', source: 'builtin', path: `${DIR}/rig.yaml`, summary: 'A Claude Code builder and a Codex reviewer in your repository.', edges: 1, links: [{ from: 'dev.build', to: 'dev.review', kind: 'delegates_to' }],
      pods: [{ id: 'dev', label: 'Project', members: [{ id: 'build', runtime: 'claude-code', agent: 'implementer' }, { id: 'review', runtime: 'codex', model: 'gpt-6-astra', agent: 'qa' }] }]
    });
    expect(readSpec('name: x\n', { name: 'x', source: 'user', path: '/x' })).toBeNull();
    expect(readSpec(': : :', { name: 'x', source: 'user', path: '/x' })).toBeNull();
  });
  it('seat ids and links: by pairs (the rest to the last) or each to each', () => {
    expect(seatIds('build', 3)).toEqual(['build', 'build-2', 'build-3']);
    expect(expandEdge(['b', 'b-2', 'b-3'], ['r', 'r-2', 'r-3'], 'pairs')).toEqual([['b', 'r'], ['b-2', 'r-2'], ['b-3', 'r-3']]);
    expect(expandEdge(['b', 'b-2', 'b-3'], ['r'], 'pairs')).toEqual([['b', 'r'], ['b-2', 'r'], ['b-3', 'r']]);
    expect(expandEdge(['b', 'b-2'], ['r', 'r-2'], 'all')).toHaveLength(4);
    expect(expandEdge([], ['r'], 'all')).toEqual([]);
  });
  it('3 builders and 3 reviewers: six seats copied from the first, paired links, absolute agents, the new name', () => {
    const { yaml, seats } = composeSpec(parse(STARTER), DIR, launch({ seats: { 'dev.build': 3, 'dev.review': 3 } }));
    expect(seats).toBe(6);
    const d = parse(yaml);
    expect(d.name).toBe('ledge-scale');
    expect(d.culture_file).toBe('CULTURE.md');
    const members = d.pods[0].members;
    expect(members.map((m: { id: string }) => m.id)).toEqual(['build', 'build-2', 'build-3', 'review', 'review-2', 'review-3']);
    expect(members[1]).toMatchObject({ agent_ref: '/opt/openrig/daemon/specs/agents/development/implementer'.replace(/^/, 'path:'), runtime: 'claude-code', startup: { files: [{ path: 'guidance/lead-first-move.md' }] } });
    expect(members[5]).toMatchObject({ runtime: 'codex', model: 'gpt-6-astra' });
    expect(d.pods[0].edges).toEqual([
      { kind: 'delegates_to', from: 'build', to: 'review' },
      { kind: 'delegates_to', from: 'build-2', to: 'review-2' },
      { kind: 'delegates_to', from: 'build-3', to: 'review-3' }
    ]);
  });
  it('a role at 0 leaves with its links; a new harness drops the old one\'s model; a model asked is set', () => {
    const d = parse(composeSpec(parse(STARTER), DIR, launch({ seats: { 'dev.review': 0 } })).yaml);
    expect(d.pods[0].members.map((m: { id: string }) => m.id)).toEqual(['build']);
    expect(d.pods[0].edges).toEqual([]);
    const e = parse(composeSpec(parse(STARTER), DIR, launch({ runtimes: { 'dev.review': 'claude-code' } })).yaml);
    expect(e.pods[0].members[1]).not.toHaveProperty('model');
    expect(e.pods[0].members[1].runtime).toBe('claude-code');
    const f = parse(composeSpec(parse(STARTER), DIR, launch({ models: { 'dev.build': 'opus' } })).yaml);
    expect(f.pods[0].members[0].model).toBe('opus');
  });
  it('only counts, harnesses or models change the spec', () => {
    expect(changesSpec(launch({}))).toBe(false);
    expect(changesSpec(launch({ seats: { 'dev.build': 1 } }))).toBe(false);
    expect(changesSpec(launch({ seats: { 'dev.build': 2 } }))).toBe(true);
    expect(changesSpec(launch({ models: { 'dev.build': 'opus' } }))).toBe(true);
  });
  it('a role or a model that rig would read as a flag never passes the protocol', () => {
    expect(RigLaunchSchema.safeParse({ spec: 'starter', cwd: '/w', name: '--x' }).success).toBe(false);
    expect(RigLaunchSchema.safeParse({ spec: 'starter', cwd: '/w', name: 'x', seats: { '-dev.build': 2 } }).success).toBe(false);
    expect(RigLaunchSchema.safeParse({ spec: 'starter', cwd: '/w', name: 'x', models: { 'dev.build': '--danger' } }).success).toBe(false);
  });
});

describe('launching a rig', () => {
  const LS = JSON.stringify([
    { kind: 'agent', name: 'qa', sourceType: 'builtin', sourcePath: '/a.yaml' },
    { kind: 'rig', name: 'starter', sourceType: 'builtin', resolvedSourcePath: `${DIR}/rig.yaml` },
    { kind: 'rig', name: 'kernel', sourceType: 'builtin', sourcePath: '/k.yaml' },
    { kind: 'rig', name: 'mine', sourceType: 'user', sourcePath: '/u/mine/rig.yaml', summary: 'Mine' },
    // OpenRig 0.7.7 names the person's own specs `user_file`.
    { kind: 'rig', name: 'alpha', sourceType: 'user_file', sourcePath: '/u/alpha/rig.yaml' }
  ]);
  function setup(answers: Record<string, { code: number | null; stdout?: string; stderr?: string }> = {}) {
    const calls: string[][] = [], written = new Map<string, string>(), copied: string[] = [];
    const run: RigRun = async args => { calls.push(args); const key = args.slice(0, 2).join(' '); const a = answers[key] ?? (key === 'specs ls' ? { code: 0, stdout: LS } : { code: 0, stdout: '{}' }); return { code: a.code, stdout: a.stdout ?? '', stderr: a.stderr ?? '' }; };
    const fs = {
      read: async (p: string) => { if (p === `${DIR}/rig.yaml`) return STARTER; if (p === '/u/mine/rig.yaml') return STARTER.replace('name: starter', 'name: mine'); if (p === '/u/alpha/rig.yaml') return STARTER.replace('name: starter', 'name: alpha'); throw new Error('ENOENT'); },
      exists: (p: string) => p === '/w/ledge' || p === '/home/me/w',
      copyDir: async (from: string, to: string) => { copied.push(`${from} -> ${to}`); },
      write: async (p: string, text: string) => { written.set(p, text); }
    };
    return { rig: createOpenRig({ run, fs, home: '/home/me', rigsDir: '/home/me/.ledge/rigs' }), calls, written, copied };
  }
  it('lists the rig specs, the person\'s first, the kernel and agents left out', async () => {
    const { rig } = setup();
    expect((await rig.specs()).specs.map(s => [s.name, s.source])).toEqual([['alpha', 'user'], ['mine', 'user'], ['starter', 'builtin']]);
  });
  it('a stopped daemon cannot list them', async () => {
    const { rig } = setup({ 'specs ls': { code: 1, stderr: 'Error: Daemon not running.\n' } });
    expect(await rig.specs()).toEqual({ specs: [], error: 'daemon_stopped' });
  });
  it('an unchanged spec under its own name launches from the library, in the folder asked', async () => {
    const { rig, calls, written } = setup();
    const r = await rig.launch(launch({ cwd: '~/w', name: 'starter' }));
    expect(r).toMatchObject({ ok: true, plan: false, seats: 2, commands: ['rig up starter --cwd /home/me/w --yes'] });
    expect(calls.at(-1)).toEqual(['up', 'starter', '--cwd', '/home/me/w', '--yes', '--json']);
    expect(written.size).toBe(0);
  });
  it('another name is a composed copy: OpenRig names a rig after its spec', async () => {
    const { rig, written } = setup();
    const r = await rig.launch(launch({ name: 'alpha' }));
    expect(r.commands).toEqual(['rig up /home/me/.ledge/rigs/alpha/rig.yaml --cwd /w/ledge --yes']);
    expect(parse(written.get('/home/me/.ledge/rigs/alpha/rig.yaml')!).name).toBe('alpha');
  });
  it('a changed spec is composed beside its folder\'s copy, checked with --plan, and kept in the library when asked', async () => {
    const { rig, calls, written, copied } = setup();
    const check = await rig.launch(launch({ seats: { 'dev.build': 3, 'dev.review': 3 }, plan: true }));
    expect(check).toMatchObject({ ok: true, plan: true, seats: 6, commands: ['rig up /home/me/.ledge/rigs/ledge-scale/rig.yaml --cwd /w/ledge --plan'] });
    expect(copied).toEqual([`${DIR} -> /home/me/.ledge/rigs/ledge-scale`]);
    expect(parse(written.get('/home/me/.ledge/rigs/ledge-scale/rig.yaml')!).pods[0].members).toHaveLength(6);
    const go = await rig.launch(launch({ seats: { 'dev.build': 3, 'dev.review': 3 }, save: true }));
    expect(go.commands).toEqual(['rig up /home/me/.ledge/rigs/ledge-scale/rig.yaml --cwd /w/ledge --yes', 'rig specs add /home/me/.ledge/rigs/ledge-scale']);
    expect(calls.filter(c => c[0] === 'up' && c[1] !== '--help')).toHaveLength(2);
  });
  it('refuses a missing folder or spec, and says why rig failed', async () => {
    const { rig } = setup({ 'up starter': { code: 1, stdout: '{"ok":false,"error":{"code":"x","message":"rig starter is already running"}}' } });
    expect((await rig.launch(launch({ cwd: '/nowhere' }))).error).toBe('cwd_missing');
    expect((await rig.launch(launch({ cwd: 'relative/path' }))).error).toBe('cwd_missing');
    expect((await rig.launch(launch({ spec: 'nope' }))).error).toBe('spec_not_found');
    expect(await rig.launch(launch({ name: 'starter' }))).toMatchObject({ ok: false, error: 'rig starter is already running' });
  });
});

describe('the plan check', () => {
  it('reads what rig up --plan --json concluded (OpenRig 0.6.14)', () => {
    const out = JSON.stringify({ runId: '01M', status: 'planned', stages: [], errors: [], warnings: ['dev.build: permission_policy absent; launch_posture=floor'] });
    expect(readCheck(out)).toEqual({ status: 'planned', errors: [], warnings: ['dev.build: permission_policy absent; launch_posture=floor'] });
    expect(readCheck(JSON.stringify({ status: 'blocked', errors: [{ code: 'x', message: 'cwd inside OpenRig' }] }))?.errors).toEqual(['cwd inside OpenRig']);
    expect(readCheck('not json')).toBeUndefined();
  });
});

// What `rig spec show --json` printed for a running starter (OpenRig 0.6.14 / 0.7.7: camelCase, agents relative to the rig's folder).
const SHOW = {
  version: '0.2', name: 'starter', permissionPolicy: 'builtin:auto', env: { HTTP_PROXY: 'http://p:3128' },
  pods: [{ id: 'dev', label: 'Project', members: [
    { id: 'build', agentRef: 'local:../../../agents/development/implementer', profile: 'default', runtime: 'claude-code', cwd: '/w/ledge', restorePolicy: 'resume_if_possible', startup: { files: [{ path: 'guidance/lead-first-move.md', deliveryHint: 'send_text', required: true }] }, env: { MY_VAR: '1' } },
    { id: 'review', agentRef: 'local:../../../agents/development/qa', profile: 'default', runtime: 'codex', model: 'gpt-6-astra', cwd: '/w/ledge' }
  ], edges: [{ kind: 'delegates_to', from: 'build', to: 'review' }] }],
  edges: []
};
const nodes = (...ids: string[]) => ids.map(logicalId => ({ logicalId }));

describe('changing a running rig\'s seats', () => {
  it('the plan: copies under the next free number, the last copies removed first, the first seat only at 0', async () => {
    const { seatPlan, roleOf } = await import('@ledge/protocol');
    expect(roleOf('dev.build-3')).toBe('dev.build');
    expect(seatPlan(nodes('dev.build', 'dev.review'), { 'dev.build': 3, 'dev.review': 3 })).toEqual({
      add: [{ role: 'dev.build', pod: 'dev', id: 'build-2', from: 'dev.build' }, { role: 'dev.build', pod: 'dev', id: 'build-3', from: 'dev.build' },
        { role: 'dev.review', pod: 'dev', id: 'review-2', from: 'dev.review' }, { role: 'dev.review', pod: 'dev', id: 'review-3', from: 'dev.review' }],
      remove: []
    });
    expect(seatPlan(nodes('dev.build', 'dev.build-2', 'dev.build-4'), { 'dev.build': 4 }).add.map(a => a.id)).toEqual(['build-5']);
    expect(seatPlan(nodes('dev.build', 'dev.build-2', 'dev.build-3'), { 'dev.build': 1 }).remove).toEqual(['dev.build-3', 'dev.build-2']);
    expect(seatPlan(nodes('dev.build'), { 'dev.build': 0, 'dev.qa': 2 }).remove).toEqual(['dev.build']);
  });
  it('a fragment in snake_case, the env names kept, the agent made absolute from the rig\'s folder', async () => {
    const { fragmentOf, memberOf } = await import('../src/daemon/rigSpec.js');
    const f = fragmentOf(memberOf(SHOW, 'dev', 'build')!, 'build-2', DIR)!;
    expect(f).toMatchObject({ id: 'build-2', agent_ref: 'path:/opt/openrig/daemon/specs/agents/development/implementer', restore_policy: 'resume_if_possible', env: { MY_VAR: '1' }, startup: { files: [{ delivery_hint: 'send_text' }] } });
    expect(fragmentOf(memberOf(SHOW, 'dev', 'build')!, 'build-2', null)).toBeNull();
    expect(memberOf(SHOW, 'dev', 'nope')).toBeNull();
  });
  it('the links of the roles that grew, by pairs', async () => {
    const { linksFor } = await import('../src/daemon/rigSpec.js');
    const after = new Map([['dev.build', ['dev.build', 'dev.build-2']], ['dev.review', ['dev.review', 'dev.review-2']]]);
    expect(linksFor(SHOW, after, new Set(['dev.build']), 'pairs')).toEqual([
      { from: 'dev.build', to: 'dev.review', kind: 'delegates_to' }, { from: 'dev.build-2', to: 'dev.review-2', kind: 'delegates_to' }
    ]);
    expect(linksFor(SHOW, after, new Set(['dev.qa']), 'pairs')).toEqual([]);
  });
});

describe('OpenRig 0.7: rig up --name and rig edge', () => {
  const PS = JSON.stringify([{ rigId: 'R1', name: 'starter', nodeCount: 2, runningCount: 2, status: 'running', lifecycleState: 'running', attentionCount: 0 }]);
  const NODES = JSON.stringify([
    { rigId: 'R1', logicalId: 'dev.build', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', agentActivity: { state: 'idle' } },
    { rigId: 'R1', logicalId: 'dev.review', canonicalSessionName: 'dev-review@starter', runtime: 'codex', agentActivity: { state: 'idle' } }
  ]);
  const LS = JSON.stringify([{ kind: 'rig', name: 'starter', sourceType: 'builtin', resolvedSourcePath: `${DIR}/rig.yaml` }]);
  function rig(version: '0.6.14' | '0.7.7') {
    const calls: string[][] = [], written = new Map<string, string>();
    const v7 = version === '0.7.7';
    const answer = (a: string[]): string => {
      const k = a.slice(0, 2).join(' ');
      if (k === '--version') return `${version} (x)`;
      if (k === 'up --help') return v7 ? '  --name <rig>  Launch the spec as…' : '  --existing';
      if (k === 'help') return v7 ? '  edge   Add or remove typed edges\n' : '  remove  Remove a node\n';
      if (k === 'status --json') return JSON.stringify({ daemon: { state: 'running', reachable: true }, kernel: { state: 'ready' } });
      if (k === 'ps --json') return PS;
      if (k === 'ps --nodes') return NODES;
      if (k === 'specs ls') return LS;
      if (k === 'spec show') return JSON.stringify(SHOW);
      return '{}';
    };
    const run: RigRun = async args => { calls.push(args); return { code: 0, stdout: answer(args), stderr: '' }; };
    const fs = { read: async (p: string) => { if (p === `${DIR}/rig.yaml`) return STARTER; throw new Error('ENOENT'); }, exists: (p: string) => p === '/w/ledge', copyDir: async () => {}, write: async (p: string, t: string) => { written.set(p, t); } };
    return { rig: createOpenRig({ run, fs, home: '/home/me', rigsDir: '/r' }), calls, written };
  }
  it('0.7 launches the library spec under another name with --name, and remembers where it came from', async () => {
    const { rig: r, calls, written } = rig('0.7.7');
    const res = await r.launch(launch({ name: 'alpha' }));
    expect(res.commands).toEqual(['rig up starter --name alpha --cwd /w/ledge --yes']);
    expect(calls.some(c => c[0] === 'up' && c[1] === 'starter')).toBe(true);
    expect(JSON.parse(written.get('/r/alpha/source.json')!)).toEqual({ spec: 'starter', path: `${DIR}/rig.yaml` });
  });
  it('0.6 composes a copy for another name, as before', async () => {
    const { rig: r } = rig('0.6.14');
    expect((await r.launch(launch({ name: 'alpha' }))).commands).toEqual(['rig up /r/alpha/rig.yaml --cwd /w/ledge --yes']);
  });
  it('0.7 adds the seats, links them by pairs, then snapshots', async () => {
    const { rig: r, written } = rig('0.7.7');
    const res = await r.reseat('starter', { 'dev.build': 2, 'dev.review': 2 });
    expect(res).toMatchObject({ ok: true, added: ['dev.build-2', 'dev.review-2'], removed: [], links: 2 });
    expect(res.commands).toEqual([
      `rig add R1 dev /r/starter/seats/dev.build-2.json --rig-root ${DIR}`,
      `rig add R1 dev /r/starter/seats/dev.review-2.json --rig-root ${DIR}`,
      'rig edge add R1 dev.build dev.review --kind delegates_to',
      'rig edge add R1 dev.build-2 dev.review-2 --kind delegates_to',
      'rig snapshot R1'
    ]);
    expect(JSON.parse(written.get('/r/starter/seats/dev.review-2.json')!)).toMatchObject({ id: 'review-2', runtime: 'codex', model: 'gpt-6-astra' });
  });
  it('0.6 adds the seats without links, and says so', async () => {
    const { rig: r } = rig('0.6.14');
    const res = await r.reseat('starter', { 'dev.build': 2 });
    expect(res).toMatchObject({ ok: true, added: ['dev.build-2'], linksUnsupported: true });
    expect(res.commands.some(c => c.startsWith('rig edge'))).toBe(false);
  });
  it('nothing to change, or a rig that does not run', async () => {
    const { rig: r, calls } = rig('0.7.7');
    expect(await r.reseat('starter', { 'dev.build': 1 })).toEqual({ ok: true, commands: [], added: [], removed: [] });
    expect((await r.reseat('nope', { 'dev.build': 2 })).error).toBe('rig_not_running');
    expect(calls.some(c => c[0] === 'add')).toBe(false);
  });
});

describe('permissions at launch', () => {
  it('the rig\'s policy and a role\'s are written as builtin policies; the spec\'s are read back', () => {
    const d = parse(composeSpec(parse(STARTER), DIR, launch({ policy: 'auto', policies: { 'dev.review': 'yolo' } })).yaml);
    expect(d.permission_policy).toBe('builtin:auto');
    expect(d.pods[0].members[0]).not.toHaveProperty('permission_policy');
    expect(d.pods[0].members[1].permission_policy).toBe('builtin:yolo');
    expect(changesSpec(launch({ policy: 'auto' }))).toBe(true);
    const spec = readSpec(STARTER.replace('culture_file:', 'permission_policy: builtin:standard\nculture_file:'), { name: 'starter', source: 'builtin', path: '/x' });
    expect(spec?.policy).toBe('builtin:standard');
    expect(RigLaunchSchema.safeParse({ spec: 'starter', cwd: '/w', name: 'x', policy: 'root' }).success).toBe(false);
  });
  it('accepting the first-launch warnings adds --non-interruptive', async () => {
    const calls: string[][] = [];
    const run: RigRun = async args => { calls.push(args); return { code: 0, stdout: args[0] === 'specs' ? JSON.stringify([{ kind: 'rig', name: 'starter', sourceType: 'builtin', resolvedSourcePath: `${DIR}/rig.yaml` }]) : '{}', stderr: '' }; };
    const fs = { read: async () => STARTER, exists: () => true, copyDir: async () => {}, write: async () => {} };
    const r = await createOpenRig({ run, fs, home: '/h', rigsDir: '/r' }).launch(launch({ name: 'starter', policy: 'yolo', nonInterruptive: true }));
    expect(r.commands[0]).toBe('rig up /r/starter/rig.yaml --cwd /w/ledge --non-interruptive --yes');
  });
});

describe('where a spec comes from', () => {
  it('builtin and builtin_* are OpenRig’s, every other kind (user, user_file, a new one) the person’s', async () => {
    const { specSource } = await import('../src/daemon/openrig.js');
    expect(['builtin', 'builtin_pack', 'user', 'user_file', 'shared_dir', undefined, 42].map(specSource)).toEqual(['builtin', 'builtin', 'user', 'user', 'user', 'user', 'user']);
  });
});

describe('a spec\'s links', () => {
  const entry = { name: 'x', source: 'user', path: '/x/rig.yaml' };
  it('starter: a pod\'s edge becomes a link between its members, prefixed with the pod', () => {
    const spec = readSpec(STARTER, { name: 'starter', source: 'builtin', path: `${DIR}/rig.yaml` })!;
    expect(spec.links).toEqual([{ from: 'dev.build', to: 'dev.review', kind: 'delegates_to' }]);
    expect(spec.edges).toBe(1);
  });
  it('a kernel-like spec: pod edges first, then the top-level ones as written; malformed entries skipped', () => {
    const yaml = `pods:
  - id: advisor
    members: [{ id: lead, runtime: claude-code, agent_ref: "builtin:x/advisor" }]
  - id: queue
    members: [{ id: worker, runtime: codex, agent_ref: "builtin:x/worker" }, { id: other, runtime: codex, agent_ref: "builtin:x/o" }]
    edges:
      - { kind: collaborates_with, from: worker, to: other }
      - { kind: delegates_to, from: worker }
edges:
  - { kind: delegates_to, from: advisor.lead, to: queue.worker }
  - { kind: escalates_to, from: queue.worker, to: advisor.lead }
  - 42
`;
    const spec = readSpec(yaml, entry)!;
    expect(spec.links).toEqual([
      { from: 'queue.worker', to: 'queue.other', kind: 'collaborates_with' },
      { from: 'advisor.lead', to: 'queue.worker', kind: 'delegates_to' },
      { from: 'queue.worker', to: 'advisor.lead', kind: 'escalates_to' }
    ]);
    expect(RigSpecSchema.parse(spec)).toEqual(spec);
  });
  it('a spec Ledge composed keeps its links, expanded', () => {
    const { yaml } = composeSpec(parse(STARTER), DIR, launch({ seats: { 'dev.build': 2, 'dev.review': 2 } }));
    expect(readSpec(yaml, entry)!.links).toEqual([
      { from: 'dev.build', to: 'dev.review', kind: 'delegates_to' }, { from: 'dev.build-2', to: 'dev.review-2', kind: 'delegates_to' }
    ]);
  });
});
