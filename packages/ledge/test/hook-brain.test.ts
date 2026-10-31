import { describe, it, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { runHook, brainRefusal, BRAIN_FORBIDDEN } from '../src/cli/hook.js';
import { brainOnClient, BRAIN_USAGE } from '../src/cli/brain.js';
import { parseLedgeCommand } from '../src/cli/send.js';
import { connect } from '../src/client.js';

const VARS = ['LEDGE_HOME', 'LEDGE_SESSION', 'LEDGE_SESSION_KEY', 'LEDGE_BRAIN', 'LEDGE_CHAT', 'LEDGE_NAME', 'LEDGE_CODEX_SESSION', 'LEDGE_CODEX_HOOK_SESSION', 'OPENRIG_SESSION_NAME', 'OPENRIG_NODE_ID'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(VARS.map(k => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-hook-brain-'));
});
afterEach(() => { for (const k of VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

type Out = { hookSpecificOutput: { hookEventName: string; permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string } };
const out = (s: string | undefined) => (JSON.parse(s!) as Out).hookSpecificOutput;
const bash = (command: string, session = 'agent-1') => JSON.stringify({ session_id: session, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: '/w' });

/** A daemon that answers each brain.cmd with `line` (or never, when `line` is undefined). */
const fake = async (line?: string) => {
  const got: Array<Record<string, unknown>> = [];
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await new Promise(r => wss.once('listening', r));
  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'snapshot', sessions: [] }));
    ws.on('message', d => {
      const m = JSON.parse(String(d)); got.push(m);
      if (line !== undefined && m.type === 'brain.cmd') {
        ws.send(JSON.stringify({ type: 'brain.result', rid: 'other', ok: false, line: 'pas pour toi' }));
        ws.send(JSON.stringify({ type: 'brain.result', rid: m.rid, ok: true, line }));
      }
    });
  });
  return { got, port: (wss.address() as { port: number }).port, close: () => new Promise(r => wss.close(r)) };
};

describe('brainRefusal', () => {
  test.each([
    'rig send dev-build@factory hi', 'cd x && tmux kill-session -t a', 'curl -s http://127.0.0.1:7433/api/ps',
    'FOO=1 rig ps', 'sudo tmux ls', 'echo $(rig ps)', 'x | tmux', 'wget localhost:7433/api', 'a; rig ps', 'a || rig ps',
    'echo `tmux ls`', 'ls\nrig ps', '(rig ps)', 'env A=b rig ps', 'nohup tmux new -d', '/usr/local/bin/rig ps', 'nc localhost 7433',
    'if true; then rig ps; fi', 'curl http://localhost:7433'
  ])('brain is refused « %s »', cmd => {
    expect(brainRefusal(cmd)).toMatch(/passe par `ledge brain …`/);
    expect(BRAIN_FORBIDDEN.test(cmd)).toBe(true);
  });
  test.each([
    'ledge brain rigs', 'git log --oneline', 'echo trigger', 'ledge brain rig up starter --goal "x" --because u1',
    'ledge brain rig down x --because u1', 'echo rig', 'rigor ps', 'tmuxinator', 'curl https://example.com:7433', 'curl http://localhost:8080'
  ])('brain may run « %s »', cmd => { expect(brainRefusal(cmd)).toBeNull(); });
});

describe('parseLedgeCommand: ledge brain', () => {
  it('reads `ledge brain <op> …` as one brain command', () => {
    expect(parseLedgeCommand('ledge brain rigs')).toEqual({ cmd: 'brain', args: ['rigs'] });
    expect(parseLedgeCommand('ledge brain say "Salut toi"')).toEqual({ cmd: 'brain', args: ['say', 'Salut toi'] });
    expect(parseLedgeCommand('ledge brain say x && rig ps')).toBeUndefined();
  });
});

describe('brainOnClient', () => {
  it('sends op and args as brain.cmd and answers with the line of its own result', async () => {
    const d = await fake('2 rigs');
    const c = await connect({ port: d.port });
    try {
      expect(await brainOnClient(c, ['rig', 'down', 'x', '--because', 'u1'], 'brain', 'k', 1000)).toEqual({ line: '2 rigs', code: 0 });
      expect(d.got.at(-1)).toMatchObject({ type: 'brain.cmd', by: 'brain', key: 'k', op: 'rig', args: ['down', 'x', '--because', 'u1'] });
    } finally { await c.close(); await d.close(); }
  });
  it('an unknown op gets the usage without reaching the daemon', async () => {
    const d = await fake('x');
    const c = await connect({ port: d.port });
    try {
      expect(await brainOnClient(c, ['rm', '-rf'], 'brain', 'k', 1000)).toEqual({ line: BRAIN_USAGE, code: 1 });
      expect(await brainOnClient(c, [], 'brain', 'k', 1000)).toEqual({ line: BRAIN_USAGE, code: 1 });
      expect(d.got).toEqual([]);
    } finally { await c.close(); await d.close(); }
  });
  it('a daemon that never answers is said, in French', async () => {
    const d = await fake();
    const c = await connect({ port: d.port });
    try {
      const r = await brainOnClient(c, ['rigs'], 'brain', 'k', 100);
      expect(r.code).toBe(1); expect(r.line).toMatch(/^pas de réponse de Ledge/);
    } finally { await c.close(); await d.close(); }
  });
});

describe('runHook: the brain session', () => {
  it('a non-brain session is never refused', async () => {
    process.env.LEDGE_SESSION = 'abcd';
    expect(await runHook('PreToolUse', bash('rig ps'), { port: 1, timeoutMs: 100 })).toBeUndefined();
    process.env.LEDGE_CODEX_HOOK_SESSION = 'abcd';
    expect(await runHook('PreToolUse', bash('tmux ls'), { port: 1, timeoutMs: 100, tool: 'codex' })).toBeUndefined();
  });
  it('a non-brain Codex leaves `ledge brain …` to its shell, as before', async () => {
    process.env.LEDGE_CODEX_HOOK_SESSION = 'abcd';
    const d = await fake('2 rigs');
    try {
      expect(await runHook('PreToolUse', bash('ledge brain rigs'), { port: d.port, tool: 'codex' })).toBeUndefined();
      expect(d.got.map(m => m.type)).toEqual(['session.event']);
    } finally { await d.close(); }
  });
  it('a Claude brain (LEDGE_BRAIN=1) is denied rig, even with no daemon', async () => {
    process.env.LEDGE_SESSION = 'brain'; process.env.LEDGE_BRAIN = '1';
    const o = out(await runHook('PreToolUse', bash('rig ps'), { port: 1, timeoutMs: 100 }));
    expect(o.permissionDecision).toBe('deny');
    expect(o.permissionDecisionReason).toMatch(/passe par `ledge brain …`/);
  });
  it('a brain is known by its id alone (brain-<hex>)', async () => {
    process.env.LEDGE_SESSION = 'brain-3f2a';
    expect(out(await runHook('PreToolUse', bash('tmux ls'), { port: 1, timeoutMs: 100 })).permissionDecision).toBe('deny');
    expect(await runHook('PreToolUse', bash('ledge brain rigs'), { port: 1, timeoutMs: 100 })).toBeUndefined();
  });
  it('a Codex brain is denied curl to OpenRig', async () => {
    process.env.LEDGE_CODEX_HOOK_SESSION = 'brain';
    const o = out(await runHook('PreToolUse', bash('curl -s http://127.0.0.1:7433/api/ps'), { port: 1, timeoutMs: 100, tool: 'codex' }));
    expect(o.permissionDecision).toBe('deny');
  });
  it('codex brain runs ledge brain in the hook', async () => {
    process.env.LEDGE_CODEX_HOOK_SESSION = 'brain'; process.env.LEDGE_SESSION_KEY = 'k-brain';
    const d = await fake('2 rigs');
    try {
      expect(out(await runHook('PreToolUse', bash('ledge brain rigs'), { port: d.port, tool: 'codex' }))).toEqual({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '2 rigs' });
      expect(d.got.map(m => m.type)).toEqual(['session.event', 'brain.cmd']);
      expect(d.got[1]).toMatchObject({ by: 'brain', key: 'k-brain', op: 'rigs', args: [] });
    } finally { await d.close(); }
  });
  it('SessionStart gives the brain its own context, never the identity nor the seat one', async () => {
    process.env.LEDGE_SESSION = 'brain'; process.env.LEDGE_BRAIN = '1'; process.env.LEDGE_NAME = 'Ledge'; process.env.OPENRIG_SESSION_NAME = 'x@y';
    const ctx = out(await runHook('SessionStart', JSON.stringify({ session_id: 'brain', cwd: '/home/u/.ledge/brain' }), { port: 1, timeoutMs: 100 })).additionalContext!;
    expect(ctx).toBe("Tu es Ledge, l'humain des rigs OpenRig de l'utilisateur et son seul interlocuteur. Tes consignes, ton mandat et ta mémoire sont dans CLAUDE.md / AGENTS.md de ce dossier ; tu n'agis que par `ledge brain …`.");
  });
  it('a Codex brain gets the same context at SessionStart', async () => {
    process.env.LEDGE_CODEX_HOOK_SESSION = 'brain-ab';
    const ctx = out(await runHook('SessionStart', JSON.stringify({ session_id: 'brain-ab', cwd: '/b' }), { port: 1, timeoutMs: 100, tool: 'codex' })).additionalContext!;
    expect(ctx).toMatch(/^Tu es Ledge, l'humain des rigs/);
    expect(ctx).not.toMatch(/ledge who|siège du rig/);
  });
});
