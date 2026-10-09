import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { mapClaudeHook, runHook } from '../src/cli/hook.js';
import { startServer } from '../src/daemon/server.js';
import { Store } from '../src/daemon/store.js';

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

describe('ledge hook (CLI)', () => {
  it('always exits 0, even with invalid stdin and no daemon', () => {
    const r = spawnSync('pnpm', ['exec', 'tsx', 'src/cli/index.ts', 'hook', 'Stop'], { input: '{{{', env: { ...process.env, LEDGE_HOME: home }, encoding: 'utf8' });
    expect(r.status).toBe(0);
  });
});
