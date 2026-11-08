import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OpenRigActionSchema, OpenRigPermissionListSchema, OpenRigPermissionsSchema, rigCommands, showRigCommand } from '@ledge/protocol';
import { createOpenRig, readSeatPermission, type RigRun } from '../src/daemon/openrig.js';

const read = (f: string) => readFileSync(new URL(`./fixtures/openrig-0.7/${f}`, import.meta.url), 'utf8');
const ADVISOR = JSON.parse(read('seat-status-advisor.json')) as unknown;

describe('readSeatPermission', () => {
  it('reads the effective mode, its source, the launch posture, the selection and the summary of advisor-lead@kernel', () => {
    expect(readSeatPermission(ADVISOR)).toEqual({
      mode: 'acceptEdits', source: 'kernel_default', posture: 'floor', selection: 'inherit', policySource: 'kernel_default',
      summary: 'Next launch: --permission-mode acceptEdits, from the kernel\'s operational default; OpenRig adds 50 allowances.'
    });
  });
  const acct = (source: string, summary: string) => ({ permissions: { selectionState: 'inherit', effective: { effectiveMode: 'acceptEdits', source: 'member_spec', launchPosture: 'floor' }, account: { source, summary } } });
  it('reads the member policy OpenRig\'s summary names, with the account source', () => {
    expect(readSeatPermission(ADVISOR)).not.toHaveProperty('policy');
    expect(readSeatPermission(ADVISOR)).toMatchObject({ policySource: 'kernel_default' });
    expect(readSeatPermission(acct('member_policy', 'Next launch: --permission-mode acceptEdits, from the member\'s policy builtin:standard; OpenRig adds 40 allowances.'))).toMatchObject({ policy: 'builtin:standard', policySource: 'member_policy' });
    expect(readSeatPermission(acct('member_policy', 'Next launch: floor, from the member\'s policy none.'))).toMatchObject({ policy: 'none' });
  });
  it('gives no policy for a rig policy, the team default, or a summary that does not match', () => {
    expect(readSeatPermission(acct('rig_policy', 'Next launch: x, from the rig\'s policy builtin:open.'))).toMatchObject({ policySource: 'rig_policy' });
    expect(readSeatPermission(acct('rig_policy', 'Next launch: x, from the rig\'s policy builtin:open.'))).not.toHaveProperty('policy');
    expect(readSeatPermission(acct('team_default', 'Next launch: x, from the team default.'))).not.toHaveProperty('policy');
    expect(readSeatPermission(acct('member_policy', 'Next launch: x, from the member\'s policy ./custom.yaml.'))).not.toHaveProperty('policy');
    expect(readSeatPermission(acct('member_policy', 'Next launch: x, from the member\'s policy builtin:standard.'))?.policy).toBe('builtin:standard');
  });
  it('leaves out what OpenRig does not say, and is undefined for what is not a status', () => {
    expect(readSeatPermission({ permissions: { selectionState: 'seat', effective: { effectiveMode: null, source: 'seat' } } })).toEqual({ source: 'seat', selection: 'seat' });
    expect(readSeatPermission({})).toBeUndefined();
    expect(readSeatPermission('nope')).toBeUndefined();
    expect(readSeatPermission(null)).toBeUndefined();
  });
});

describe('rig.permissions in rigCommands and its schema', () => {
  const a = { kind: 'rig.permissions' as const, rig: 'ledge-dev', mode: 'floor' as const, seats: ['pilot-lead@ledge-dev', 'dev-front@ledge-dev'] };
  it('one seat set-permissions per seat, in order, with the reason Ledge', () => {
    expect(rigCommands(a)).toEqual([
      ['seat', 'set-permissions', 'pilot-lead@ledge-dev', '--mode', 'floor', '--reason', 'Ledge', '--operator', 'ledge@external', '--json'],
      ['seat', 'set-permissions', 'dev-front@ledge-dev', '--mode', 'floor', '--reason', 'Ledge', '--operator', 'ledge@external', '--json']
    ]);
    expect(showRigCommand(rigCommands(a)[0]!)).toBe('rig seat set-permissions pilot-lead@ledge-dev --mode floor --reason Ledge --operator ledge@external');
  });
  it('refuses a seat of another rig, an empty list, a bad mode', () => {
    expect(OpenRigActionSchema.safeParse(a).success).toBe(true);
    expect(OpenRigActionSchema.safeParse({ ...a, seats: ['pilot-lead@ledge-dev', 'dev-front@other'] }).success).toBe(false);
    expect(OpenRigActionSchema.safeParse({ ...a, seats: [] }).success).toBe(false);
    expect(OpenRigActionSchema.safeParse({ ...a, mode: 'yolo' }).success).toBe(false);
    expect(OpenRigActionSchema.safeParse({ kind: 'rig.start', rig: 'x' }).success).toBe(true);
  });
  it('the messages parse', () => {
    expect(OpenRigPermissionsSchema.safeParse({ type: 'openrig.permissions', requestId: 'p', rig: 'a' }).success).toBe(true);
    expect(OpenRigPermissionListSchema.safeParse({ type: 'openrig.permissionList', requestId: 'p', rig: 'a', policy: 'builtin:auto',
      seats: [{ logicalId: 'dev.build', session: 'dev-build@a', mode: 'acceptEdits', source: 'seat', posture: 'floor', selection: 'inherit', summary: 's' }, { logicalId: 'dev.x', session: 'dev-x@a', error: 'boom' }] }).success).toBe(true);
  });
});

const NODES = ['pilot.lead', 'dev.front', 'dev.back', 'dev.test', 'dev.docs'].map(l => ({
  rigId: '01R', rigName: 'ledge-dev', logicalId: l, canonicalSessionName: `${l.replace('.', '-')}@ledge-dev`, runtime: 'claude-code', sessionStatus: 'running', lifecycleState: 'running', agentActivity: { state: 'idle' }
}));

function world(over: { nodes?: unknown[]; delay?: number; fail?: string[]; daemon?: 'running' | 'stopped'; spec?: string | null; installed?: boolean; files?: Record<string, string>; library?: { name: string; path: string }[] } = {}) {
  const calls: string[] = [];
  let clock = 1_000_000, inFlight = 0, peak = 0;
  const ok = (j: unknown) => ({ code: 0, stdout: JSON.stringify(j), stderr: '' });
  const run: RigRun = async args => {
    const a = args.join(' '); calls.push(a);
    if (over.installed === false) return { code: null, stdout: '', stderr: 'rig: command not found' };
    if (a === 'status --json') return ok({ daemon: { state: over.daemon ?? 'running', reachable: (over.daemon ?? 'running') === 'running', port: 7433 }, kernel: { state: 'ready' } });
    if (a === '--version') return { code: 0, stdout: '0.7.7\n', stderr: '' };
    if (a === 'specs ls --json') return ok((over.library ?? []).map(l => ({ kind: 'rig', name: l.name, sourceType: 'user_file', resolvedSourcePath: l.path })));
    if (a === 'ps --json') return ok([{ rigId: '01R', name: 'ledge-dev', nodeCount: 5, runningCount: 5, status: 'running', lifecycleState: 'running' }]);
    if (a === 'ps --nodes -A --json') return ok(over.nodes ?? NODES);
    if (args[0] === 'seat' && args[1] === 'status') {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, over.delay ?? 5));
      inFlight--;
      if (over.fail?.includes(args[2]!)) return { code: 1, stdout: '', stderr: `seat ${args[2]} not found\n` };
      return { code: 0, stdout: JSON.stringify(ADVISOR), stderr: '' };
    }
    if (args[0] === 'seat' && args[1] === 'set-permissions') return { code: 0, stdout: '{}', stderr: '' };
    return { code: 1, stdout: '', stderr: `unexpected ${a}` };
  };
  const files: Record<string, string> = { ...(over.spec ? { '/h/.ledge/rigs/ledge-dev/rig.yaml': over.spec } : {}), ...over.files };
  const fs = { read: async (p: string) => { if (p in files) return files[p]!; throw new Error('ENOENT'); }, exists: (p: string) => p in files, copyDir: async () => {}, write: async () => {} };
  const roleIo = { read: async (p: string) => files[p] ?? null, stat: async () => null, head: async () => null };
  const rig = createOpenRig({ run, fs, roleIo, home: '/h', rigsDir: '/h/.ledge/rigs', openrigHome: '/h/.openrig', now: () => clock, http: async () => undefined });
  const statuses = () => calls.filter(c => c.startsWith('seat status'));
  return { rig, calls, statuses, peak: () => peak, tick: (ms: number) => { clock += ms; } };
}

describe('OpenRig permissions', () => {
  it('one rig seat status per seat, two at a time at most, in the seats\' order', async () => {
    const w = world({ delay: 15 });
    const r = await w.rig.permissions('ledge-dev');
    expect(r.error).toBeUndefined();
    expect(w.statuses()).toEqual(NODES.map(n => `seat status ${n.canonicalSessionName} --json`));
    expect(w.peak()).toBe(2);
    expect(r.seats!.map(s => s.session)).toEqual(NODES.map(n => n.canonicalSessionName));
    expect(r.seats![0]).toEqual({ logicalId: 'pilot.lead', session: 'pilot-lead@ledge-dev', mode: 'acceptEdits', source: 'kernel_default', posture: 'floor', selection: 'inherit', policySource: 'kernel_default', summary: expect.stringContaining('acceptEdits') });
    expect(OpenRigPermissionListSchema.safeParse({ type: 'openrig.permissionList', requestId: 'p', rig: 'ledge-dev', seats: r.seats }).success).toBe(true);
  });
  it('a seat whose status fails is told with what is known and its error; the others are read', async () => {
    const w = world({ fail: ['dev-back@ledge-dev'] });
    const r = await w.rig.permissions('ledge-dev');
    expect(r.error).toBeUndefined();
    expect(r.seats).toHaveLength(5);
    expect(r.seats![2]).toEqual({ logicalId: 'dev.back', session: 'dev-back@ledge-dev', error: 'seat dev-back@ledge-dev not found' });
    expect(r.seats![3]!.mode).toBe('acceptEdits');
  });
  it('error vocabulary: unknown_rig, daemon_stopped, not_installed', async () => {
    expect(await world().rig.permissions('nope')).toEqual({ error: 'unknown_rig' });
    expect(await world({ daemon: 'stopped' }).rig.permissions('ledge-dev')).toEqual({ error: 'daemon_stopped' });
    expect(await world({ installed: false }).rig.permissions('ledge-dev')).toEqual({ error: 'not_installed' });
  });
  it('is read once for 30 s, and again after an action on the rig, or after 30 s', async () => {
    const w = world();
    await w.rig.permissions('ledge-dev');
    w.tick(29_000);
    await w.rig.permissions('ledge-dev');
    expect(w.statuses()).toHaveLength(5);
    expect(await w.rig.act({ kind: 'rig.permissions', rig: 'ledge-dev', mode: 'auto', seats: ['pilot-lead@ledge-dev'] })).toMatchObject({ ok: true });
    await w.rig.permissions('ledge-dev');
    expect(w.statuses()).toHaveLength(10);
    w.tick(31_000);
    await w.rig.permissions('ledge-dev');
    expect(w.statuses()).toHaveLength(15);
  });
  it('a failed read is not kept', async () => {
    const w = world({ daemon: 'stopped' });
    await w.rig.permissions('ledge-dev'); await w.rig.permissions('ledge-dev');
    expect(w.statuses()).toEqual([]);
  });
  it('policy: the rig\'s permission_policy when Ledge knows its spec, absent otherwise', async () => {
    const yaml = 'name: ledge-dev\npermission_policy: builtin:auto\npods:\n  - id: dev\n    members:\n      - id: front\n        agent_ref: local:agents/front\n';
    expect((await world({ spec: yaml }).rig.permissions('ledge-dev')).policy).toBe('builtin:auto');
    const none = await world().rig.permissions('ledge-dev');
    expect(none.policy).toBeUndefined();
    expect('policy' in none).toBe(false);
    expect((await world({ spec: 'name: ledge-dev\npods:\n  - id: dev\n    members:\n      - id: front\n        agent_ref: local:agents/front\n' }).rig.permissions('ledge-dev')).policy).toBeUndefined();
  });
  it('policy: the spec file itself, never a guessed sibling: a library folder with two spec files, a marker naming a file that is not rig.yaml', async () => {
    const spec = (n: string, pol: string) => `name: ${n}\npermission_policy: ${pol}\npods:\n  - id: dev\n    members:\n      - id: front\n        agent_ref: local:agents/front\n`;
    const folder = { '/lib/a.yaml': spec('other', 'builtin:yolo'), '/lib/b.yaml': spec('ledge-dev', 'builtin:auto'), '/lib/rig.yaml': spec('third', 'builtin:safe') };
    expect((await world({ files: folder, library: [{ name: 'ledge-dev', path: '/lib/b.yaml' }] }).rig.permissions('ledge-dev')).policy).toBe('builtin:auto');
    const marked = { ...folder, '/h/.ledge/rigs/ledge-dev/source.json': JSON.stringify({ spec: 'ledge-dev', path: '/lib/b.yaml' }) };
    expect((await world({ files: marked }).rig.permissions('ledge-dev')).policy).toBe('builtin:auto');
    // Not known as a spec file (the folder holds only others): absent, not a neighbour's.
    expect((await world({ files: { '/lib/a.yaml': folder['/lib/a.yaml'] } }).rig.permissions('ledge-dev')).policy).toBeUndefined();
  });
});

describe('rig.permissions act', () => {
  it('stops at the first seat that fails and says how many went through', async () => {
    const ran: string[] = [];
    const run: RigRun = async args => {
      const a = args.join(' ');
      if (args[0] === 'seat') { ran.push(a); return args[2] === 'b-x@r' ? { code: 1, stdout: '', stderr: 'seat b-x@r: no such seat\n' } : { code: 0, stdout: '{}', stderr: '' }; }
      return { code: 1, stdout: '', stderr: '' };
    };
    const rig = createOpenRig({ run });
    const r = await rig.act({ kind: 'rig.permissions', rig: 'r', mode: 'floor', seats: ['a-x@r', 'b-x@r', 'c-x@r'] });
    expect(ran).toHaveLength(2);
    expect(r).toMatchObject({ ok: false, error: 'seat b-x@r: no such seat', completed: 1 });
    expect(r.commands).toEqual(['a-x@r', 'b-x@r', 'c-x@r'].map(s => `rig seat set-permissions ${s} --mode floor --reason Ledge --operator ledge@external`));
  });
});

describe('rig.policy', () => {
  const a = { kind: 'rig.policy' as const, rig: 'dev', policy: 'standard' as const, seats: ['a@dev', 'b@dev'] };
  it('per seat: inherit the explicit mode, then record the policy', () => {
    expect(rigCommands(a)).toEqual([
      ['seat', 'set-permissions', 'a@dev', '--mode', 'inherit', '--reason', 'Ledge', '--operator', 'ledge@external', '--json'],
      ['policy', 'apply', 'standard', '--seat', 'a@dev', '--reason', 'Ledge', '--operator', 'ledge@external', '--json'],
      ['seat', 'set-permissions', 'b@dev', '--mode', 'inherit', '--reason', 'Ledge', '--operator', 'ledge@external', '--json'],
      ['policy', 'apply', 'standard', '--seat', 'b@dev', '--reason', 'Ledge', '--operator', 'ledge@external', '--json']
    ]);
    expect(showRigCommand(rigCommands(a)[1]!)).toBe('rig policy apply standard --seat a@dev --reason Ledge --operator ledge@external');
  });
  it('spec: per seat, builtin: stripped; without a map the preview shows <spec>, never none', () => {
    const s = { ...a, policy: 'spec' as const, seats: ['a@dev', 'b@dev'] };
    const who = ['--reason', 'Ledge', '--operator', 'ledge@external'];
    expect(rigCommands(s, { 'a@dev': 'builtin:yolo', 'b@dev': 'none' }).filter(c => c[0] === 'policy')).toEqual([['policy', 'apply', 'yolo', '--seat', 'a@dev', ...who, '--json'], ['policy', 'apply', 'none', '--seat', 'b@dev', ...who, '--json']]);
    expect(rigCommands(s).filter(c => c[0] === 'policy').map(c => c[2])).toEqual(['<spec>', '<spec>']);
  });
  it('the schema refuses a seat of another rig, an empty list, an unknown policy', () => {
    expect(OpenRigActionSchema.safeParse(a).success).toBe(true);
    expect(OpenRigActionSchema.safeParse({ ...a, policy: 'spec' }).success).toBe(true);
    expect(OpenRigActionSchema.safeParse({ ...a, seats: ['a@dev', 'b@other'] }).success).toBe(false);
    expect(OpenRigActionSchema.safeParse({ ...a, seats: [] }).success).toBe(false);
    expect(OpenRigActionSchema.safeParse({ ...a, policy: 'none' }).success).toBe(false);
    expect(OpenRigActionSchema.safeParse({ ...a, policy: 'loose' }).success).toBe(false);
  });
  const nodes = [['dev.front', 'a@dev'], ['dev.back-2', 'b@dev'], ['dev.docs', 'c@dev']].map(([l, session]) => ({ rigId: '01D', rigName: 'dev', logicalId: l, canonicalSessionName: session, runtime: 'claude-code', sessionStatus: 'running', lifecycleState: 'running', agentActivity: { state: 'idle' } }));
  const mk = (spec: string | null, failOn?: string) => {
    const ran: string[] = [];
    const files: Record<string, string> = spec ? { '/h/.ledge/rigs/dev/rig.yaml': spec } : {};
    const ok = (j: unknown) => ({ code: 0, stdout: JSON.stringify(j), stderr: '' });
    const run: RigRun = async args => {
      const x = args.join(' ');
      if (x === 'status --json') return ok({ daemon: { state: 'running', reachable: true, port: 7433 }, kernel: { state: 'ready' } });
      if (x === '--version') return { code: 0, stdout: '0.7.7\n', stderr: '' };
      if (x === 'specs ls --json') return ok([]);
      if (x === 'ps --json') return ok([{ rigId: '01D', name: 'dev', nodeCount: 3, runningCount: 3, status: 'running', lifecycleState: 'running' }]);
      if (x === 'ps --nodes -A --json') return ok(nodes);
      if (args[0] === 'seat' || args[0] === 'policy') { ran.push(x); return failOn && x.includes(failOn) ? { code: 1, stdout: '', stderr: 'boom\n' } : { code: 0, stdout: '{}', stderr: '' }; }
      return { code: 1, stdout: '', stderr: '' };
    };
    const fs = { read: async (p: string) => { if (p in files) return files[p]!; throw new Error('ENOENT'); }, exists: (p: string) => p in files, copyDir: async () => {}, write: async () => {} };
    const roleIo = { read: async (p: string) => files[p] ?? null, stat: async () => null, head: async () => null };
    return { ran, rig: createOpenRig({ run, fs, roleIo, home: '/h', rigsDir: '/h/.ledge/rigs', openrigHome: '/h/.openrig', http: async () => undefined }) };
  };
  const yaml = (rig: string | null, front: string | null) => `name: dev\n${rig ? `permission_policy: ${rig}\n` : ''}pods:\n  - id: dev\n    members:\n      - id: front\n${front ? `        permission_policy: ${front}\n` : ''}        agent_ref: local:agents/front\n      - id: back\n        agent_ref: local:agents/back\n      - id: docs\n        agent_ref: local:agents/docs\n`;
  const applied = (r: { commands: string[] }) => r.commands.filter(c => c.startsWith('rig policy apply')).map(c => c.split(' ')[3]);
  it('stops at the first failure and counts the seats already changed', async () => {
    const { ran, rig } = mk(null, 'policy apply standard --seat b@dev');
    const r = await rig.act({ ...a, seats: ['a@dev', 'b@dev', 'c@dev'] });
    expect(ran).toHaveLength(4);
    expect(r).toMatchObject({ ok: false, error: 'boom', completed: 1 });
    expect(r.commands).toHaveLength(6);
  });
  it('spec: the member\'s own policy wins over the rig\'s, the rig\'s serves the others (a -2 seat is its member\'s)', async () => {
    const w = mk(yaml('builtin:locked', 'builtin:yolo'));
    const r = await w.rig.act({ ...a, policy: 'spec', seats: ['a@dev', 'b@dev', 'c@dev'] });
    expect(r.ok).toBe(true);
    expect(applied(r)).toEqual(['yolo', 'locked', 'locked']);
    const m = mk(yaml(null, 'builtin:open'));
    expect(applied(await m.rig.act({ ...a, policy: 'spec', seats: ['a@dev'] }))).toEqual(['open']);
  });
  it('spec: refused before anything runs when the spec is unknown, gives no policy, or gives a custom file', async () => {
    const none = mk(null);
    expect(await none.rig.act({ ...a, policy: 'spec', seats: ['a@dev'] })).toMatchObject({ ok: false, error: 'spec_unknown', completed: 0 });
    const bare = mk(yaml(null, null));
    expect(await bare.rig.act({ ...a, policy: 'spec', seats: ['a@dev'] })).toMatchObject({ ok: false, error: 'spec_no_policy', completed: 0 });
    // the first seat has a policy, the second does not: still nothing runs
    const some = mk(yaml(null, 'builtin:open'));
    expect(await some.rig.act({ ...a, policy: 'spec', seats: ['a@dev', 'b@dev'] })).toMatchObject({ ok: false, error: 'spec_no_policy' });
    const custom = mk(yaml('policies/mine.yaml', null));
    expect(await custom.rig.act({ ...a, policy: 'spec', seats: ['a@dev'] })).toMatchObject({ ok: false, error: 'spec_policy_unsupported', completed: 0 });
    for (const w of [none, bare, some, custom]) expect(w.ran).toEqual([]);
  });
});
