import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cursorArgs, parseCursorLine, runCursor } from '../src/chat/cursor.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const opts = (extra = {}) => ({ question: 'Où en sont les autres ?', cwd: process.cwd(), addDirs: ['/w/ledge'], sessionId: '11111111-1111-4111-8111-111111111111', resume: false, env: { ...process.env }, bin: [process.execPath, FAKE], ...extra });

describe('cursorArgs', () => {
  it('prints in ask mode, sandboxed, without force, and adds the repos as extra roots', () => {
    const a = cursorArgs(opts());
    expect(a).toContain('-p');
    expect(a).toContain('--mode'); expect(a[a.indexOf('--mode') + 1]).toBe('ask');
    expect(a).toContain('--output-format'); expect(a[a.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(a).toContain('--stream-partial-output');
    expect(a).toContain('--sandbox'); expect(a[a.indexOf('--sandbox') + 1]).toBe('enabled');
    expect(a).toContain('--trust');
    expect(a).toContain('--workspace'); expect(a[a.indexOf('--workspace') + 1]).toBe(process.cwd());
    expect(a).toContain('--add-dir'); expect(a[a.indexOf('--add-dir') + 1]).toBe('/w/ledge');
    expect(a).not.toContain('--force'); expect(a).not.toContain('--yolo');
    expect(a).not.toContain('--resume');
    expect(cursorArgs(opts({ resume: true }))).toContain('--resume');
    expect(cursorArgs(opts({ resume: true }))[cursorArgs(opts({ resume: true })).indexOf('--resume') + 1]).toBe(opts().sessionId);
  });
});

describe('parseCursorLine', () => {
  it('maps init, a read, text deltas and the result', () => {
    expect(parseCursorLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'S' }))).toEqual([{ type: 'init', sessionId: 'S' }]);
    expect(parseCursorLine(JSON.stringify({ type: 'tool_call', subtype: 'started', tool_call: { readToolCall: { args: { path: '/f' } } } })))
      .toEqual([{ type: 'tool', tool: 'Read', path: '/f' }]);
    expect(parseCursorLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Deux ' }] } }))).toEqual([{ type: 'delta', text: 'Deux ' }]);
    expect(parseCursorLine(JSON.stringify({ type: 'result', result: 'ok', is_error: false }))).toEqual([{ type: 'result', text: 'ok', isError: false }]);
    expect(parseCursorLine('not json')).toEqual([]);
  });
});

describe('runCursor', () => {
  it('feeds the question on stdin and streams Cursor events', async () => {
    const events: unknown[] = [];
    const r = await runCursor(opts({ env: { ...process.env, FAKE_AGENT: 'cursor' } }), e => events.push(e)).done;
    expect(r.code).toBe(0);
    expect(events[0]).toMatchObject({ type: 'init' });
    expect(events.filter((e: any) => e.type === 'delta').map((e: any) => e.text).join('')).toContain('Deux');
    expect(events.at(-1)).toMatchObject({ type: 'result', isError: false, text: expect.stringContaining('Où en sont les autres ?') });
  });
});

describe('runCursor images', () => {
  it('copies each image into cwd as image-N.<ext> and ends stdin with the brackets', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ledge-cur-')); const src = join(cwd, '..', `src-${Date.now()}.png`);
    writeFileSync(src, 'x'); writeFileSync(`${src}.jpg`, 'y');
    const log = join(cwd, '..', `log-${Date.now()}.jsonl`);
    const h = runCursor(opts({ cwd, images: [{ path: src, mime: 'image/png' }, { path: `${src}.jpg`, mime: 'image/jpeg' }], env: { ...process.env, FAKE_AGENT: 'cursor', FAKE_LOG: log } }), () => {});
    await h.done;
    expect(readFileSync(join(cwd, 'image-1.png'), 'utf8')).toBe('x');
    expect(readFileSync(join(cwd, 'image-2.jpg'), 'utf8')).toBe('y');
    expect((JSON.parse(readFileSync(log, 'utf8')) as { stdin: string }).stdin.endsWith(`Où en sont les autres ? [Image attached: ${cwd}/image-1.png] [Image attached: ${cwd}/image-2.jpg]`)).toBe(true);
  });
});
