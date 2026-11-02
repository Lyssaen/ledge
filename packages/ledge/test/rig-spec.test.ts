import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { RigLaunchSchema, type RigLaunch } from '@ledge/protocol';
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
      name: 'starter', source: 'builtin', path: `${DIR}/rig.yaml`, summary: 'A Claude Code builder and a Codex reviewer in your repository.', edges: 1,
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
    { kind: 'rig', name: 'mine', sourceType: 'user', sourcePath: '/u/mine/rig.yaml', summary: 'Mine' }
  ]);
  function setup(answers: Record<string, { code: number | null; stdout?: string; stderr?: string }> = {}) {
    const calls: string[][] = [], written = new Map<string, string>(), copied: string[] = [];
    const run: RigRun = async args => { calls.push(args); const key = args.slice(0, 2).join(' '); const a = answers[key] ?? (key === 'specs ls' ? { code: 0, stdout: LS } : { code: 0, stdout: '{}' }); return { code: a.code, stdout: a.stdout ?? '', stderr: a.stderr ?? '' }; };
    const fs = {
      read: async (p: string) => { if (p === `${DIR}/rig.yaml`) return STARTER; if (p === '/u/mine/rig.yaml') return STARTER.replace('name: starter', 'name: mine'); throw new Error('ENOENT'); },
      exists: (p: string) => p === '/w/ledge' || p === '/home/me/w',
      copyDir: async (from: string, to: string) => { copied.push(`${from} -> ${to}`); },
      write: async (p: string, text: string) => { written.set(p, text); }
    };
    return { rig: createOpenRig({ run, fs, home: '/home/me', rigsDir: '/home/me/.ledge/rigs' }), calls, written, copied };
  }
  it('lists the rig specs, the person\'s first, the kernel and agents left out', async () => {
    const { rig } = setup();
    expect((await rig.specs()).specs.map(s => [s.name, s.source])).toEqual([['mine', 'user'], ['starter', 'builtin']]);
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
    expect(calls.filter(c => c[0] === 'up')).toHaveLength(2);
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
