import { beforeEach, describe, expect, it } from 'vitest';
import {
  availability, checkForm, clearLaunch, editDraft, emptyDraft, isPathAccepted, LAUNCH_KEY, loadLaunch, loadTool, recentsOf, resolveForm, saveLaunch, TOOL_KEY
} from '../src/launch/form';
import { machine, recent } from './launch-helpers';

const local = machine('local', { recents: [recent('/w/website', '2026-10-14T10:00:00.000Z'), recent('/w/ledge', '2026-10-15T09:00:00.000Z')] });
const devbox = machine('devbox', { recents: [recent('/home/dev/api', '2026-10-15T08:00:00.000Z')] });
beforeEach(() => localStorage.clear());

describe('desktop.tool', () => {
  it('defaults to Claude Code and keeps a known harness', () => {
    expect(loadTool()).toBe('claude');
    localStorage.setItem(TOOL_KEY, JSON.stringify('codex'));
    expect(loadTool()).toBe('codex');
  });
  it('falls back on anything else', () => {
    for (const raw of ['"vim"', '[1,2]', '{', '3']) { localStorage.setItem(TOOL_KEY, raw); expect(loadTool()).toBe('claude'); }
  });
});

describe('desktop.launch', () => {
  it('starts empty with the default harness', () => {
    localStorage.setItem(TOOL_KEY, JSON.stringify('cursor'));
    expect(loadLaunch()).toEqual({ machine: null, cwd: null, tool: 'cursor', prompt: '' });
    expect(emptyDraft().tool).toBe('cursor');
  });
  it('round-trips a draft and clears it', () => {
    saveLaunch({ machine: 'devbox', cwd: '~/w/api', tool: 'codex', prompt: 'Run the tests\nthen report' });
    expect(loadLaunch()).toEqual({ machine: 'devbox', cwd: '~/w/api', tool: 'codex', prompt: 'Run the tests\nthen report' });
    clearLaunch();
    expect(localStorage.getItem(LAUNCH_KEY)).toBeNull();
  });
  it('follows the default harness from Settings until a harness is chosen in the form (final review M1)', () => {
    saveLaunch({ machine: 'devbox', cwd: '~/w/api', tool: 'claude', prompt: 'Go' });   // the default, never chosen
    localStorage.setItem(TOOL_KEY, JSON.stringify('codex'));
    expect(loadLaunch()).toEqual({ machine: 'devbox', cwd: '~/w/api', tool: 'codex', prompt: 'Go' });
    saveLaunch({ machine: 'devbox', cwd: '~/w/api', tool: 'cursor', prompt: 'Go' });   // chosen: kept over the default
    localStorage.setItem(TOOL_KEY, JSON.stringify('claude'));
    expect(loadLaunch().tool).toBe('cursor');
  });
  it('reads a corrupted value field by field and never touches other keys', () => {
    localStorage.setItem('desktop.view', '{"view":"team"}');
    for (const raw of ['{', '[1,2]', '"x"', 'null']) { localStorage.setItem(LAUNCH_KEY, raw); expect(loadLaunch()).toEqual(emptyDraft()); }
    localStorage.setItem(LAUNCH_KEY, JSON.stringify({ machine: 3, cwd: '/w/x', tool: 'vim', prompt: 'a'.repeat(10_001) }));
    expect(loadLaunch()).toEqual({ machine: null, cwd: null, tool: 'claude', prompt: '' });
    localStorage.setItem(LAUNCH_KEY, JSON.stringify({ machine: 'local', cwd: 'x'.repeat(501), tool: 'cursor', prompt: 'Hi' }));
    expect(loadLaunch()).toEqual({ machine: 'local', cwd: null, tool: 'cursor', prompt: 'Hi' });
    expect(localStorage.getItem('desktop.view')).toBe('{"view":"team"}');
  });
});

describe('path rule (spec §9.2)', () => {
  it('accepts an absolute path or one starting with ~', () => {
    for (const p of ['/', '/w/ledge', '~', '~/w', '~dev/w', '  /w/ledge  ']) expect(isPathAccepted(p)).toBe(true);
  });
  it('refuses the rest, and anything over 500 characters', () => {
    for (const p of ['', '   ', 'w/ledge', './ledge', '../x', 'C:\\w']) expect(isPathAccepted(p)).toBe(false);
    expect(isPathAccepted('/' + 'a'.repeat(500))).toBe(false);
  });
});

describe('the form shown', () => {
  it('lists a machine\'s recents newest first, one per folder', () => {
    const twice = machine('local', { recents: [recent('/w/a', '2026-10-01T00:00:00.000Z'), recent('/w/b', '2026-10-03T00:00:00.000Z'), recent('/w/a', '2026-10-02T00:00:00.000Z')] });
    expect(recentsOf(twice).map(r => r.cwd)).toEqual(['/w/b', '/w/a']);
    expect(recentsOf(undefined)).toEqual([]);
  });
  it('opens on the first ready machine and its latest project', () => {
    expect(resolveForm(emptyDraft(), [local, devbox])).toEqual({ machine: 'local', cwd: '/w/ledge', tool: 'claude', prompt: '' });
    expect(resolveForm(emptyDraft(), [machine('local', { ready: false, status: 'unreachable' }), devbox]).machine).toBe('devbox');
  });
  it('keeps the remembered machine and folder while that machine is ready', () => {
    const d = { machine: 'devbox', cwd: '~/w/api', tool: 'codex' as const, prompt: 'Go' };
    expect(resolveForm(d, [local, devbox])).toEqual({ machine: 'devbox', cwd: '~/w/api', tool: 'codex', prompt: 'Go' });
    expect(resolveForm({ ...d, cwd: '' }, [local, devbox]).cwd).toBe('');
    expect(resolveForm({ ...d, cwd: null }, [local, devbox]).cwd).toBe('/home/dev/api');
  });
  it('never carries a folder typed for a fallen machine to another one', () => {
    const d = { machine: 'devbox', cwd: '~/w/api', tool: 'codex' as const, prompt: 'Go' };
    const down = machine('devbox', { ready: false, status: 'unreachable', recents: devbox.recents });
    expect(resolveForm(d, [local, down])).toEqual({ machine: 'local', cwd: '/w/ledge', tool: 'codex', prompt: 'Go' });
    expect(resolveForm(d, [local])).toEqual({ machine: 'local', cwd: '/w/ledge', tool: 'codex', prompt: 'Go' });
    expect(resolveForm(d, [machine('local', { ready: false, status: 'connecting' })])).toEqual({ machine: null, cwd: '', tool: 'codex', prompt: 'Go' });
  });
  it('an edit freezes what is shown, then applies the change', () => {
    const shown = resolveForm(emptyDraft(), [local, devbox]);
    expect(editDraft(shown, { prompt: 'Hi' })).toEqual({ machine: 'local', cwd: '/w/ledge', tool: 'claude', prompt: 'Hi' });
    expect(editDraft(shown, { machine: 'devbox', cwd: null })).toEqual({ machine: 'devbox', cwd: null, tool: 'claude', prompt: '' });
  });
  it('tells a ready machine from one that is connecting or down', () => {
    expect(availability(local)).toBe('ready');
    expect(availability(machine('devbox', { ready: false, status: 'open' }))).toBe('connecting');
    expect(availability(machine('devbox', { ready: false, status: 'connecting' }))).toBe('connecting');
    expect(availability(machine('devbox', { ready: false, status: 'unreachable' }))).toBe('unreachable');
  });
});

describe('checkForm', () => {
  const ok = { machine: 'local', cwd: '  ~/w/ledge ', tool: 'cursor' as const, prompt: '\n Fix the build \n' };
  it('sends the trimmed folder and instruction to the chosen machine', () => {
    expect(checkForm(ok, [local, devbox])).toEqual({ ok: true, request: { machine: 'local', tool: 'cursor', cwd: '~/w/ledge', prompt: 'Fix the build' } });
  });
  it('names the first problem', () => {
    expect(checkForm({ ...ok, machine: null }, [local])).toEqual({ ok: false, problem: 'machine' });
    expect(checkForm({ ...ok, machine: 'devbox' }, [local, machine('devbox', { ready: false, status: 'unreachable' })])).toEqual({ ok: false, problem: 'machine' });
    expect(checkForm({ ...ok, machine: 'gone' }, [local])).toEqual({ ok: false, problem: 'machine' });
    expect(checkForm({ ...ok, cwd: 'w/ledge' }, [local])).toEqual({ ok: false, problem: 'cwd' });
    expect(checkForm({ ...ok, prompt: '  \n ' }, [local])).toEqual({ ok: false, problem: 'prompt' });
    expect(checkForm({ ...ok, prompt: 'a'.repeat(10_001) }, [local])).toEqual({ ok: false, problem: 'prompt' });
  });
});
