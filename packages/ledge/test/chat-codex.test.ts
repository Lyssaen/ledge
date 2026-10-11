import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { codexArgs, parseCodexLine, runCodex } from '../src/chat/codex.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const opts = (extra = {}) => ({ question: 'Où en sont les autres ?', cwd: process.cwd(), addDirs: ['/w/ledge'], sessionId: '11111111-1111-4111-8111-111111111111', resume: false, env: { ...process.env }, bin: [process.execPath, FAKE], ...extra });

describe('codexArgs', () => {
  it('runs exec headless, read-only, JSON, without making extra dirs writable', () => {
    const a = codexArgs(opts());
    expect(a[0]).toBe('exec');
    expect(a).toContain('--sandbox'); expect(a[a.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(a).toContain('--json');
    expect(a).toContain('--skip-git-repo-check');
    expect(a).toContain('--ignore-user-config');
    expect(a.at(-1)).toBe('-');
    expect(a).not.toContain('--add-dir');
    expect(a).not.toContain('resume');
    expect(codexArgs(opts({ resume: true }))[1]).toBe('resume');
    expect(codexArgs(opts({ resume: true }))[2]).toBe(opts().sessionId);
  });
});

describe('parseCodexLine', () => {
  it('maps thread start, a read, the agent message and a failed turn', () => {
    expect(parseCodexLine(JSON.stringify({ type: 'thread.started', thread_id: 'T' }))).toEqual([{ type: 'init', sessionId: 'T' }]);
    expect(parseCodexLine(JSON.stringify({ type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'cat /tmp/sessions.md' } })))
      .toEqual([{ type: 'tool', tool: 'command_execution', path: '/tmp/sessions.md' }]);
    expect(parseCodexLine(JSON.stringify({ type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: 'Deux compagnons.' } })))
      .toEqual([{ type: 'delta', text: 'Deux compagnons.' }, { type: 'result', text: 'Deux compagnons.', isError: false }]);
    expect(parseCodexLine(JSON.stringify({ type: 'turn.failed', error: { message: 'quota' } }))).toEqual([{ type: 'result', text: 'quota', isError: true }]);
    expect(parseCodexLine('not json')).toEqual([]); expect(parseCodexLine(JSON.stringify({ type: 'turn.started' }))).toEqual([]);
  });
});

describe('runCodex', () => {
  it('feeds the question on stdin and streams Codex events', async () => {
    const events: unknown[] = [];
    const r = await runCodex(opts({ env: { ...process.env, FAKE_AGENT: 'codex' } }), e => events.push(e)).done;
    expect(r.code).toBe(0);
    expect(events[0]).toMatchObject({ type: 'init' });
    expect(events.filter((e: any) => e.type === 'tool')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'result', isError: false, text: expect.stringContaining('Où en sont les autres ?') });
  });
});
