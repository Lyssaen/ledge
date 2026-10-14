import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { mapClaudeHook, mapHook, mapCursorHook, runHook, codexLedgeId, underCodexDaemon, REPLY_MAX } from '../src/cli/hook.js';
import { startServer } from '../src/daemon/server.js';
import { Store } from '../src/daemon/store.js';
import { connect } from '../src/client.js';

const at = '2026-10-09T18:00:00.000Z';
let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ledge-hook-')); process.env.LEDGE_HOME = home; delete process.env.LEDGE_SESSION; delete process.env.LEDGE_CODEX_SESSION; delete process.env.LEDGE_CODEX_HOOK_SESSION; });

describe('mapClaudeHook', () => {
  it('a Bash permission carries the tool description as reason', () => {
    expect(mapClaudeHook('PermissionRequest', { session_id: 's', tool_name: 'Bash', tool_input: { command: 'pnpm test', description: 'Run the overlay tests' } }, at)!.event.reason).toBe('Run the overlay tests');
  });
  it('a permission without a Bash description has no reason', () => {
    expect(mapClaudeHook('PermissionRequest', { session_id: 's', tool_name: 'Bash', tool_input: { command: 'ls' } }, at)!.event.reason).toBeUndefined();
  });
  it('uses LEDGE_SESSION when set, else session_id', () => {
    process.env.LEDGE_SESSION = '7f3a';
    expect(mapClaudeHook('Stop', { session_id: 'uuid-1' }, at)?.id).toBe('7f3a');
    delete process.env.LEDGE_SESSION;
    expect(mapClaudeHook('Stop', { session_id: 'uuid-1' }, at)?.id).toBe('uuid-1');
  });
  it('maps PermissionRequest for Bash to a permission event with the command', () => {
    const m = mapClaudeHook('PermissionRequest', { session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run tests' } }, at);
    expect(m?.event).toMatchObject({ name: 'PermissionRequest', at, source: 'hook', tool: 'Bash', text: 'npm test' });
  });
  it('maps PermissionRequest for Edit to the file path', () => {
    const m = mapClaudeHook('PermissionRequest', { session_id: 's', tool_name: 'Edit', tool_input: { file_path: '/w/src/a.ts' } }, at);
    expect(m?.event.text).toBe('/w/src/a.ts');
  });
  it('maps PreToolUse AskUserQuestion with its options', () => {
    const payload = { session_id: 's', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] } };
    const m = mapClaudeHook('PreToolUse', payload, at);
    expect(m?.event).toEqual({ name: 'PreToolUse', at, source: 'hook', tool: 'AskUserQuestion', text: 'Which?', options: ['A', 'B'] });
  });
  it('maps Notification permission_prompt to kind permission', () => {
    const m = mapClaudeHook('Notification', { session_id: 's', notification_type: 'permission_prompt', message: 'Claude needs your permission' }, at);
    expect(m?.event.kind).toBe('permission');
  });
  it('maps SessionEnd with no code', () => {
    expect(mapClaudeHook('SessionEnd', { session_id: 's' }, at)?.event).toEqual({ name: 'SessionEnd', at, source: 'hook', exitCode: null });
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
      expect(mapClaudeHook('SessionEnd', { session_id: 's', reason }, at)?.event).toEqual({ name: 'SessionEnd', at, source: 'hook', exitCode: null });
    });
  });
  // Payload shapes from Claude Code 2.1.296 (field names read from the installed binary's hook input schemas).
  const common = { session_id: 's', transcript_path: '/h/.claude/projects/p/s.jsonl', cwd: '/w', permission_mode: 'default' };
  it('maps PostToolUse with its tool', () => {
    const payload = { ...common, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' }, tool_use_id: 'toolu_1', duration_ms: 812 };
    expect(mapClaudeHook('PostToolUse', payload, at)?.event).toEqual({ name: 'PostToolUse', at, source: 'hook', tool: 'Bash' });
  });
  it('maps PostToolUseFailure with its tool', () => {
    const payload = { ...common, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'false' }, tool_use_id: 'toolu_2', error: 'Exit code 1', is_interrupt: false };
    expect(mapClaudeHook('PostToolUseFailure', payload, at)?.event).toEqual({ name: 'PostToolUseFailure', at, source: 'hook', tool: 'Bash' });
  });
  it('maps an interrupted PostToolUseFailure (Esc) with interrupt set', () => {
    const payload = { ...common, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'sleep 60' }, tool_use_id: 'toolu_3', error: 'Interrupted by user', is_interrupt: true };
    expect(mapClaudeHook('PostToolUseFailure', payload, at)?.event).toEqual({ name: 'PostToolUseFailure', at, source: 'hook', tool: 'Bash', interrupt: true });
  });
  it('maps Stop with the last assistant message as the reply text', () => {
    const payload = { ...common, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: '  ## Done\n\nAll green.  ' };
    expect(mapClaudeHook('Stop', payload, at)?.event).toEqual({ name: 'Stop', at, source: 'hook', text: '## Done\n\nAll green.' });
  });
  it('maps Stop without a message (older Claude Code) or with a blank one to a bare Stop', () => {
    expect(mapClaudeHook('Stop', { ...common, hook_event_name: 'Stop', stop_hook_active: false }, at)?.event).toEqual({ name: 'Stop', at, source: 'hook' });
    expect(mapClaudeHook('Stop', { ...common, last_assistant_message: '   ' }, at)?.event).toEqual({ name: 'Stop', at, source: 'hook' });
  });
  it('caps a very long reply and marks the cut', () => {
    const text = mapClaudeHook('Stop', { ...common, last_assistant_message: 'x'.repeat(REPLY_MAX + 500) }, at)?.event.text!;
    expect(text.length).toBeLessThan(REPLY_MAX + 20);
    expect(text.endsWith('[…]')).toBe(true);
  });
  it('maps StopFailure with its error and details', () => {
    const payload = { ...common, hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429 Too Many Requests', last_assistant_message: 'Working on it' };
    expect(mapClaudeHook('StopFailure', payload, at)?.event).toEqual({ name: 'StopFailure', at, source: 'hook', text: 'rate_limit: 429 Too Many Requests' });
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
  it('maps SubagentStop to the helper id', () => {
    const payload = { ...common, hook_event_name: 'SubagentStop', stop_hook_active: false, agent_id: 'a7c2e', agent_transcript_path: '/t/a7c2e.jsonl', agent_type: 'Explore', last_assistant_message: 'done' };
    expect(mapClaudeHook('SubagentStop', payload, at)?.event).toEqual({ name: 'SubagentStop', at, source: 'hook', helperId: 'a7c2e', tool: 'Explore' });
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
    expect(m?.event).toMatchObject({ name: 'PermissionRequest', at, source: 'hook', tool: 'Bash', text: "printf '%s\\n' hi > hello.txt" });
  });
  it('maps an apply_patch PermissionRequest to the files it touches', () => {
    const command = '*** Begin Patch\n*** Update File: /home/dev/demo/README.md\n@@\n # demo\n+bye\n*** Add File: /home/dev/demo/b.txt\n+b\n*** End Patch';
    const m = mapHook('codex', 'PermissionRequest', codex({ tool_name: 'apply_patch', tool_input: { command } }), at);
    expect(m?.event).toEqual({ name: 'PermissionRequest', at, source: 'hook', tool: 'apply_patch', text: '/home/dev/demo/README.md, /home/dev/demo/b.txt' });
  });
  it('maps request_user_input to a question with its options', () => {
    const tool_input = { questions: [{ header: 'Banner color', id: 'banner_color', question: 'Which color should the banner be?', options: [{ label: 'Blue (Recommended)', description: 'calm' }, { label: 'Red', description: 'bold' }] }] };
    const m = mapHook('codex', 'PreToolUse', codex({ tool_name: 'request_user_input', tool_input }), at);
    expect(m?.event).toEqual({ name: 'PreToolUse', at, source: 'hook', tool: 'request_user_input', text: 'Which color should the banner be?', options: ['Blue (Recommended)', 'Red'] });
  });
  it('maps Stop with its last message, and a null one to a bare Stop', () => {
    expect(mapHook('codex', 'Stop', codex({ stop_hook_active: false, last_assistant_message: 'Created `hello.txt`.' }), at)?.event).toEqual({ name: 'Stop', at, source: 'hook', text: 'Created `hello.txt`.' });
    expect(mapHook('codex', 'Stop', codex({ stop_hook_active: false, last_assistant_message: null }), at)?.event).toEqual({ name: 'Stop', at, source: 'hook' });
  });
  it('maps Interrupt (Esc on a turn or on an approval) to an interrupted tool run: Codex waits, no Stop follows', () => {
    expect(mapHook('codex', 'Interrupt', codex({}), at)?.event).toEqual({ name: 'PostToolUseFailure', at, source: 'hook', interrupt: true });
  });
  it('SessionEnd ends a session Ledge did not launch; under Ledge the pane and the exit code tell', () => {
    expect(mapHook('codex', 'SessionEnd', codex({}), at)?.event).toEqual({ name: 'SessionEnd', at, source: 'hook', exitCode: null });
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

// Payloads as Cursor Agent 2026.10 sends them (trimmed of workspace_roots, user_email, model and token counts).
const MAIN = { conversation_id: 'b617', session_id: 'b617', generation_id: '3885', hook_event_name: '' };
const SUB = { conversation_id: 'b335', session_id: 'b335', generation_id: 'b335', hook_event_name: '' };
const cursor = (name: string, extra: Record<string, unknown> = {}, ids = MAIN) => mapCursorHook(name, { ...ids, hook_event_name: name, ...extra }, at);

describe('mapCursorHook', () => {
  it('uses LEDGE_SESSION when set, else session_id; names the agent and the first workspace root', () => {
    expect(cursor('beforeSubmitPrompt', { prompt: 'hi' })).toEqual({ id: 'b617', event: { name: 'UserPromptSubmit', at, source: 'hook', text: 'hi' }, agent: 'cursor' });
    expect(cursor('beforeSubmitPrompt', { workspace_roots: ['/w/demo'] })?.cwd).toBe('/w/demo');
    process.env.LEDGE_SESSION = '7f3a';
    expect(cursor('beforeSubmitPrompt')?.id).toBe('7f3a');
  });
  it('maps sessionStart (its generation is the conversation) to SessionStart', () => {
    expect(cursor('sessionStart', {}, { ...MAIN, generation_id: 'b617' })?.event.name).toBe('SessionStart');
  });
  it('maps preToolUse Shell to the command and Write to the file', () => {
    expect(cursor('preToolUse', { tool_name: 'Shell', tool_input: { command: 'touch probe-file', cwd: '', timeout: 30000 } })?.event)
      .toEqual({ name: 'PreToolUse', at, source: 'hook', tool: 'Shell', text: 'touch probe-file' });
    expect(cursor('preToolUse', { tool_name: 'Write', tool_input: { file_path: '/w/a.txt', content: '' } })?.event.text).toBe('/w/a.txt');
  });
  it('maps postToolUse and postToolUseFailure, with the interrupt flag', () => {
    expect(cursor('postToolUse', { tool_name: 'Shell' })?.event).toEqual({ name: 'PostToolUse', at, source: 'hook', tool: 'Shell' });
    expect(cursor('postToolUseFailure', { tool_name: 'Read', failure_type: 'error', is_interrupt: false })?.event.interrupt).toBeUndefined();
    expect(cursor('postToolUseFailure', { tool_name: 'Shell', is_interrupt: true })?.event.interrupt).toBe(true);
  });
  it('maps stop completed and aborted to Stop, error to StopFailure', () => {
    expect(cursor('stop', { status: 'completed', loop_count: 0 })?.event.name).toBe('Stop');
    expect(cursor('stop', { status: 'aborted' })?.event.name).toBe('Stop');
    expect(cursor('stop', { status: 'error' })?.event.name).toBe('StopFailure');
  });
  it('maps afterAgentResponse to a Stop that carries the reply, capped', () => {
    expect(cursor('afterAgentResponse', { text: '  done  ' })?.event).toEqual({ name: 'Stop', at, source: 'hook', text: 'done' });
    expect(cursor('afterAgentResponse', { text: '' })?.event).toEqual({ name: 'Stop', at, source: 'hook' });
    expect(cursor('afterAgentResponse', { text: 'x'.repeat(REPLY_MAX + 10) })?.event.text?.endsWith('[…]')).toBe(true);
  });
  it('maps sessionEnd only for an untracked session: under the launcher the exit is the launcher\'s', () => {
    expect(cursor('sessionEnd', { reason: 'completed', final_status: 'completed' })?.event).toEqual({ name: 'SessionEnd', at, source: 'hook', exitCode: null });
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
        .toEqual({ name: 'PreToolUse', at, source: 'hook', tool: 'Shell', text: 'ls' });
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
  });
  it('Cursor beforeSubmitPrompt carries the prompt too', () => {
    const m = mapCursorHook('beforeSubmitPrompt', { session_id: 's', prompt: 'Corrige le test' }, at, {});
    expect(m?.event).toMatchObject({ name: 'UserPromptSubmit', text: 'Corrige le test' });
  });
});
