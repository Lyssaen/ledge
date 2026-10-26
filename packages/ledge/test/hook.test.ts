import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { formatWho } from '../src/cli/who.js';
import { mapClaudeHook, mapHook, mapCursorHook, runHook, codexLedgeId, underCodexDaemon, identityContext, tasksContext, REPLY_MAX, INPUT_MAX, toolOutput, trimInput } from '../src/cli/hook.js';
import type { Session } from '@ledge/protocol';
import { startServer } from '../src/daemon/server.js';
import { Store } from '../src/daemon/store.js';
import { connect } from '../src/client.js';

const at = '2026-10-09T18:00:00.000Z';
let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ledge-hook-')); process.env.LEDGE_HOME = home; delete process.env.LEDGE_SESSION; delete process.env.LEDGE_CODEX_SESSION; delete process.env.LEDGE_CODEX_HOOK_SESSION; });

describe('mapClaudeHook', () => {
  it('uses LEDGE_SESSION when set, else session_id', () => {
    process.env.LEDGE_SESSION = '7f3a';
    expect(mapClaudeHook('Stop', { session_id: 'uuid-1' }, at)?.id).toBe('7f3a');
    delete process.env.LEDGE_SESSION;
    expect(mapClaudeHook('Stop', { session_id: 'uuid-1' }, at)?.id).toBe('uuid-1');
  });
  it('maps PermissionRequest for Bash to a permission event with the command', () => {
    const m = mapClaudeHook('PermissionRequest', { session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run tests' } }, at);
    expect(m?.event).toEqual({ name: 'PermissionRequest', at, source: 'hook', agentSessionId: 's', tool: 'Bash', text: 'npm test', toolInput: { command: 'npm test', description: 'Run tests' } });
  });
  it('keeps a long plan whole for review: ExitPlanMode is capped like a reply, not like a tool input', () => {
    const plan = `# Plan\n${'step\n'.repeat(INPUT_MAX / 4)}`;
    const m = mapClaudeHook('PreToolUse', { session_id: 's', tool_name: 'ExitPlanMode', tool_input: { plan } }, at);
    expect(m?.event.text).toBe('# Plan');
    expect(m?.event.toolInput).toEqual({ plan });
  });
  it('maps PermissionRequest for Edit to the file path', () => {
    const m = mapClaudeHook('PermissionRequest', { session_id: 's', tool_name: 'Edit', tool_input: { file_path: '/w/src/a.ts' } }, at);
    expect(m?.event.text).toBe('/w/src/a.ts');
  });
  it('maps PreToolUse AskUserQuestion with its options', () => {
    const payload = { session_id: 's', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] } };
    const m = mapClaudeHook('PreToolUse', payload, at);
    expect(m?.event).toEqual({ name: 'PreToolUse', at, source: 'hook', agentSessionId: 's', tool: 'AskUserQuestion', text: 'Which?', options: ['A', 'B'], toolInput: payload.tool_input });
  });
  it('maps PreToolUse AskUserQuestion option descriptions, by index', () => {
    const payload = { session_id: 's', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which?', options: [{ label: 'A', description: ' Keeps it simple. ' }, { label: 'B' }] }] } };
    expect(mapClaudeHook('PreToolUse', payload, at)?.event).toEqual({ name: 'PreToolUse', at, source: 'hook', agentSessionId: 's', tool: 'AskUserQuestion', text: 'Which?', options: ['A', 'B'], optionDetails: ['Keeps it simple.', ''], toolInput: payload.tool_input });
  });
  it('maps Notification permission_prompt to kind permission', () => {
    const m = mapClaudeHook('Notification', { session_id: 's', notification_type: 'permission_prompt', message: 'Claude needs your permission' }, at);
    expect(m?.event.kind).toBe('permission');
  });
  it('maps SessionEnd with no code', () => {
    expect(mapClaudeHook('SessionEnd', { session_id: 's' }, at)?.event).toEqual({ name: 'SessionEnd', at, source: 'hook', agentSessionId: 's', exitCode: null });
  });
  describe('SessionEnd per reason', () => {
    const reasons = ['clear', 'resume', 'logout', 'prompt_input_exit', 'other'];
    it.each(reasons)('under the launcher (LEDGE_SESSION set), reason %s is not mapped', reason => {
      process.env.LEDGE_SESSION = '7f3a';
      expect(mapClaudeHook('SessionEnd', { session_id: 's', reason }, at)).toBeNull();
    });
    it.each(['clear', 'resume'])('hook only, reason %s is ignored (the agent keeps running)', reason => {
      expect(mapClaudeHook('SessionEnd', { session_id: 's', reason }, at)).toBeNull();
    });
    it.each(['logout', 'prompt_input_exit', 'other'])('hook only, reason %s stays terminal', reason => {
      expect(mapClaudeHook('SessionEnd', { session_id: 's', reason }, at)?.event).toEqual({ name: 'SessionEnd', at, source: 'hook', agentSessionId: 's', exitCode: null });
    });
  });
  // Payload shapes from Claude Code 2.1.296 (field names read from the installed binary's hook input schemas).
  const common = { session_id: 's', transcript_path: '/h/.claude/projects/p/s.jsonl', cwd: '/w', permission_mode: 'default' };
  it('maps PostToolUse with its id, input, output and duration', () => {
    const payload = { ...common, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok', stderr: '' }, tool_use_id: 'toolu_1', duration_ms: 812 };
    expect(mapClaudeHook('PostToolUse', payload, at)?.event).toEqual({ name: 'PostToolUse', at, source: 'hook', agentSessionId: 's', tool: 'Bash', toolUseId: 'toolu_1', toolInput: { command: 'npm test' }, output: 'ok', durationMs: 812 });
  });
  it('turns any tool_response into text or nothing, never throws', () => {
    expect(toolOutput('plain')).toBe('plain');
    expect(toolOutput({ stdout: 'out', stderr: 'err' })).toBe('out\nerr');
    expect(toolOutput([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\nb');
    expect(toolOutput({ filePath: '/x', success: true })).toBe('{"filePath":"/x","success":true}');
    expect(toolOutput(null)).toBeUndefined();
    expect(toolOutput(42)).toBe('42');
    expect(toolOutput('x'.repeat(REPLY_MAX + 10))).toHaveLength(REPLY_MAX);
  });
  it('caps each input string and keeps the rest of the input', () => {
    const long = 'y'.repeat(INPUT_MAX + 5);
    expect(trimInput({ command: long, timeout: 5, nested: { s: long } })).toEqual({ command: long.slice(0, INPUT_MAX), timeout: 5, nested: { s: long.slice(0, INPUT_MAX) } });
    expect(trimInput('not an object')).toBeUndefined();
  });
  it('maps PostToolUseFailure with its error and PreToolUse with its id and transcript', () => {
    const fail = { ...common, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 'toolu_2', error: 'exit 1', duration_ms: 40 };
    expect(mapClaudeHook('PostToolUseFailure', fail, at)?.event).toEqual({ name: 'PostToolUseFailure', at, source: 'hook', agentSessionId: 's', tool: 'Bash', toolUseId: 'toolu_2', toolInput: { command: 'x' }, error: 'exit 1', durationMs: 40 });
    const pre = { ...common, transcript_path: '/t/s.jsonl', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' }, tool_use_id: 'toolu_3' };
    expect(mapClaudeHook('PreToolUse', pre, at)?.event).toMatchObject({ name: 'PreToolUse', tool: 'Edit', toolUseId: 'toolu_3', toolInput: pre.tool_input, transcriptPath: '/t/s.jsonl' });
  });
  it('maps SubagentStop with the report and the helper transcript', () => {
    const payload = { ...common, hook_event_name: 'SubagentStop', agent_id: 'h1', agent_type: 'Explore', agent_transcript_path: '/t/s/subagents/agent-h1.jsonl', last_assistant_message: 'Found 3 consumers.' };
    expect(mapClaudeHook('SubagentStop', payload, at)?.event).toEqual({ name: 'SubagentStop', at, source: 'hook', helperId: 'h1', tool: 'Explore', text: 'Found 3 consumers.', transcriptPath: '/t/s/subagents/agent-h1.jsonl' });
  });
  it('maps an interrupted PostToolUseFailure (Esc) with interrupt set', () => {
    const payload = { ...common, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'sleep 60' }, tool_use_id: 'toolu_3', error: 'Interrupted by user', is_interrupt: true };
    expect(mapClaudeHook('PostToolUseFailure', payload, at)?.event).toEqual({ name: 'PostToolUseFailure', at, source: 'hook', agentSessionId: 's', tool: 'Bash', toolUseId: 'toolu_3', toolInput: { command: 'sleep 60' }, error: 'Interrupted by user', interrupt: true });
  });
  it('maps Stop with the last assistant message as the reply text', () => {
    const payload = { ...common, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: '  ## Done\n\nAll green.  ' };
    expect(mapClaudeHook('Stop', payload, at)?.event).toEqual({ name: 'Stop', at, source: 'hook', agentSessionId: 's', text: '## Done\n\nAll green.', transcriptPath: common.transcript_path });
  });
  it('maps Stop without a message (older Claude Code) or with a blank one to a bare Stop', () => {
    expect(mapClaudeHook('Stop', { ...common, hook_event_name: 'Stop', stop_hook_active: false }, at)?.event).toEqual({ name: 'Stop', at, source: 'hook', agentSessionId: 's', transcriptPath: common.transcript_path });
    expect(mapClaudeHook('Stop', { ...common, last_assistant_message: '   ' }, at)?.event).toEqual({ name: 'Stop', at, source: 'hook', agentSessionId: 's', transcriptPath: common.transcript_path });
  });
  it('caps a very long reply and marks the cut', () => {
    const text = mapClaudeHook('Stop', { ...common, last_assistant_message: 'x'.repeat(REPLY_MAX + 500) }, at)?.event.text!;
    expect(text.length).toBeLessThan(REPLY_MAX + 20);
    expect(text.endsWith('[…]')).toBe(true);
  });
  it('maps StopFailure with its error and details', () => {
    const payload = { ...common, hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429 Too Many Requests', last_assistant_message: 'Working on it' };
    expect(mapClaudeHook('StopFailure', payload, at)?.event).toEqual({ name: 'StopFailure', at, source: 'hook', agentSessionId: 's', text: 'rate_limit: 429 Too Many Requests' });
  });
  it('maps StopFailure with only an error code, or nothing', () => {
    expect(mapClaudeHook('StopFailure', { ...common, error: 'overloaded' }, at)?.event.text).toBe('overloaded');
    expect(mapClaudeHook('StopFailure', { ...common }, at)?.event.text).toBeUndefined();
  });
  it('maps SubagentStart to the helper id and type (2.1 sends no task)', () => {
    const payload = { ...common, hook_event_name: 'SubagentStart', agent_id: 'a7c2e', agent_type: 'Explore' };
    expect(mapClaudeHook('SubagentStart', payload, at)?.event).toEqual({ name: 'SubagentStart', at, source: 'hook', helperId: 'a7c2e', tool: 'Explore' });
  });
  it('maps SubagentStart with a description or prompt to the first line of the task', () => {
    expect(mapClaudeHook('SubagentStart', { ...common, agent_id: 'a1', agent_type: 'general-purpose', description: 'Find the mapper\nmore' }, at)?.event.text).toBe('Find the mapper');
    expect(mapClaudeHook('SubagentStart', { ...common, agent_id: 'a1', prompt: 'Read setup.ts\nthen' }, at)?.event.text).toBe('Read setup.ts');
  });
  it('a subagent event carries its description from its .meta.json, written once the subagent runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-meta-'));
    mkdirSync(join(dir, 's', 'subagents'), { recursive: true });
    writeFileSync(join(dir, 's', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Review task 3\nmore' }));
    const payload = { ...common, transcript_path: join(dir, 's.jsonl'), agent_id: 'a1', tool_name: 'Read', tool_input: { file_path: '/w/a.ts' } };
    expect(mapClaudeHook('PreToolUse', payload, at)?.event.task).toBe('Review task 3');
    expect(mapClaudeHook('PreToolUse', { ...payload, agent_id: 'a2' }, at)?.event).not.toHaveProperty('task');
    expect(mapClaudeHook('PreToolUse', { ...payload, agent_id: undefined }, at)?.event).not.toHaveProperty('task');
    writeFileSync(join(dir, 's', 'subagents', 'agent-a1.meta.json'), '{"agentType":"Explore"}');
    expect(mapClaudeHook('PreToolUse', payload, at)?.event).not.toHaveProperty('task');
  });
  it('drops SubagentStart/SubagentStop without agent_id', () => {
    expect(mapClaudeHook('SubagentStart', { ...common, agent_type: 'Explore' }, at)).toBeNull();
    expect(mapClaudeHook('SubagentStop', { ...common }, at)).toBeNull();
  });
  it.each(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'StopFailure'])('tags %s fired inside a subagent with its helperId', name => {
    const payload = { ...common, agent_id: 'a7c2e', agent_type: 'Explore', tool_name: 'Bash', tool_input: { command: 'ls' }, message: 'm' };
    expect(mapClaudeHook(name, payload, at)?.event.helperId).toBe('a7c2e');
  });
  it('does not tag a main-thread event of an --agent session (agent_type without agent_id)', () => {
    const payload = { ...common, agent_type: 'reviewer', tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(mapClaudeHook('PreToolUse', payload, at)?.event.helperId).toBeUndefined();
  });
  it('returns null for an unknown event or malformed payload', () => {
    expect(mapClaudeHook('Whatever', { session_id: 's' }, at)).toBeNull();
    expect(mapClaudeHook('Stop', 'not an object', at)).toBeNull();
  });
});

// Payloads as Codex CLI 0.162 sends them (recorded, ids shortened).
const codex = (extra: Record<string, unknown>) => ({ session_id: '01a12b05-ecd8', turn_id: 't1', cwd: '/home/dev/demo', model: 'gpt-5.6-sol', permission_mode: 'default', ...extra });

describe('mapHook codex', () => {
  it('never names the session from LEDGE_SESSION (that is Claude\'s, or a parent agent\'s)', () => {
    process.env.LEDGE_SESSION = 'aaaa';
    expect(mapHook('codex', 'Stop', codex({}), at)?.id).toBe('01a12b05-ecd8');
    process.env.LEDGE_CODEX_HOOK_SESSION = 'bbbb';
    expect(mapHook('codex', 'Stop', codex({}), at)?.id).toBe('bbbb');
  });
  it('codexLedgeId: the per-thread override first, the environment only when no shared daemon runs the hook', () => {
    expect(codexLedgeId({ LEDGE_CODEX_HOOK_SESSION: 'b', LEDGE_CODEX_SESSION: 'a' }, () => true)).toBe('b');
    expect(codexLedgeId({ LEDGE_CODEX_SESSION: 'a' }, () => false)).toBe('a');
    // Under the daemon, the environment is the one of the codex that started it: another session, or none.
    expect(codexLedgeId({ LEDGE_CODEX_SESSION: 'a' }, () => true)).toBeUndefined();
    expect(codexLedgeId({}, () => false)).toBeUndefined();
  });
  it('underCodexDaemon walks the parents in /proc, a "(comm)" with spaces included', () => {
    const procs: Record<number, { ppid: number; cmd: string[] }> = {
      [process.pid]: { ppid: 900, cmd: ['node', 'hook'] }, 900: { ppid: 800, cmd: ['sh', '-c', 'ledge hook codex Stop'] },
      800: { ppid: 1, cmd: ['/x/codex', 'app-server', '--listen', 'unix://'] }
    };
    const read = (path: string) => {
      const [, pid, file] = path.match(/^\/proc\/(\d+)\/(stat|cmdline)$/)!;
      const p = procs[Number(pid)]; if (!p) throw new Error('ENOENT');
      return file === 'stat' ? `${pid} (a b) S ${p.ppid} 1 1` : p.cmd.join('\0') + '\0';
    };
    expect(underCodexDaemon(read)).toBe(true);
    procs[800]!.cmd = ['/x/codex', '-c', 'shell_environment_policy.set.X="1"'];
    expect(underCodexDaemon(read)).toBe(false);
  });
  it('carries the agent and the folder, for a session Ledge did not launch', () => {
    expect(mapHook('codex', 'SessionStart', codex({ source: 'startup' }), at)).toMatchObject({ agent: 'codex', cwd: '/home/dev/demo' });
  });
  it('maps a Bash PermissionRequest to the command', () => {
    const m = mapHook('codex', 'PermissionRequest', codex({ tool_name: 'Bash', tool_input: { command: "printf '%s\\n' hi > hello.txt", description: 'Allow the requested shell command?' } }), at);
    expect(m?.event).toEqual({ name: 'PermissionRequest', at, source: 'hook', agentSessionId: '01a12b05-ecd8', tool: 'Bash', text: "printf '%s\\n' hi > hello.txt", toolInput: { command: "printf '%s\\n' hi > hello.txt", description: 'Allow the requested shell command?' } });
  });
  it('maps an apply_patch PermissionRequest to the files it touches', () => {
    const command = '*** Begin Patch\n*** Update File: /home/dev/demo/README.md\n@@\n # demo\n+bye\n*** Add File: /home/dev/demo/b.txt\n+b\n*** End Patch';
    const m = mapHook('codex', 'PermissionRequest', codex({ tool_name: 'apply_patch', tool_input: { command } }), at);
    expect(m?.event).toEqual({ name: 'PermissionRequest', at, source: 'hook', agentSessionId: '01a12b05-ecd8', tool: 'apply_patch', text: '/home/dev/demo/README.md, /home/dev/demo/b.txt', toolInput: { command } });
  });
  it('maps request_user_input to a question with its options and their descriptions', () => {
    const tool_input = { questions: [{ header: 'Banner color', id: 'banner_color', question: 'Which color should the banner be?', options: [{ label: 'Blue (Recommended)', description: 'calm' }, { label: 'Red', description: 'bold' }] }] };
    const m = mapHook('codex', 'PreToolUse', codex({ tool_name: 'request_user_input', tool_input }), at);
    expect(m?.event).toEqual({ name: 'PreToolUse', at, source: 'hook', agentSessionId: '01a12b05-ecd8', tool: 'request_user_input', text: 'Which color should the banner be?', options: ['Blue (Recommended)', 'Red'], optionDetails: ['calm', 'bold'], toolInput: tool_input });
  });
  it('maps Stop with its last message, and a null one to a bare Stop', () => {
    expect(mapHook('codex', 'Stop', codex({ stop_hook_active: false, last_assistant_message: 'Created `hello.txt`.' }), at)?.event).toEqual({ name: 'Stop', at, source: 'hook', agentSessionId: '01a12b05-ecd8', text: 'Created `hello.txt`.' });
    expect(mapHook('codex', 'Stop', codex({ stop_hook_active: false, last_assistant_message: null }), at)?.event).toEqual({ name: 'Stop', at, source: 'hook', agentSessionId: '01a12b05-ecd8' });
  });
  it('maps the Stop of a Plan mode turn, whose last message is null, to the plan the rollout holds for that turn', () => {
    const rollout = join(home, 'rollout.jsonl');
    writeFileSync(rollout, JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'item_completed', turn_id: 't1', item: { type: 'Plan', id: 't1-plan', text: '# Add a README\n\n- one file\n' } } }) + '\n');
    expect(mapHook('codex', 'Stop', codex({ stop_hook_active: false, last_assistant_message: null, transcript_path: rollout }), at)?.event).toEqual({ name: 'Stop', at, source: 'hook', agentSessionId: '01a12b05-ecd8', kind: 'plan', text: '# Add a README\n\n- one file', transcriptPath: rollout });
  });
  it('maps Interrupt (Esc on a turn or on an approval) to an interrupted tool run: Codex waits, no Stop follows', () => {
    expect(mapHook('codex', 'Interrupt', codex({}), at)?.event).toEqual({ name: 'PostToolUseFailure', at, source: 'hook', agentSessionId: '01a12b05-ecd8', interrupt: true });
  });
  it('SessionEnd ends a session Ledge did not launch; under Ledge the pane and the exit code tell', () => {
    expect(mapHook('codex', 'SessionEnd', codex({}), at)?.event).toEqual({ name: 'SessionEnd', at, source: 'hook', agentSessionId: '01a12b05-ecd8', exitCode: null });
    process.env.LEDGE_CODEX_HOOK_SESSION = 'bbbb';
    expect(mapHook('codex', 'SessionEnd', codex({}), at)).toBeNull();
  });
  it('Claude hooks still read LEDGE_SESSION and carry the claude agent', () => {
    process.env.LEDGE_SESSION = '7f3a'; process.env.LEDGE_CODEX_HOOK_SESSION = 'bbbb';
    expect(mapHook('claude', 'Stop', { session_id: 'uuid-1', cwd: '/w' }, at)).toMatchObject({ id: '7f3a', agent: 'claude', cwd: '/w' });
  });
});

describe('runHook', () => {
  it('falls back to session_id when LEDGE_SESSION is empty', () => {
    process.env.LEDGE_SESSION = '';
    expect(mapClaudeHook('Stop', { session_id: 'uuid-1' }, at)?.id).toBe('uuid-1');
  });
  it('stays within one timeoutMs against a server that accepts and never answers', async () => {
    const srv = createServer(() => {});
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    const t0 = Date.now();
    await runHook('Stop', JSON.stringify({ session_id: 's' }), { port, timeoutMs: 150 });
    expect(Date.now() - t0).toBeLessThan(220);
    srv.close();
  });
  it('returns quickly and never throws when no daemon listens', async () => {
    const t0 = Date.now();
    await expect(runHook('Stop', JSON.stringify({ session_id: 's' }), { port: 1, timeoutMs: 150 })).resolves.toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(200);
  });
  it('swallows invalid stdin', async () => {
    await expect(runHook('Stop', '{{{', { port: 1, timeoutMs: 50 })).resolves.toBeUndefined();
  });
  it('logs one line when the event is unknown', async () => {
    await runHook('Whatever', JSON.stringify({ session_id: 's' }), { port: 1, timeoutMs: 50 });
    const lines = readFileSync(join(home, 'daemon.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Whatever');
  });
  it('a Codex hook from a session Ledge did not launch creates a read-only Codex session in its folder', async () => {
    const store = new Store();
    const srv = await startServer({ store, tmux: {} as never, port: 0 });
    try {
      await runHook('UserPromptSubmit', JSON.stringify(codex({ prompt: 'hi' })), { port: srv.port, tool: 'codex' });
      await new Promise(r => setTimeout(r, 50));
      expect(store.get('01a12b05-ecd8')).toMatchObject({ tool: 'codex', cwd: '/home/dev/demo', project: 'demo', state: 'working', source: 'hook_only' });
    } finally { await srv.close(); }
  });
  it('delivers the event to a live daemon within the latency budget', async () => {
    const store = new Store();
    const srv = await startServer({ store, tmux: {} as never, port: 0 });
    const t0 = Date.now();
    await runHook('Stop', JSON.stringify({ session_id: 'live-1' }), { port: srv.port });
    expect(Date.now() - t0).toBeLessThan(200);
    await new Promise(r => setTimeout(r, 50));
    expect(store.get('live-1')?.state).toBe('idle');
    await srv.close();
  });
});

/** The sender of the SendMessage tests: a Claude Ledge launched (LEDGE_SESSION=a). */
const otto = (extra: Partial<Session> = {}): Session => ({ id: 'a', name: 'Otto', tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: 'Otto · ledge', tmuxSession: 'ledge-a', state: 'working', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher', ...extra });

describe('runHook: Claude SendMessage to a Codex', () => {
  const pim = (extra: Partial<Session> = {}): Session => ({ id: 'b', name: 'Pim', tool: 'codex', cwd: '/w/api', project: 'api', title: 'Pim · api', tmuxSession: 'ledge-b', state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher', ...extra });
  const send = (to = 'Pim', message = 'Salut') => JSON.stringify({ session_id: 'uuid-a', hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 'tu1', tool_input: { to, message, summary: 'Un salut' } });
  const decision = (out: string | undefined) => (JSON.parse(out!) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } }).hookSpecificOutput;
  const tmux = { async setOption() {}, async capture() { return ''; }, async sendText() {}, async sendKeys() {} } as never;
  const withSender = (...sessions: Session[]) => { const store = new Store(); store.upsert(otto()); for (const s of sessions) store.upsert(s); return store; };
  beforeEach(() => { process.env.LEDGE_SESSION = 'a'; });

  it('a free Codex gets the message through Ledge, and the real SendMessage is denied with the reason', async () => {
    const store = withSender(pim());
    const srv = await startServer({ store, tmux, port: 0 });
    const spy = await connect({ port: srv.port }); await spy.next('snapshot');
    try {
      const out = decision(await runHook('PreToolUse', send(), { port: srv.port }));
      expect(out).toEqual({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Message transmis par Ledge à Pim (codex) : il le reçoit maintenant.' });
    } finally { await spy.close(); await srv.close(); }
  });
  it('sends session.message after the session.event, with the tool_use_id as rid', async () => {
    const got: Array<Record<string, unknown>> = [];
    const { WebSocketServer } = await import('ws');
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await new Promise(r => wss.once('listening', r));
    wss.on('connection', ws => {
      ws.send(JSON.stringify({ type: 'snapshot', sessions: [otto(), pim()] }));
      ws.on('message', d => { const m = JSON.parse(String(d)); got.push(m); if (m.type === 'session.message') ws.send(JSON.stringify({ type: 'message.ack', rid: m.rid, outcome: 'queued' })); });
    });
    try {
      const out = decision(await runHook('PreToolUse', send(), { port: (wss.address() as { port: number }).port }));
      expect(out.permissionDecisionReason).toBe("Message transmis par Ledge à Pim (codex) : il le recevra dès qu'il sera libre.");
      expect(got.map(m => m.type)).toEqual(['session.event', 'session.message']);
      expect(got[1]).toEqual({ type: 'session.message', rid: 'tu1', from: 'a', to: 'Pim', text: 'Salut', summary: 'Un salut', intercept: true });
    } finally { wss.close(); }
  });
  it('a refusal says why', async () => {
    const store = withSender(pim({ source: 'hook_only', tmuxSession: '' }));
    const srv = await startServer({ store, tmux, port: 0 });
    try {
      expect(decision(await runHook('PreToolUse', send(), { port: srv.port }))).toEqual({ hookEventName: 'PreToolUse', permissionDecision: 'deny',
        permissionDecisionReason: "Ledge n'a pas pu transmettre le message à Pim : Pim n'a pas été lancée par Ledge : impossible de lui écrire" });
    } finally { await srv.close(); }
  });
  it('a message too long for Ledge is refused to a Codex, with its length', async () => {
    const store = withSender(pim());
    const srv = await startServer({ store, tmux, port: 0 });
    try {
      expect(decision(await runHook('PreToolUse', send('Pim', 'x'.repeat(20001)), { port: srv.port })).permissionDecisionReason)
        .toBe("Ledge n'a pas pu transmettre le message à Pim : message trop long (20001 caractères, 20000 au plus)");
    } finally { await srv.close(); }
  });
  it('with no daemon listening, it resolves undefined within 2 s', async () => {
    const t0 = Date.now();
    expect(await runHook('PreToolUse', send(), { port: 1 })).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('a Claude Ledge only knows from its hooks (no LEDGE_SESSION) is left to Claude', async () => {
    delete process.env.LEDGE_SESSION;
    const store = withSender(pim());
    const srv = await startServer({ store, tmux, port: 0 });
    try { expect(await runHook('PreToolUse', send(), { port: srv.port })).toBeUndefined(); } finally { await srv.close(); }
  });
  it('a daemon that never acks leaves the real SendMessage to proceed, within 2 s', async () => {
    const { WebSocketServer } = await import('ws');
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await new Promise(r => wss.once('listening', r));
    wss.on('connection', ws => { ws.send(JSON.stringify({ type: 'snapshot', sessions: [otto(), pim()] })); });
    const t0 = Date.now();
    try {
      expect(await runHook('PreToolUse', send(), { port: (wss.address() as { port: number }).port })).toBeUndefined();
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally { wss.close(); }
  });
  it('a Codex SendMessage is never intercepted', async () => {
    const store = withSender(pim());
    const srv = await startServer({ store, tmux, port: 0 });
    try { expect(await runHook('PreToolUse', send(), { port: srv.port, tool: 'codex' })).toBeUndefined(); } finally { await srv.close(); }
  });
});

describe('runHook: Claude SendMessage to a Claude', () => {
  const ID = '3c1d9e2a-0000-4000-8000-000000000001';
  const pim = (extra: Partial<Session> = {}): Session => ({ id: 'b', name: 'Pim', tool: 'claude', cwd: '/w/api', project: 'api', title: 'Pim · api', tmuxSession: 'ledge-b', state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher', agentSessionId: ID, ...extra });
  const send = (to = 'Pim', message = 'Salut') => JSON.stringify({ session_id: 'uuid-a', hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 'tu1', tool_input: { to, message, summary: 'Un salut', content: message } });
  const decision = (out: string | undefined) => (JSON.parse(out!) as { hookSpecificOutput: Record<string, unknown> }).hookSpecificOutput;
  const note = "(message de la session Otto, pas de l'utilisateur ; pour répondre : SendMessage vers Otto)";
  let config: string; let saved: string | undefined;
  const peer = () => { mkdirSync(join(config, 'sessions'), { recursive: true }); writeFileSync(join(config, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: ID, name: 'api', messagingSocketPath: '/s/x.sock' })); };
  const serve = async (sender = otto()) => { const store = new Store(); store.upsert(sender); store.upsert(pim()); return startServer({ store, tmux: {} as never, port: 0 }); };
  beforeEach(() => { process.env.LEDGE_SESSION = 'a'; saved = process.env.CLAUDE_CONFIG_DIR; config = mkdtempSync(join(tmpdir(), 'ledge-claude-')); process.env.CLAUDE_CONFIG_DIR = config; });
  afterEach(() => { if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved; });

  it('rewrites the address to the live peer and names the sender in the message', async () => {
    peer();
    const srv = await serve();
    try {
      expect(decision(await runHook('PreToolUse', send(), { port: srv.port }))).toEqual({ hookEventName: 'PreToolUse', permissionDecision: 'allow',
        updatedInput: { to: 'uds:/s/x.sock', message: `${note} Salut`, summary: 'Un salut', content: `${note} Salut` } });
      expect((decision(await runHook('PreToolUse', send('Pim [ab12]'), { port: srv.port })).updatedInput as Record<string, unknown>).to).toBe('uds:/s/x.sock');
    } finally { await srv.close(); }
  });
  it('a message already naming its sender is not named twice (the hook installed twice)', async () => {
    peer();
    const srv = await serve();
    try {
      expect(decision(await runHook('PreToolUse', send('uds:/s/x.sock', `${note} Salut`), { port: srv.port })).updatedInput).toEqual(
        { to: 'uds:/s/x.sock', message: `${note} Salut`, summary: 'Un salut', content: `${note} Salut` });
    } finally { await srv.close(); }
  });
  it('a target with no live peer is refused, never guessed', async () => {
    const srv = await serve();
    try {
      expect(decision(await runHook('PreToolUse', send(), { port: srv.port }))).toEqual({ hookEventName: 'PreToolUse', permissionDecision: 'deny',
        permissionDecisionReason: "Ledge n'a pas pu transmettre le message à Pim : Pim n'est pas joignable" });
    } finally { await srv.close(); }
  });
  it('a message too long for Ledge still goes natively', async () => {
    peer();
    const srv = await serve();
    try { expect(decision(await runHook('PreToolUse', send('Pim', 'x'.repeat(20001)), { port: srv.port })).permissionDecision).toBe('allow'); } finally { await srv.close(); }
  });
  it('a sender Ledge did not launch is left to Claude', async () => {
    peer();
    const srv = await serve(otto({ source: 'hook_only', tmuxSession: '' }));
    try { expect(await runHook('PreToolUse', send(), { port: srv.port })).toBeUndefined(); } finally { await srv.close(); }
  });
  it('with the daemon down, the real SendMessage proceeds unchanged within the budget', async () => {
    peer();
    const srv = createServer(); await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port; await new Promise(r => srv.close(r));
    const t0 = Date.now();
    expect(await runHook('PreToolUse', send(), { port })).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('runHook: Codex runs `ledge send` and `ledge who` itself', () => {
  const sess = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'codex', cwd: '/w/api', project: 'api', title: `${name} · api`, tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher', ...extra });
  const bash = (command: unknown) => JSON.stringify({ session_id: 'thread-b', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
  const reason = (out: string | undefined) => (JSON.parse(out!) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } }).hookSpecificOutput;
  const tmux = { async setOption() {}, async capture() { return ''; }, async sendText() {}, async sendKeys() {} } as never;
  beforeEach(() => { process.env.LEDGE_CODEX_HOOK_SESSION = 'b'; });
  const fake = async (ack?: string) => {
    const got: Array<Record<string, unknown>> = [];
    const { WebSocketServer } = await import('ws');
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await new Promise(r => wss.once('listening', r));
    wss.on('connection', ws => {
      ws.send(JSON.stringify({ type: 'snapshot', sessions: [sess('a', 'Otto'), sess('b', 'Pim')] }));
      ws.on('message', d => { const m = JSON.parse(String(d)); got.push(m); if (ack && m.type === 'session.message') ws.send(JSON.stringify({ type: 'message.ack', rid: m.rid, outcome: ack })); });
    });
    return { got, port: (wss.address() as { port: number }).port, close: () => wss.close() };
  };

  it('`ledge send` reaches the daemon after the session.event, and the output is the deny reason', async () => {
    const d = await fake('accepted');
    try {
      expect(reason(await runHook('PreToolUse', bash("ledge send Otto 'Salut'"), { port: d.port, tool: 'codex' }))).toEqual({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'remis à Otto' });
      expect(d.got.map(m => m.type)).toEqual(['session.event', 'session.message']);
      expect(d.got[1]).toMatchObject({ type: 'session.message', from: 'b', to: 'Otto', text: 'Salut' });
      expect(d.got[1]).not.toHaveProperty('intercept');
    } finally { d.close(); }
  });
  it('a Codex with no Ledge id is accepted: the send travels on the hook connection that registered it', async () => {
    delete process.env.LEDGE_CODEX_HOOK_SESSION; delete process.env.LEDGE_SESSION;
    const store = new Store(); store.upsert(sess('a', 'Otto'));
    const srv = await startServer({ store, tmux, port: 0 });
    try {
      expect(reason(await runHook('PreToolUse', bash('ledge send Otto "x"'), { port: srv.port, tool: 'codex' })).permissionDecisionReason).toBe('remis à Otto');
    } finally { await srv.close(); }
  });
  it('a busy target says it is queued', async () => {
    const d = await fake('queued');
    try { expect(reason(await runHook('PreToolUse', bash('ledge send Otto Salut'), { port: d.port, tool: 'codex' })).permissionDecisionReason).toBe("Otto est occupé : il le recevra dès qu'il sera libre"); } finally { d.close(); }
  });
  it('a daemon that never acks reports it (the message may be gone), within 2 s', async () => {
    const d = await fake();
    const t0 = Date.now();
    try {
      expect(reason(await runHook('PreToolUse', bash('ledge send Otto Salut'), { port: d.port, tool: 'codex' })).permissionDecisionReason).toBe('pas de réponse de Ledge : le message est peut-être déjà parti');
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally { d.close(); }
  });
  it('`ledge who` answers with the directory', async () => {
    const store = new Store(); store.upsert(sess('a', 'Otto')); store.upsert(sess('b', 'Pim'));
    const srv = await startServer({ store, tmux, port: 0 });
    const spy = await connect({ port: srv.port }); const snap = await spy.next('snapshot');
    try {
      expect(reason(await runHook('PreToolUse', bash('ledge who'), { port: srv.port, tool: 'codex' })).permissionDecisionReason).toBe(formatWho(snap.sessions, 'b'));
    } finally { await spy.close(); await srv.close(); }
  });
  it('anything else proceeds, and nothing but the event is sent', async () => {
    const d = await fake('accepted');
    try {
      for (const c of ['ls -la', 'ledge who && ls', 'ledge send Otto "$(id)"', 42]) expect(await runHook('PreToolUse', bash(c), { port: d.port, tool: 'codex' })).toBeUndefined();
      expect(d.got.map(m => m.type)).toEqual(['session.event', 'session.event', 'session.event', 'session.event']);
    } finally { d.close(); }
  });
  it('Claude\'s Bash is never run by the hook', async () => {
    const d = await fake('accepted');
    try { expect(await runHook('PreToolUse', bash('ledge who'), { port: d.port })).toBeUndefined(); } finally { d.close(); }
  });
  it('with no daemon listening, it resolves undefined within 2 s', async () => {
    const t0 = Date.now();
    expect(await runHook('PreToolUse', bash('ledge who'), { port: 1, tool: 'codex' })).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('session identity (SessionStart additionalContext)', () => {
  const pim = (extra: Partial<Session> = {}): Session => ({ id: '7f3a', name: 'Pim', tool: 'claude', cwd: '/w/ledge-wt', project: 'ledge-wt', title: 'Pim · ledge-wt', tmuxSession: 'ledge-7f3a', state: 'starting', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher', ...extra });
  const context = (out: string | undefined) => (JSON.parse(out!) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }).hookSpecificOutput;

  it('says who the session is: its Ledge name, project, branch, worktree, and how to reach the others', () => {
    const text = identityContext({ name: 'Pim', tool: 'claude', project: 'ledge-wt', repo: 'ledge', branch: 'feat/x', worktree: true, cwd: '/w/ledge-wt' });
    expect(text).toContain('Tu es Pim, projet ledge, branche feat/x');
    expect(text).toContain('worktree ledge-wt');
    expect(text).toContain('`ledge who`');
    expect(text).toContain('Pour écrire à une autre session Ledge, Claude ou Codex, utilise son nom Ledge (donné par `ledge who`) comme adresse SendMessage : Ledge le transmet. `ListAgents` montre les noms internes de Claude, pas les noms Ledge.');
    // Codex has no SendMessage: it is told `ledge send`.
    const codex = identityContext({ name: 'Nova', tool: 'codex', project: 'api', cwd: '/w/api' });
    expect(codex).toContain('Tu es Nova, projet api');
    expect(codex).not.toMatch(/branche [^,]/);
    expect(codex).not.toContain('SendMessage');
    expect(codex).toContain('Pour écrire à une autre session Ledge, lance `ledge send <nom> "<message>"` (seul, sans && ni |). Ledge exécute lui-même `ledge send`, `ledge read`, `ledge task` et `ledge who` : leur résultat t\'arrive comme « Command blocked by PreToolUse hook: … », c\'est la réponse, pas une erreur.');
    // Both are told how to read a long message whole.
    for (const t of [text, codex]) expect(t).toContain('lance `ledge read <id>` pour le lire en entier');
    // And how to give work that must not get lost.
    for (const t of [text, codex]) expect(t).toContain('`ledge task give <nom> "<titre>" "<détail>"`');
  });

  it('a launched session is told its current Ledge name (a rename wins over LEDGE_NAME), with the daemon\'s branch', async () => {
    const store = new Store();
    store.upsert(pim({ repo: 'ledge', branch: 'main' }));
    const srv = await startServer({ store, tmux: {} as never, port: 0 });
    process.env.LEDGE_SESSION = '7f3a'; process.env.LEDGE_NAME = 'Otto';
    try {
      const out = context(await runHook('SessionStart', JSON.stringify({ session_id: 'u-1', cwd: '/w/ledge-wt', source: 'startup' }), { port: srv.port }));
      expect(out.hookEventName).toBe('SessionStart');
      expect(out.additionalContext).toContain('Tu es Pim, projet ledge, branche main');
    } finally { await srv.close(); delete process.env.LEDGE_NAME; }
  });

  it('after a compaction it is told the open tasks it holds (not those it gave, nor closed ones), and the relief it is (context handover §2)', async () => {
    const store = new Store();
    store.upsert(pim({ relieves: { id: '1b2c', name: 'Otto', at } }));
    store.upsert(pim({ id: '9d8e', name: 'Bix', tmuxSession: 'ledge-9d8e' }));
    const srv = await startServer({ store, tmux: {} as never, port: 0 });
    const c = await connect({ port: srv.port });
    const give = async (by: string, to: string, title: string) => { c.send({ type: 'task.cmd', rid: title, by, op: 'give', to, title }); return (await c.next('task.result')).task!; };
    process.env.LEDGE_SESSION = '7f3a'; process.env.LEDGE_NAME = 'Pim';
    try {
      const mine = await give('9d8e', 'Pim', 'Tests de roles.ts');
      const done = await give('9d8e', 'Pim', 'Déjà fini');
      c.send({ type: 'task.cmd', rid: 'd', by: '7f3a', op: 'done', task: done.id }); await c.next('task.result');
      await give('7f3a', 'Bix', 'Relire le hook');
      const out = context(await runHook('SessionStart', JSON.stringify({ session_id: 'u-1', cwd: '/w/ledge-wt', source: 'compact' }), { port: srv.port }));
      expect(out.additionalContext).toContain('Tes tâches en cours (elles sont gardées par Ledge, pas dans ta conversation) :');
      expect(out.additionalContext).toContain(`- ${mine.id} · ouverte · « Tests de roles.ts » · confiée par Bix`);
      expect(out.additionalContext).not.toContain('Déjà fini');
      expect(out.additionalContext).not.toContain('Relire le hook');
      expect(out.additionalContext).toContain('Tu as pris la relève de Otto, dont le contexte était plein : relis son bilan avec `ledge handover show`.');
    } finally { await c.close(); await srv.close(); delete process.env.LEDGE_NAME; }
  });

  it('a session without open tasks gets no tasks block', () => {
    expect(tasksContext([])).toBeUndefined();
    expect(identityContext({ name: 'Pim', tool: 'claude', project: 'ledge', cwd: '/w' })).not.toContain('Tes tâches en cours');
  });

  it('without a daemon, the name comes from LEDGE_NAME and the project from the folder', async () => {
    process.env.LEDGE_SESSION = '7f3a'; process.env.LEDGE_NAME = 'Otto';
    try {
      const out = context(await runHook('SessionStart', JSON.stringify({ session_id: 'u-1', cwd: join(home, 'shop') }), { port: 1, timeoutMs: 50 }));
      expect(out.additionalContext).toContain('Tu es Otto, projet shop');
    } finally { delete process.env.LEDGE_NAME; }
  });

  it('says nothing to a session Ledge did not launch, nor on another event', async () => {
    expect(await runHook('SessionStart', JSON.stringify({ session_id: 'u-1', cwd: '/w' }), { port: 1, timeoutMs: 50 })).toBeUndefined();
    process.env.LEDGE_SESSION = '7f3a'; process.env.LEDGE_NAME = 'Otto';
    try { expect(await runHook('Stop', JSON.stringify({ session_id: 'u-1' }), { port: 1, timeoutMs: 50 })).toBeUndefined(); }
    finally { delete process.env.LEDGE_NAME; }
  });
});

// Payloads as Cursor Agent 2026.10 sends them (trimmed of workspace_roots, user_email, model and token counts).
const MAIN = { conversation_id: 'b617', session_id: 'b617', generation_id: '3885', hook_event_name: '' };
const SUB = { conversation_id: 'b335', session_id: 'b335', generation_id: 'b335', hook_event_name: '' };
const cursor = (name: string, extra: Record<string, unknown> = {}, ids = MAIN) => mapCursorHook(name, { ...ids, hook_event_name: name, ...extra }, at);

describe('mapCursorHook', () => {
  it('uses LEDGE_SESSION when set, else session_id; names the agent and the first workspace root', () => {
    expect(cursor('beforeSubmitPrompt', { prompt: 'hi' })).toEqual({ id: 'b617', event: { name: 'UserPromptSubmit', at, source: 'hook', agentSessionId: 'b617', text: 'hi' }, agent: 'cursor' });
    expect(cursor('beforeSubmitPrompt', { workspace_roots: ['/w/demo'] })?.cwd).toBe('/w/demo');
    process.env.LEDGE_SESSION = '7f3a';
    expect(cursor('beforeSubmitPrompt')?.id).toBe('7f3a');
  });
  it('maps sessionStart (its generation is the conversation) to SessionStart', () => {
    expect(cursor('sessionStart', {}, { ...MAIN, generation_id: 'b617' })?.event.name).toBe('SessionStart');
  });
  it('maps preToolUse Shell to the command and Write to the file', () => {
    expect(cursor('preToolUse', { tool_name: 'Shell', tool_input: { command: 'touch probe-file', cwd: '', timeout: 30000 } })?.event)
      .toEqual({ name: 'PreToolUse', at, source: 'hook', agentSessionId: 'b617', tool: 'Shell', text: 'touch probe-file' });
    expect(cursor('preToolUse', { tool_name: 'Write', tool_input: { file_path: '/w/a.txt', content: '' } })?.event.text).toBe('/w/a.txt');
  });
  it('maps postToolUse and postToolUseFailure, with the interrupt flag', () => {
    expect(cursor('postToolUse', { tool_name: 'Shell' })?.event).toEqual({ name: 'PostToolUse', at, source: 'hook', agentSessionId: 'b617', tool: 'Shell' });
    expect(cursor('postToolUse', { tool_name: 'Shell', tool_input: { command: 'ls' } })?.event).toEqual({ name: 'PostToolUse', at, source: 'hook', agentSessionId: 'b617', tool: 'Shell', toolInput: { command: 'ls' } });
    expect(cursor('postToolUseFailure', { tool_name: 'Shell', tool_input: { command: 'x' } })?.event.toolInput).toEqual({ command: 'x' });
    // A CallDynamicTool is its inner tool: the name and the input are the unwrapped ones.
    const dynamic = { tool_name: 'CallDynamicTool', tool_input: { namespace: 'cursor', toolName: 'Read', arguments: { file_path: '/w/a.ts' } } };
    expect(cursor('postToolUse', dynamic)?.event).toEqual({ name: 'PostToolUse', at, source: 'hook', agentSessionId: 'b617', tool: 'Read', toolInput: { file_path: '/w/a.ts' } });
    expect(cursor('postToolUseFailure', dynamic)?.event).toMatchObject({ tool: 'Read', toolInput: { file_path: '/w/a.ts' } });
    expect(cursor('postToolUseFailure', { tool_name: 'Read', failure_type: 'error', is_interrupt: false })?.event.interrupt).toBeUndefined();
    expect(cursor('postToolUseFailure', { tool_name: 'Shell', is_interrupt: true })?.event.interrupt).toBe(true);
  });
  it('maps stop completed and aborted to Stop, error to StopFailure', () => {
    expect(cursor('stop', { status: 'completed', loop_count: 0 })?.event.name).toBe('Stop');
    expect(cursor('stop', { status: 'aborted' })?.event.name).toBe('Stop');
    expect(cursor('stop', { status: 'error' })?.event.name).toBe('StopFailure');
  });
  it('maps afterAgentResponse to a Stop that carries the reply, capped', () => {
    expect(cursor('afterAgentResponse', { text: '  done  ' })?.event).toEqual({ name: 'Stop', at, source: 'hook', agentSessionId: 'b617', text: 'done' });
    expect(cursor('afterAgentResponse', { text: '' })?.event).toEqual({ name: 'Stop', at, source: 'hook', agentSessionId: 'b617' });
    expect(cursor('afterAgentResponse', { text: 'x'.repeat(REPLY_MAX + 10) })?.event.text?.endsWith('[…]')).toBe(true);
  });
  it('maps sessionEnd only for an untracked session: under the launcher the exit is the launcher\'s', () => {
    expect(cursor('sessionEnd', { reason: 'completed', final_status: 'completed' })?.event).toEqual({ name: 'SessionEnd', at, source: 'hook', agentSessionId: 'b617', exitCode: null });
    process.env.LEDGE_SESSION = '7f3a';
    expect(cursor('sessionEnd', { reason: 'completed' })).toBeNull();
  });
  describe('subagents (no subagentStart/Stop: the transcript path names the parent)', () => {
    // As Cursor Agent writes them: ~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl
    let dir: string; let parentPath: string;
    const line = (role: string, content: unknown[]) => JSON.stringify({ role, message: { content } });
    const PROMPT = 'Your only job is to read notes.txt and report it.';
    beforeEach(() => {
      dir = join(mkdtempSync(join(tmpdir(), 'ledge-tr-')), 'agent-transcripts');
      mkdirSync(join(dir, 'b617'), { recursive: true });
      parentPath = join(dir, 'b617', 'b617.jsonl');
      writeFileSync(parentPath, [
        line('user', [{ type: 'text', text: '<timestamp>Sunday</timestamp>\n<user_query>\nuse a subagent\n</user_query>' }]),
        line('assistant', [{ type: 'text', text: 'Launching it.' }, { type: 'tool_use', name: 'Task', input: { description: 'Read notes.txt content', prompt: PROMPT, subagent_type: 'explore', run_in_background: false } }])
      ].join('\n') + '\n');
    });
    const env = (extra: Record<string, string> = {}) => ({ CURSOR_TRANSCRIPT_PATH: parentPath, ...extra });
    it('the parent\'s Task names a helper; the subagent\'s tool runs are that parent\'s helper', () => {
      const task = { ...MAIN, conversation_id: 'b617', session_id: 'b617', tool_name: 'Task', tool_use_id: 'call-1\nfc_x', tool_input: { description: 'Read notes.txt content', prompt: PROMPT, subagent_type: 'explore' } };
      expect(mapCursorHook('preToolUse', task, at, env())?.event).toEqual({ name: 'SubagentStart', at, source: 'hook', helperId: 'task:call-1', tool: 'explore', text: 'Read notes.txt content' });
      const dynamic = { ...task, tool_name: 'CallDynamicTool', tool_input: { namespace: 'cursor', toolName: 'Task', arguments: task.tool_input } };
      expect(mapCursorHook('preToolUse', dynamic, at, env())?.event).toMatchObject({ name: 'SubagentStart', tool: 'explore', text: 'Read notes.txt content' });
      expect(mapCursorHook('preToolUse', { ...SUB, tool_name: 'Read', tool_input: { file_path: '/w/notes.txt' } }, at, env()))
        .toEqual({ id: 'b617', agent: 'cursor', event: { name: 'SubagentStart', at, source: 'hook', helperId: 'b335' } });
      expect(mapCursorHook('postToolUse', { ...SUB, tool_name: 'Read' }, at, env())?.event).toEqual({ name: 'PostToolUse', at, source: 'hook', helperId: 'b335', tool: 'Read' });
    });
    it('tracked, the helper belongs to the Ledge session', () => {
      expect(mapCursorHook('preToolUse', { ...SUB, tool_name: 'Read' }, at, env({ LEDGE_SESSION: '7f3a' }))?.id).toBe('7f3a');
    });
    it('the main thread, whose session is its transcript\'s, stays the main thread', () => {
      expect(mapCursorHook('preToolUse', { ...MAIN, conversation_id: 'b617', session_id: 'b617', tool_name: 'Shell', tool_input: { command: 'ls' } }, at, env())?.event)
        .toEqual({ name: 'PreToolUse', at, source: 'hook', agentSessionId: 'b617', tool: 'Shell', text: 'ls' });
    });
    it('with no transcript path: a subagent by its generation id; dropped untracked, a helper tracked', () => {
      expect(mapCursorHook('preToolUse', { ...SUB, tool_name: 'Shell' }, at, {})).toBeNull();
      expect(mapCursorHook('preToolUse', { ...SUB, tool_name: 'Shell' }, at, { LEDGE_SESSION: '7f3a' })).toMatchObject({ id: '7f3a', event: { name: 'SubagentStart', helperId: 'b335' } });
    });
    it('the reply keeps the turn\'s text blocks apart, as the transcript has them', () => {
      writeFileSync(parentPath, [
        line('user', [{ type: 'text', text: '<user_query>go</user_query>' }]),
        line('assistant', [{ type: 'text', text: "I'll run it." }, { type: 'tool_use', name: 'Shell' }]),
        line('assistant', [{ type: 'text', text: '[REDACTED]' }]),
        line('assistant', [{ type: 'text', text: 'Done:\n- a' }])
      ].join('\n') + '\n');
      expect(mapCursorHook('afterAgentResponse', { ...MAIN, conversation_id: 'b617', session_id: 'b617', text: "I'll run it.Done:\n- a" }, at, env())?.event.text).toBe("I'll run it.\n\nDone:\n- a");
      // A transcript that says something else (not written yet) leaves the hook's text as it is.
      expect(mapCursorHook('afterAgentResponse', { ...MAIN, conversation_id: 'b617', session_id: 'b617', text: 'other' }, at, env())?.event.text).toBe('other');
    });
  });
  it('returns null for an event Ledge does not listen to, or a malformed payload', () => {
    expect(cursor('afterAgentThought', { text: 'thinking' })).toBeNull();
    expect(mapCursorHook('stop', null, at)).toBeNull();
    expect(mapCursorHook('stop', { status: 'completed' }, at)).toBeNull();
  });
  it('a first Cursor hook makes a read-only Cursor Agent session, not a Claude one', async () => {
    const store = new Store();
    const srv = await startServer({ store, tmux: {} as never, port: 0 });
    await runHook('beforeSubmitPrompt', JSON.stringify({ ...MAIN, prompt: 'hi', workspace_roots: ['/w/demo'] }), { port: srv.port, tool: 'cursor' });
    await new Promise(r => setTimeout(r, 50));
    expect(store.get('b617')).toMatchObject({ tool: 'cursor', cwd: '/w/demo', project: 'demo', state: 'working', source: 'hook_only' });
    await srv.close();
  });
});

describe('SessionEnd against a live daemon', () => {
  it('a launcher session survives Claude SessionEnd and unregister records the real exit code', async () => {
    const store = new Store();
    const srv = await startServer({ store, tmux: { async setOption() {} } as never, port: 0 });
    try {
      store.upsert({ id: '7f3a', name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto · w', tmuxSession: 'ledge-7f3a', state: 'working', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher' });
      process.env.LEDGE_SESSION = '7f3a';
      await runHook('SessionEnd', JSON.stringify({ session_id: 'uuid', reason: 'clear' }), { port: srv.port });
      await runHook('SessionEnd', JSON.stringify({ session_id: 'uuid', reason: 'prompt_input_exit' }), { port: srv.port });
      await new Promise(r => setTimeout(r, 50));
      expect(store.get('7f3a')?.state).toBe('working');
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.unregister', id: '7f3a', exitCode: 3 });
      const upd = await c.next('session.updated');
      expect(upd.session.state).toBe('exited');
      expect(upd.session.exitCode).toBe(3);
      await c.close();
    } finally { await srv.close(); }
  });
  it('register keeps the exit of a hook_only session that already ended', async () => {
    const store = new Store();
    const srv = await startServer({ store, tmux: { async setOption() {} } as never, port: 0 });
    try {
      const ended = { id: 'b', name: 'Pim', tool: 'claude' as const, cwd: '', project: 'unknown', title: 'untracked session', tmuxSession: null, state: 'exited' as const, helpers: [], startedAt: at, lastActivityAt: at, exitCode: 2, exitedAt: at, source: 'hook_only' as const };
      store.upsert(ended);
      const c = await connect({ port: srv.port }); await c.next('snapshot');
      c.send({ type: 'session.register', session: { ...ended, state: 'starting', exitCode: null, exitedAt: undefined, tmuxSession: 'ledge-b', source: 'launcher' } });
      const upd = await c.next('session.updated');
      expect(upd.session.source).toBe('launcher');
      expect(upd.session.state).toBe('exited');
      expect(upd.session.exitCode).toBe(2);
      expect(upd.session.exitedAt).toBe(at);
      await c.close();
    } finally { await srv.close(); }
  });
});

describe('ledge hook (CLI)', () => {
  it('always exits 0, even with invalid stdin and no daemon', () => {
    const r = spawnSync('pnpm', ['exec', 'tsx', 'src/cli/index.ts', 'hook', 'Stop'], { input: '{{{', env: { ...process.env, LEDGE_HOME: home }, encoding: 'utf8' });
    expect(r.status).toBe(0);
  });
  it('takes the agent before the event (ledge hook codex Stop) and exits 0 too', () => {
    const r = spawnSync('pnpm', ['exec', 'tsx', 'src/cli/index.ts', 'hook', 'codex', 'Whatever'], { input: '{"session_id":"s"}', env: { ...process.env, LEDGE_HOME: home }, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(readFileSync(join(home, 'daemon.log'), 'utf8')).toContain('hook codex Whatever ignored');
  });
  it('a Cursor hook always exits 0 and answers {} on stdout, which lets the agent go on', () => {
    const r = spawnSync('pnpm', ['exec', 'tsx', 'src/cli/index.ts', 'hook', 'cursor', 'preToolUse'], { input: '{{{', env: { ...process.env, LEDGE_HOME: home }, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{}');
  });
});

describe('prompts and the chat marker', () => {
  const at = '2026-10-11T10:00:00.000Z';
  it('UserPromptSubmit carries the prompt, cut to 500 characters', () => {
    const m = mapClaudeHook('UserPromptSubmit', { session_id: 's', prompt: 'x'.repeat(600) }, at);
    expect(m?.event.name).toBe('UserPromptSubmit'); expect(m?.event.text).toHaveLength(500);
    expect(mapClaudeHook('UserPromptSubmit', { session_id: 's' }, at)?.event.text).toBeUndefined();
    // A helper's hand-back is its report: kept whole up to the tool input cap.
    const back = `<agent-message from="a82b">\n[Subagent hand-back] The text below is the final report.\n${'  ligne du rapport\n'.repeat(160)}</agent-message>`;
    expect(back.length).toBeGreaterThan(3000);
    expect(mapClaudeHook('UserPromptSubmit', { session_id: 's', prompt: back }, at)?.event.text).toBe(back);
    expect(mapClaudeHook('UserPromptSubmit', { session_id: 's', prompt: back + 'x'.repeat(INPUT_MAX) }, at)?.event.text).toHaveLength(INPUT_MAX);
  });
  it('keeps a cross-session message whole (up to INPUT_MAX)', () => {
    const prompt = '<cross-session-message from="uds:/run/user/1000/cc-socks/1.sock" from-name="a-2d" from-mode="prompting">\n' + 'x'.repeat(3000);
    expect(mapClaudeHook('UserPromptSubmit', { session_id: 's', prompt }, at)?.event.text).toHaveLength(prompt.length);
    expect(mapClaudeHook('UserPromptSubmit', { session_id: 's', prompt: 'x'.repeat(3000) }, at)?.event.text).toHaveLength(500);
  });
  it('keeps a cross-session notice whole (up to INPUT_MAX), not cut like a prompt', () => {
    const prompt = '[Cross-session idle notice] "a-2d", which you asked to be notified about, is idle now. Its harness reports: «' + 'x'.repeat(3000) + '».';
    expect(mapClaudeHook('UserPromptSubmit', { session_id: 's', prompt }, at)?.event.text).toHaveLength(prompt.length);
  });
  it('labels SendMessage with its summary', () => {
    const tool_input = { to: 'a-bf', summary: 'OK pour la sidebar', message: 'long' };
    expect(mapClaudeHook('PreToolUse', { session_id: 's', tool_name: 'SendMessage', tool_input }, at)?.event.text).toBe('OK pour la sidebar');
    expect(mapClaudeHook('PreToolUse', { session_id: 's', tool_name: 'SendMessage', tool_input: { to: 'a-bf', summary: '', message: 'long' } }, at)?.event.text).toBe('→ a-bf');
    const m = mapClaudeHook('PreToolUse', { session_id: 's', tool_name: 'SendMessage', tool_input: { to: 'a-bf', message: 'long' } }, at);
    expect(m?.event.text).toBe('→ a-bf');
    expect(m?.event.toolInput).toEqual({ to: 'a-bf', message: 'long' });
  });
  it('Cursor beforeSubmitPrompt carries the prompt too', () => {
    const m = mapCursorHook('beforeSubmitPrompt', { session_id: 's', prompt: 'Corrige le test' }, at, {});
    expect(m?.event).toMatchObject({ name: 'UserPromptSubmit', text: 'Corrige le test' });
  });
});

describe('the agent conversation id', () => {
  it('a Claude or Codex hook carries the agent session id', () => {
    for (const agent of ['claude', 'codex'] as const)
      expect(mapHook(agent, 'Stop', { session_id: 'c-1', cwd: '/w' }, at)!.event.agentSessionId).toBe('c-1');
  });

  it('a Cursor hook carries its conversation id, a helper hook none', () => {
    expect(mapCursorHook('stop', { conversation_id: 'k-1' }, at, { LEDGE_SESSION: 'ab12' })!.event.agentSessionId).toBe('k-1');
    const helper = mapCursorHook('postToolUse', { session_id: 'b335', tool_name: 'Read' }, at, { LEDGE_SESSION: 'ab12', CURSOR_TRANSCRIPT_PATH: '/t/b617.jsonl' })!;
    expect(helper.event.helperId).toBe('b335');
    expect(helper.event.agentSessionId).toBeUndefined();
  });
});
