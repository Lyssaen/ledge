import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { claudeArgs, parseLine, runClaude, PERSONA } from '../src/chat/claude.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const opts = (extra = {}) => ({ question: 'Où en sont les autres ?', cwd: process.cwd(), addDirs: ['/w/ledge'], sessionId: '11111111-1111-4111-8111-111111111111', resume: false, env: { ...process.env }, bin: [process.execPath, FAKE], ...extra });

describe('claudeArgs', () => {
  it('runs headless, restricted, read-only, streaming, with the day session', () => {
    const a = claudeArgs(opts());
    expect(a.slice(0, 2)).toEqual(['-p', '--restricted']);
    expect(a).toContain('--tools'); expect(a[a.indexOf('--tools') + 1]).toBe('Read,Grep,Glob');
    for (const f of ['--permission-mode', '--output-format', '--verbose', '--include-partial-messages', '--max-turns', '--append-system-prompt', '--add-dir', '--session-id']) expect(a).toContain(f);
    expect(a[a.indexOf('--append-system-prompt') + 1]).toBe(PERSONA);
    expect(a).not.toContain('--resume'); expect(a).not.toContain('Bash');
    expect(claudeArgs(opts({ resume: true }))).toContain('--resume');
  });
});

describe('parseLine', () => {
  it('maps init, tool use, text deltas and the result; ignores the rest', () => {
    expect(parseLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'S' }))).toEqual([{ type: 'init', sessionId: 'S' }]);
    expect(parseLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hm' }, { type: 'tool_use', name: 'Grep', input: { path: '/w' } }, { type: 'tool_use', name: 'Read', input: { file_path: '/f' } }] } })))
      .toEqual([{ type: 'tool', tool: 'Grep', path: '/w' }, { type: 'tool', tool: 'Read', path: '/f' }]);
    expect(parseLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } }))).toEqual([{ type: 'delta', text: 'a' }]);
    expect(parseLine(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: '' }))).toEqual([{ type: 'result', text: '', isError: true }]);
    expect(parseLine('not json')).toEqual([]); expect(parseLine(JSON.stringify({ type: 'user' }))).toEqual([]);
  });
});

describe('runClaude', () => {
  it('feeds the question on stdin and streams events until the result', async () => {
    const events: unknown[] = [];
    const h = runClaude(opts(), e => events.push(e));
    const r = await h.done;
    expect(r.code).toBe(0);
    expect(events[0]).toEqual({ type: 'init', sessionId: '11111111-1111-4111-8111-111111111111' });
    expect(events.filter((e: any) => e.type === 'tool')).toHaveLength(2);
    expect(events.filter((e: any) => e.type === 'delta').map((e: any) => e.text).join('')).toBe('Deux compagnons travaillent.');
    expect(events.at(-1)).toMatchObject({ type: 'result', isError: false, text: expect.stringContaining('Où en sont les autres ?') });
  });
  it('reports a failure with its stderr, and a kill', async () => {
    const r = await runClaude(opts({ env: { ...process.env, FAKE_CLAUDE_MODE: 'fail' } }), () => {}).done;
    expect(r.code).toBe(1); expect(r.stderr).toContain('No conversation found');
    const h = runClaude(opts({ env: { ...process.env, FAKE_CLAUDE_MODE: 'slow' } }), () => {}); setTimeout(() => h.kill(), 200);
    expect((await h.done).code).not.toBe(0);
  });
});
