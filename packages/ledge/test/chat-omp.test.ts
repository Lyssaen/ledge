import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ompChatArgs, parseOmpLine, runOmp } from '../src/chat/omp.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const opts = (extra = {}) => ({ question: 'Où en sont les autres ?', cwd: process.cwd(), addDirs: ['/w/ledge'], sessionId: '1', resume: false, env: { ...process.env }, bin: [process.execPath, FAKE], ...extra });

describe('ompChatArgs', () => {
  it('prints JSON, reads only (whitelist, nothing loaded from outside), keeps no conversation without a directory', () => {
    const a = ompChatArgs(opts());
    expect(a.slice(0, 3)).toEqual(['-p', '--mode', 'json']);
    expect(a[a.indexOf('--tools') + 1]).toBe('read,grep,glob');
    for (const f of ['--no-extensions', '--no-skills', '--no-rules', '--no-session']) expect(a).toContain(f);
    expect(a[a.indexOf('--add-dir') + 1]).toBe('/w/ledge');
    expect(a.join(' ')).not.toMatch(/bash|write|edit|yolo|auto-approve|--no-ui/);
    expect(a).not.toContain('--continue');
  });
  it('the day\'s conversation lives in its own directory and is continued, never "the latest of the folder"', () => {
    const fresh = ompChatArgs(opts({ sessionDir: '/h/chat/omp/S' }));
    expect(fresh[fresh.indexOf('--session-dir') + 1]).toBe('/h/chat/omp/S'); expect(fresh).not.toContain('--continue'); expect(fresh).not.toContain('--no-session');
    expect(ompChatArgs(opts({ sessionDir: '/h/chat/omp/S', resume: true }))).toContain('--continue');
  });
});

describe('parseOmpLine', () => {
  it('the session, a read, the text as it comes, each assistant message as the answer so far, an error as one', () => {
    expect(parseOmpLine(JSON.stringify({ type: 'session', id: 'S' }))).toEqual([{ type: 'init', sessionId: 'S' }]);
    expect(parseOmpLine(JSON.stringify({ type: 'tool_execution_start', toolName: 'read', args: { path: 'sessions.md' } }))).toEqual([{ type: 'tool', tool: 'read', path: 'sessions.md' }]);
    expect(parseOmpLine(JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Deux ' } }))).toEqual([{ type: 'delta', text: 'Deux ' }]);
    expect(parseOmpLine(JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', delta: '{"p' } }))).toEqual([]);
    const msg = (content: unknown[], extra = {}) => JSON.stringify({ type: 'message_end', message: { role: 'assistant', content, ...extra } });
    expect(parseOmpLine(msg([{ type: 'text', text: 'Fini' }]))).toEqual([{ type: 'result', text: 'Fini', isError: false }]);
    expect(parseOmpLine(msg([{ type: 'toolCall', name: 'read' }]))).toEqual([]);
    expect(parseOmpLine(msg([], { stopReason: 'error', errorMessage: 'quota' }))).toEqual([{ type: 'result', text: 'quota', isError: true }]);
    expect(parseOmpLine(JSON.stringify({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'q' }] } }))).toEqual([]);
    expect(parseOmpLine('not json')).toEqual([]);
  });
});

describe('runOmp', () => {
  it('feeds the question on stdin (never argv) and streams what the fake prints', async () => {
    const events: unknown[] = [];
    const r = await runOmp(opts({ env: { ...process.env, FAKE_AGENT: 'omp' } }), e => events.push(e)).done;
    expect(r.code).toBe(0);
    expect(events).toContainEqual({ type: 'result', text: 'Deux sessions : Nova travaille.', isError: false });
  });
});
