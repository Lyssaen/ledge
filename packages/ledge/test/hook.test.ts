import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { mapClaudeHook, runHook } from '../src/cli/hook.js';
import { startServer } from '../src/daemon/server.js';
import { Store } from '../src/daemon/store.js';
import { connect } from '../src/client.js';

const at = '2026-10-09T18:00:00.000Z';
let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ledge-hook-')); process.env.LEDGE_HOME = home; delete process.env.LEDGE_SESSION; });

describe('mapClaudeHook', () => {
  it('uses LEDGE_SESSION when set, else session_id', () => {
    process.env.LEDGE_SESSION = '7f3a';
    expect(mapClaudeHook('Stop', { session_id: 'uuid-1' }, at)?.id).toBe('7f3a');
    delete process.env.LEDGE_SESSION;
    expect(mapClaudeHook('Stop', { session_id: 'uuid-1' }, at)?.id).toBe('uuid-1');
  });
  it('maps PermissionRequest for Bash to a permission event with the command', () => {
    const m = mapClaudeHook('PermissionRequest', { session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run tests' } }, at);
    expect(m?.event).toEqual({ name: 'PermissionRequest', at, source: 'hook', tool: 'Bash', text: 'npm test' });
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

describe('SessionEnd against a live daemon', () => {
  it('a launcher session survives Claude SessionEnd and unregister records the real exit code', async () => {
    const store = new Store();
    const srv = await startServer({ store, tmux: {} as never, port: 0 });
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
    const srv = await startServer({ store, tmux: {} as never, port: 0 });
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
});
