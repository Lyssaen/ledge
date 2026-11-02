import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { SessionCommandsListingSchema } from '@ledge/protocol';
import { CLAUDE_PROBE_ARGS, claudeSlashRefusal, createCommands, parseClaudeCommands, probeClaude } from '../src/daemon/commands.js';

// The shapes Claude Code 2.1.316 answers `initialize` with (trimmed).
const RAW = [
  { name: 'compact', description: 'Free up context by summarizing the conversation so far', argumentHint: '<optional custom summarization instructions>', builtin: true },
  { name: 'code-review', description: 'Review the current diff', argumentHint: '[low|medium|high]', aliases: ['review'], builtin: true },
  { name: 'model', description: 'Set the AI model for Claude Code', argumentHint: '<model>', builtin: true },
  { name: 'usage', description: 'Show session cost', argumentHint: '', aliases: ['cost', 'stats'], builtin: true },
  { name: 'agents', description: '(removed) Ask Claude to create/manage subagents', argumentHint: '', builtin: true },
  { name: 'extra-usage', description: 'Renamed to /usage-credits', argumentHint: '', builtin: true },
  { name: '__remote-workflow', description: 'internal', builtin: true },
  { name: 'workflow-launch-exec', description: 'Execute a server-launched workflow handoff', builtin: true },
  { name: 'git:push-it', description: 'Commit and push (project)', argumentHint: '<message>' },
  { name: 'bar', description: 'Bar skill (user)', argumentHint: '' },
  { name: 'pdf', description: 'Use this skill with PDF files. (claude.ai sync)', argumentHint: '', aliases: ['anthropic-skills:pdf'] },
  { name: 'cowork:customize', description: '(cowork) Customize a plugin.', argumentHint: '', aliases: ['customize'] },
  { name: 'bad name', description: 'not a command name' },
  { name: 'compact', description: 'a duplicate', builtin: true }
];

describe('parseClaudeCommands', () => {
  const list = parseClaudeCommands(RAW);
  const by = (n: string) => list.find(c => c.name === n);
  it('keeps the commands a person types, with their source read from the description', () => {
    expect(list.map(c => c.name)).toEqual(['compact', 'code-review', 'model', 'usage', 'git:push-it', 'bar', 'pdf', 'cowork:customize', 'exit']);
    expect(by('compact')).toEqual({ name: 'compact', source: 'builtin', description: 'Free up context by summarizing the conversation so far', argumentHint: '<optional custom summarization instructions>' });
    expect(by('git:push-it')).toMatchObject({ source: 'project', description: 'Commit and push', argumentHint: '<message>' });
    expect(by('bar')).toEqual({ name: 'bar', source: 'user', description: 'Bar skill' });
    expect(by('pdf')).toMatchObject({ source: 'user', description: 'Use this skill with PDF files.', aliases: ['anthropic-skills:pdf'] });
    expect(by('cowork:customize')).toMatchObject({ source: 'plugin', description: 'Customize a plugin.', aliases: ['customize'] });
    expect(by('code-review')).toMatchObject({ aliases: ['review'] });
  });
  it('marks what opens a terminal panel, and adds /exit, which Ledge does not send', () => {
    expect(by('usage')?.blocked).toBe('panel');
    expect(by('model')).toMatchObject({ bare: 'panel' }); expect(by('model')?.blocked).toBeUndefined();
    expect(by('exit')).toMatchObject({ blocked: 'close', aliases: ['quit'] });
    expect(by('compact')?.bare).toBeUndefined();
  });
  it('fits the protocol: one line, at most 300 characters, and anything else is dropped', () => {
    const long = parseClaudeCommands([{ name: 'x', description: `a\nb ${'c'.repeat(400)}`, builtin: true }])[0]!;
    expect(long.description).toHaveLength(300); expect(long.description).toMatch(/^a b c+…$/);
    expect(parseClaudeCommands('nope')).toEqual([{ name: 'exit', aliases: ['quit'], source: 'builtin', description: 'Exit Claude Code', blocked: 'close' }]);
    expect(SessionCommandsListingSchema.safeParse({ type: 'session.commands.listing', requestId: 'r', id: 's', commands: list }).success).toBe(true);
  });
});

describe('claudeSlashRefusal', () => {
  it('refuses a panel, a bare command that opens one, and /exit; lets the rest through', () => {
    expect(claudeSlashRefusal('/usage')?.why).toBe('panel');
    expect(claudeSlashRefusal('/cost now')?.why).toBe('panel');
    expect(claudeSlashRefusal('/model')?.why).toBe('bare');
    expect(claudeSlashRefusal(' /model  ')?.why).toBe('bare');
    expect(claudeSlashRefusal('/model opus')).toBeNull();
    expect(claudeSlashRefusal('/exit')?.why).toBe('close');
    expect(claudeSlashRefusal('/compact')).toBeNull();
    expect(claudeSlashRefusal('please run /model')).toBeNull();
    expect(claudeSlashRefusal('/MCP')?.why).toBe('bare');
  });
});

/** A child process that answers `initialize` as Claude Code does, after other lines; `fail` exits it instead. */
function fakeSpawn(o: { answer?: unknown; fail?: string; error?: NodeJS.ErrnoException; silent?: boolean }) {
  const calls: Array<{ file: string; args: string[]; cwd: unknown; input: string }> = [];
  const spawn = ((file: string, args: string[], opts: { cwd: unknown }) => {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; exitCode: number | null; kill: (s?: string) => boolean; killed?: string };
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null;
    child.kill = s => { child.killed = s; child.exitCode = 143; setImmediate(() => child.emit('close', 143)); return true; };
    const call = { file, args, cwd: opts.cwd, input: '' }; calls.push(call);
    child.stdin.on('data', (d: Buffer) => {
      call.input += d.toString();
      if (o.silent || o.error) return;
      if (o.fail) { child.stderr.write(`${o.fail}\n`); child.exitCode = 1; setImmediate(() => child.emit('close', 1)); return; }
      const id = (JSON.parse(call.input.trim()) as { request_id: string }).request_id;
      child.stdout.write('{"type":"system","subtype":"commands_changed"}\nnot json\n');
      child.stdout.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: id, response: { commands: o.answer } } })}\n`);
    });
    if (o.error) setImmediate(() => child.emit('error', o.error));
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  return { spawn, calls };
}

describe('probeClaude', () => {
  it('asks initialize with hooks off and nothing saved, and returns its commands', async () => {
    const f = fakeSpawn({ answer: RAW });
    expect(await probeClaude({ bin: ['node', 'claude.js'], cwd: '/p', env: {} }, f.spawn)).toEqual(RAW);
    expect(f.calls[0]).toMatchObject({ file: 'node', args: ['claude.js', ...CLAUDE_PROBE_ARGS], cwd: '/p' });
    expect(CLAUDE_PROBE_ARGS).toEqual(expect.arrayContaining(['--no-session-persistence', '--settings', '{"disableAllHooks":true}']));
    expect(JSON.parse(f.calls[0]!.input)).toEqual({ type: 'control_request', request_id: 'ledge-commands', request: { subtype: 'initialize' } });
  });
  it('rejects with the reason: not installed, its last stderr line, or the timeout', async () => {
    await expect(probeClaude({ cwd: '/p', env: {} }, fakeSpawn({ error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) }).spawn)).rejects.toThrow('not installed');
    await expect(probeClaude({ cwd: '/p', env: {} }, fakeSpawn({ fail: 'Error: not logged in' }).spawn)).rejects.toThrow('Error: not logged in');
    await expect(probeClaude({ cwd: '/p', env: {}, timeoutMs: 20 }, fakeSpawn({ silent: true }).spawn)).rejects.toThrow('timed out');
  });
});

describe('createCommands', () => {
  it('keeps a listing per folder for the TTL, unless a commands folder changes; one probe at a time; a failure is not kept', async () => {
    let t = 0, fail = false; const probes: string[] = []; const marks = new Map<string, number>();
    const commands = createCommands({
      env: async () => ({ HOME: '/h' }), now: () => t, ttlMs: 100,
      mtime: async p => marks.get(p) ?? null,
      claude: async cwd => { probes.push(cwd); if (fail) throw new Error('boom'); return RAW; }
    });
    const [a, b] = await Promise.all([commands.list('claude', '/p'), commands.list('claude', '/p')]);
    expect(a).toBe(b); expect(a.commands.some(c => c.name === 'git:push-it')).toBe(true);
    await commands.list('claude', '/p'); expect(probes).toEqual(['/p']);
    await commands.list('claude', '/q'); expect(probes).toEqual(['/p', '/q']);
    marks.set('/p/.claude/commands', 5); await commands.list('claude', '/p'); expect(probes).toHaveLength(3);
    marks.set('/h/.claude/skills', 7); await commands.list('claude', '/p'); expect(probes).toHaveLength(4);
    t = 200; fail = true; expect(await commands.list('claude', '/p')).toEqual({ commands: [], error: 'boom' });
    fail = false; expect((await commands.list('claude', '/p')).commands.length).toBeGreaterThan(0); expect(probes).toHaveLength(6);
  });
  it('lists nothing yet for the other agents', async () => {
    expect(await createCommands({ claude: async () => RAW }).list('codex', '/p')).toEqual({ commands: [], error: 'unsupported' });
  });
});
