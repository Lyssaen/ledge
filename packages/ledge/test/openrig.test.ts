import { describe, it, expect } from 'vitest';
import { OpenRigActionSchema, OpenRigStateSchema, parseClientMessage } from '@ledge/protocol';
import { createOpenRig, readRow, ROW_TTL_MS, failure, findRig, planAction, readState, showCommand, type RigRun } from '../src/daemon/openrig.js';

// What OpenRig 0.6.14 printed on 2026-11-02, daemon started with --no-kernel (trimmed to the fields Ledge reads, plus a few it ignores).
const STATUS = {
  daemon: { state: 'running', reachable: true, pid: 382882, port: 7433, healthy: true },
  kernel: { state: 'skipped', lastBootFailure: null },
  workspaceRoot: { value: '/home/u/openrigdev', source: 'file' },
  rigs: [{ id: '01K', name: 'kernel', nodeCount: 4 }], cmux: { available: false }
};
const STOPPED = { daemon: { state: 'stopped', reachable: false, message: 'Daemon not running.', lifecycle: { kind: 'clean-shutdown' } }, kernel: null, rigs: null };
const PS = [
  { rigId: '01E', name: 'epic-split', rigName: 'epic-split', nodeCount: 3, runningCount: 0, status: 'stopped', lifecycleState: 'recoverable', uptime: null, latestSnapshot: '2d 18h ago', isArchived: false, attentionCount: 0 },
  { rigId: '01K', name: 'kernel', rigName: 'kernel', nodeCount: 4, runningCount: 0, status: 'stopped', lifecycleState: 'recoverable', uptime: null, latestSnapshot: '2d 18h ago', isArchived: false, attentionCount: 0 },
  { rigId: '01S', name: 'starter', nodeCount: 2, runningCount: 2, status: 'running', lifecycleState: 'running', uptime: '2h 12m', latestSnapshot: '5m ago', attentionCount: 1 },
  { rigId: '01A', name: 'old', nodeCount: 1, status: 'stopped', isArchived: true }
];
const NODES = [
  { rigId: '01S', rigName: 'starter', logicalId: 'dev.build', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', model: 'opus', sessionStatus: 'running', lifecycleState: 'running', agentActivity: { state: 'running' }, assignedWorkCount: 2, intentionallyStopped: false },
  { rigId: '01S', rigName: 'starter', logicalId: 'dev.review', canonicalSessionName: 'dev-review@starter', runtime: 'codex', model: null, sessionStatus: 'running', lifecycleState: 'running', agentActivity: { state: 'idle' }, assignedWorkCount: 0, intentionallyStopped: false },
  { rigId: '01E', logicalId: 'analysis.analyst', canonicalSessionName: 'analysis-analyst@epic-split', runtime: 'claude-code', model: null, sessionStatus: 'detached', lifecycleState: 'recoverable', agentActivity: { state: 'unknown' }, intentionallyStopped: true },
  { rigId: '01E', logicalId: 'broken' }
];
const AT = '2026-11-02T09:00:00.000Z';

describe('OpenRig state', () => {
  it('reads the daemon, the kernel and the rigs with their seats, archived rigs left out, the kernel last', () => {
    const s = readState({ status: STATUS, rigs: PS, nodes: NODES, version: '0.6.14', at: AT });
    expect(OpenRigStateSchema.parse(s)).toEqual(s);
    expect(s.daemon).toEqual({ state: 'running', pid: 382882, port: 7433 });
    expect(s.kernel.state).toBe('skipped');
    expect(s.rigs.map(r => r.name)).toEqual(['epic-split', 'starter', 'kernel']);
    const starter = s.rigs.find(r => r.name === 'starter')!;
    expect(starter).toMatchObject({ status: 'running', seats: 2, running: 2, attention: 1, uptime: '2h 12m', snapshot: '5m ago' });
    expect(starter.nodes[0]).toEqual({ logicalId: 'dev.build', session: 'dev-build@starter', runtime: 'claude-code', model: 'opus', sessionStatus: 'running', lifecycleState: 'running', activity: 'running', stopped: false, work: 2 });
    // A seat without a session name is not a seat Ledge can show.
    expect(s.rigs.find(r => r.name === 'epic-split')!.nodes).toHaveLength(1);
    expect(s.rigs.find(r => r.name === 'epic-split')!.nodes[0]!.stopped).toBe(true);
  });
  it('the kernel: ready when its rig runs, stopped when it does not, absent with no such rig, stopped with the daemon', () => {
    const running = PS.map(r => (r.name === 'kernel' ? { ...r, status: 'running', runningCount: 4 } : r));
    expect(readState({ status: { daemon: STATUS.daemon, kernel: { state: 'ready' } }, rigs: running, at: AT }).kernel.state).toBe('ready');
    expect(readState({ status: { daemon: STATUS.daemon, kernel: {} }, rigs: PS, at: AT }).kernel.state).toBe('stopped');
    expect(readState({ status: { daemon: STATUS.daemon }, rigs: PS.filter(r => r.name !== 'kernel'), at: AT }).kernel.state).toBe('absent');
    expect(readState({ status: STOPPED, at: AT }).kernel.state).toBe('stopped');
  });
  it('a stopped daemon: its message, no pid, no rigs even if some were printed', () => {
    const s = readState({ status: STOPPED, rigs: PS, at: AT });
    expect(s.daemon).toEqual({ state: 'stopped', message: 'Daemon not running.' });
    expect(s.rigs).toEqual([]);
  });
  it('anything that is not OpenRig JSON reads as an unknown daemon, never a throw', () => {
    for (const status of [undefined, null, 'x', [], { daemon: 'up' }]) expect(readState({ status, at: AT }).daemon.state).toBe('unknown');
  });
});

describe('OpenRig actions', () => {
  it('each action is the rig commands the mockup shows', () => {
    const cmds = (a: unknown) => planAction(OpenRigActionSchema.parse(a)).map(showCommand);
    expect(cmds({ kind: 'daemon.start' })).toEqual(['rig daemon start']);
    expect(cmds({ kind: 'daemon.start', restore: 'last' })).toEqual(['rig start --last']);
    expect(cmds({ kind: 'daemon.start', noKernel: true })).toEqual(['rig daemon start --no-kernel']);
    expect(cmds({ kind: 'daemon.restart', restore: 'last' })).toEqual(['rig daemon stop', 'rig start --last']);
    expect(cmds({ kind: 'kernel.stop' })).toEqual(['rig down kernel']);
    expect(cmds({ kind: 'kernel.restart' })).toEqual(['rig down kernel --snapshot', 'rig up kernel --existing --yes']);
    expect(cmds({ kind: 'rig.start', rig: 'starter' })).toEqual(['rig up starter --existing --yes']);
    expect(cmds({ kind: 'rig.stop', rig: 'starter', snapshot: true, force: true })).toEqual(['rig down starter --snapshot --force']);
    expect(cmds({ kind: 'rig.restart', rig: 'starter' })).toEqual(['rig down starter --snapshot', 'rig up starter --existing --yes']);
  });
  it('a rig name that rig would read as a flag never reaches it', () => {
    expect(OpenRigActionSchema.safeParse({ kind: 'rig.stop', rig: '--delete' }).success).toBe(false);
    expect(OpenRigActionSchema.safeParse({ kind: 'rig.stop', rig: 'a b' }).success).toBe(false);
    expect(() => parseClientMessage({ type: 'openrig.act', requestId: 'r', action: { kind: 'rig.start', rig: '-x' } })).toThrow();
    expect(parseClientMessage({ type: 'openrig.status', requestId: 'r', machineId: 'ec2' })).toMatchObject({ type: 'openrig.status' });
  });
  it('why a command failed: its JSON error, else its last line, else its exit code', () => {
    expect(failure({ code: 1, stdout: '{"error":"rig not found"}', stderr: '' })).toBe('rig not found');
    expect(failure({ code: 1, stdout: 'starting\n', stderr: 'boom\nError: Daemon not running.\n' })).toBe('starting');
    expect(failure({ code: 1, stdout: '', stderr: 'boom\nError: Daemon not running.\n\n' })).toBe('Error: Daemon not running.');
    expect(failure({ code: 3, stdout: '', stderr: '' })).toBe('exit 3');
  });
});

/** A fake `rig`: answers by its first arguments, records every call. */
function fakeRig(answers: Record<string, { code: number | null; stdout?: string; stderr?: string }>, hold?: Promise<void>) {
  const calls: string[] = [];
  const run: RigRun = async args => {
    const key = args.filter(a => a !== '--json').join(' ');
    calls.push(key);
    if (hold && args[0] === 'up') await hold;
    const a = answers[key] ?? Object.entries(answers).find(([k]) => key.startsWith(k))?.[1] ?? { code: 0 };
    return { code: a.code, stdout: a.stdout ?? '', stderr: a.stderr ?? '' };
  };
  return { run, calls };
}

describe('createOpenRig', () => {
  it('reads status, version and both ps listings while the daemon runs, and keeps the read for a moment', async () => {
    let t = 0;
    const { run, calls } = fakeRig({ 'status': { code: 0, stdout: JSON.stringify(STATUS) }, '--version': { code: 0, stdout: '0.6.14 (df1c1517)\n' }, 'ps -A': { code: 0 }, 'ps': { code: 0, stdout: JSON.stringify(PS) }, 'ps --nodes -A': { code: 0, stdout: JSON.stringify(NODES) } });
    const rig = createOpenRig({ run, now: () => t });
    const s = await rig.state();
    expect(s).toMatchObject({ installed: true, version: '0.6.14' });
    expect(s.rigs).toHaveLength(3);
    expect(calls.sort()).toEqual(['--version', 'ps', 'ps --nodes -A', 'status'].sort());
    t = 1000; await rig.state(); expect(calls).toHaveLength(4);
    t = 5000; await rig.state(); expect(calls.filter(c => c === 'status')).toHaveLength(2);
    // The version is asked once.
    expect(calls.filter(c => c === '--version')).toHaveLength(1);
  });
  it('a stopped daemon is read from status alone', async () => {
    const { run, calls } = fakeRig({ 'status': { code: 0, stdout: JSON.stringify(STOPPED) }, '--version': { code: 0, stdout: '0.6.14' } });
    expect((await createOpenRig({ run }).state()).daemon.state).toBe('stopped');
    expect(calls).not.toContain('ps');
  });
  it('no rig command on the machine: not installed', async () => {
    const { run } = fakeRig({ 'status': { code: null }, 'daemon': { code: null } });
    expect(await createOpenRig({ run }).state()).toMatchObject({ installed: false, rigs: [] });
    expect((await createOpenRig({ run }).act({ kind: 'daemon.start' })).error).toBe('not_installed');
  });
  it('an action runs its commands in order; the first failure stops it and says why', async () => {
    const ok = fakeRig({});
    expect(await createOpenRig({ run: ok.run }).act({ kind: 'rig.restart', rig: 'starter' })).toMatchObject({ ok: true, commands: ['rig down starter --snapshot', 'rig up starter --existing --yes'] });
    expect(ok.calls).toEqual(['down starter --snapshot', 'up starter --existing --yes']);
    const bad = fakeRig({ 'down': { code: 1, stderr: 'Error: rig starter is busy' } });
    const r = await createOpenRig({ run: bad.run }).act({ kind: 'rig.restart', rig: 'starter' });
    expect(r).toMatchObject({ ok: false, error: 'Error: rig starter is busy' });
    expect(bad.calls).toEqual(['down starter --snapshot']);
  });
  it('one action at a time: a second one is refused busy, and the next read is fresh', async () => {
    let release!: () => void; const hold = new Promise<void>(r => { release = r; });
    let t = 0;
    const { run, calls } = fakeRig({ 'status': { code: 0, stdout: JSON.stringify(STOPPED) }, '--version': { code: 0, stdout: '1' } }, hold);
    const rig = createOpenRig({ run, now: () => t });
    await rig.state();
    const first = rig.act({ kind: 'rig.start', rig: 'starter' });
    expect(await rig.act({ kind: 'rig.stop', rig: 'starter' })).toMatchObject({ ok: false, error: 'busy' });
    release(); expect((await first).ok).toBe(true);
    await rig.state();
    expect(calls.filter(c => c === 'status')).toHaveLength(2);
  });
});

describe('findRig', () => {
  const home = '/h';
  const at = (...files: string[]) => (p: string) => files.includes(p);
  it('the PATH first, then the newest nvm Node (fish, then bash), then volta and npm', () => {
    const list = (dir: string) => (dir === '/h/.local/share/nvm' ? ['v22.1.0', 'v26.7.0', 'v9.0.0'] : dir === '/h/.nvm/versions/node' ? ['v24.0.0'] : []);
    expect(findRig({ HOME: home, PATH: '/usr/bin:/opt/rig' }, at('/opt/rig/rig', '/h/.local/share/nvm/v26.7.0/bin/rig'), list)).toBe('/opt/rig');
    expect(findRig({ HOME: home, PATH: '/usr/bin' }, at('/h/.local/share/nvm/v22.1.0/bin/rig', '/h/.local/share/nvm/v26.7.0/bin/rig'), list)).toBe('/h/.local/share/nvm/v26.7.0/bin');
    expect(findRig({ HOME: home, PATH: '/usr/bin' }, at('/h/.nvm/versions/node/v24.0.0/bin/rig'), list)).toBe('/h/.nvm/versions/node/v24.0.0/bin');
    expect(findRig({ HOME: home, PATH: '' }, at('/h/.volta/bin/rig'), () => [])).toBe('/h/.volta/bin');
    expect(findRig({ HOME: home, PATH: '/usr/bin' }, at(), list)).toBeNull();
  });
});

describe('routedTmux', () => {
  it('a seat (`pod-member@rig`) goes to the default server, everything else to Ledge\'s; the list is both', async () => {
    const { routedTmux } = await import('../src/tmux.js');
    const calls: string[] = [];
    const fake = (who: string, list: string[] | Error) => ({
      newSession: async () => { calls.push(`${who}:new`); }, sendText: async (n: string) => { calls.push(`${who}:text:${n}`); }, sendKeys: async (n: string) => { calls.push(`${who}:keys:${n}`); },
      capture: async (n: string) => `${who}:${n}`, hasSession: async () => true, killSession: async (n: string) => { calls.push(`${who}:kill:${n}`); },
      setOption: async () => {}, attachArgs: (n: string) => [who, n], controlArgs: (n: string) => [who, '-C', n],
      listSessions: async () => { if (list instanceof Error) throw list; return list; }
    });
    const t = routedTmux(fake('ledge', ['ledge-a']), fake('default', ['dev-build@starter', 'my-own-shell']));
    await t.sendText('dev-build@starter', 'x'); await t.sendKeys('ledge-a', ['C-c']);
    expect(calls).toEqual(['default:text:dev-build@starter', 'ledge:keys:ledge-a']);
    expect(await t.capture('dev-build@starter', 5)).toBe('default:dev-build@starter');
    expect(t.attachArgs('dev-build@starter')).toEqual(['default', 'dev-build@starter']);
    // The control client of a seat attaches on the seat's own server, Ledge's sessions on Ledge's.
    expect(t.controlArgs?.('dev-build@starter')).toEqual(['default', '-C', 'dev-build@starter']);
    expect(t.controlArgs?.('ledge-a')).toEqual(['ledge', '-C', 'ledge-a']);
    expect(await t.listSessions()).toEqual(['ledge-a', 'dev-build@starter']);
    const down = routedTmux(fake('ledge', ['ledge-a']), fake('default', new Error('no server')));
    expect(await down.listSessions()).toEqual(['ledge-a']);
  });
});

describe('a seat\'s settings', () => {
  const cmds = (a: unknown) => planAction(OpenRigActionSchema.parse(a)).map(showCommand);
  it('another harness moves the seat now, model and effort going with it; the plan first with --dry-run', () => {
    expect(cmds({ kind: 'seat.set', seat: 'operator-agent@kernel', runtime: 'claude-code', model: 'opus', effort: 'high' }))
      .toEqual(['rig seat set-runtime operator-agent@kernel --runtime claude-code --model opus --effort high --reason Ledge']);
    expect(cmds({ kind: 'seat.set', seat: 'operator-agent@kernel', runtime: 'claude-code', dryRun: true }))
      .toEqual(['rig seat set-runtime operator-agent@kernel --runtime claude-code --dry-run --reason Ledge']);
  });
  it('without a harness change, model, effort and permissions are saved for the next resume', () => {
    expect(cmds({ kind: 'seat.set', seat: 'dev-build@starter', model: 'sonnet', effort: 'low', permissions: 'auto' })).toEqual([
      'rig seat set-model dev-build@starter --model sonnet --reason Ledge',
      'rig seat set-effort dev-build@starter --effort low --reason Ledge',
      'rig seat set-permissions dev-build@starter --mode auto --reason Ledge'
    ]);
  });
  it('a seat, a model or a mode rig would read as a flag never passes', () => {
    expect(OpenRigActionSchema.safeParse({ kind: 'seat.set', seat: '--x', model: 'opus' }).success).toBe(false);
    expect(OpenRigActionSchema.safeParse({ kind: 'seat.set', seat: 'a-b@c', model: '-opus' }).success).toBe(false);
    expect(OpenRigActionSchema.safeParse({ kind: 'seat.set', seat: 'a-b@c', permissions: 'root' }).success).toBe(false);
  });
});

describe('a queue row for an OpenRig task card', () => {
  // `rig queue show <id> --json` (0.7.7), trimmed to the fields Ledge reads.
  const ROW = { qitemId: 'qitem-20261102205801-ae61eb9d7f1f4b49', state: 'handed-off', summary: 'Build NSIS Windows de l\'overlay final', sourceSession: 'pilot-lead@ledge-dev-2',
    destinationSession: 'dev-back@ledge-dev-2', handedOffTo: 'pilot-lead@ledge-dev-2', blockedOn: null, tsCreated: '2026-11-02T20:58:01.114Z', tsUpdated: '2026-11-02T21:05:00.000Z',
    claimedAt: '2026-11-02T20:58:12.489Z', pickup: { state: 'working' } };
  const ID = ROW.qitemId;
  it('reads a row', () => {
    expect(readRow(JSON.stringify(ROW), 'now')).toEqual({ id: ID, state: 'handed-off', summary: 'Build NSIS Windows de l\'overlay final', from: 'pilot-lead@ledge-dev-2', to: 'dev-back@ledge-dev-2',
      handedOffTo: 'pilot-lead@ledge-dev-2', createdAt: '2026-11-02T20:58:01.114Z', claimedAt: '2026-11-02T20:58:12.489Z', updatedAt: '2026-11-02T21:05:00.000Z', at: 'now' });
    expect(readRow('{"error":"x"}', 'now')).toBeUndefined();
    expect(readRow('not json', 'now')).toBeUndefined();
    expect(readRow(JSON.stringify({ ...ROW, qitemId: '--flag' }), 'now')).toBeUndefined();
  });
  it('asks rig once per cadence and row, and says why not', async () => {
    let t = 0;
    const { run, calls } = fakeRig({ [`queue show ${ID}`]: { code: 0, stdout: JSON.stringify(ROW) },
      'queue show qitem-missing': { code: 1, stdout: '{"error":"qitem_not_found","hint":"Queue item was not found"}' } });
    const rig = createOpenRig({ run, now: () => t });
    const [a, b] = await Promise.all([rig.row(ID), rig.row(ID)]);
    expect(a.row?.state).toBe('handed-off'); expect(b).toBe(a);
    expect(calls).toEqual([`queue show ${ID}`]);
    t = ROW_TTL_MS - 1; await rig.row(ID); expect(calls).toHaveLength(1);
    t = ROW_TTL_MS; await rig.row(ID); expect(calls).toHaveLength(2);
    expect(await rig.row('qitem-missing')).toEqual({ error: 'not_found' });
    expect(await createOpenRig({ run: fakeRig({ queue: { code: null } }).run }).row(ID)).toEqual({ error: 'not_installed' });
    expect(await createOpenRig({ run: fakeRig({ queue: { code: 1, stderr: 'Error: Daemon not running.' } }).run }).row(ID)).toEqual({ error: 'daemon_stopped' });
    expect(await createOpenRig({ run: fakeRig({ queue: { code: 0, stdout: '[]' } }).run }).row(ID)).toEqual({ error: 'failed' });
  });
});
