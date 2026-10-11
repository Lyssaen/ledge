import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeClaudeHooks, mergeCodexHooks, mergeCursorHooks, SERVICE, type Runner } from '../src/cli/setup.js';
import { removeClaudeHooks, removeCursorHooks, removeService, runUninstall } from '../src/cli/uninstall.js';

type Call = [string, string[]];
const fakeRun = (answers: Record<string, { code: number; stdout?: string; stderr?: string }> = {}) => {
  const calls: Call[] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, args]);
    const k = `${cmd} ${args.join(' ')}`;
    const hit = Object.entries(answers).find(([p]) => k.startsWith(p));
    return { code: hit?.[1].code ?? 0, stdout: hit?.[1].stdout ?? '', stderr: hit?.[1].stderr ?? '' };
  };
  return { run, calls, keys: () => calls.map(c => `${c[0]} ${c[1].join(' ')}`) };
};
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ledge-uninstall-')); process.env.LEDGE_HOME = join(d, 'ledge'); return d; };

describe('removeClaudeHooks', () => {
  it('undoes setup on a file that had only Ledge, down to the hooks object', () => {
    const wired = mergeClaudeHooks({ model: 'opus' }).settings;
    const { settings, removed } = removeClaudeHooks(wired);
    expect(removed).toBe(12);
    expect(settings).toEqual({ model: 'opus' });
  });
  it('keeps foreign hooks, their order and their groups', () => {
    const foreign = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/other/fmt' }] }] } };
    const wired = mergeClaudeHooks(JSON.parse(JSON.stringify(foreign))).settings;
    const { settings } = removeClaudeHooks(wired);
    expect(settings).toEqual(foreign);
  });
  it('keeps the other commands of a group shared with Ledge', () => {
    const shared = { hooks: { Stop: [{ hooks: [{ type: 'command', command: '/other Stop' }, { type: 'command', command: 'ledge hook Stop' }] }] } };
    const { settings, removed } = removeClaudeHooks(shared);
    expect(removed).toBe(1);
    expect(settings).toEqual({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '/other Stop' }] }] } });
  });
  it('removes Codex entries too, not commands that merely mention ledge', () => {
    const wired = mergeCodexHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo ledge hook Stop' }] }] } }).settings;
    const { settings } = removeClaudeHooks(wired, 'hooks.json');
    expect(settings).toEqual({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo ledge hook Stop' }] }] } });
  });
  it('is a no-op on a file without Ledge', () => {
    expect(removeClaudeHooks({ theme: 'dark' })).toEqual({ settings: { theme: 'dark' }, removed: 0 });
  });
  it.each([['null root', null], ['array hooks', { hooks: [] }], ['object event', { hooks: { Stop: {} } }]])('refuses malformed shape (%s)', (_n, c) => {
    expect(() => removeClaudeHooks(c)).toThrow('not modified');
  });
});

describe('removeCursorHooks', () => {
  it('undoes setup and keeps foreign hooks and the version', () => {
    const foreign = { version: 1, hooks: { stop: [{ command: '/other stop' }] } };
    const wired = mergeCursorHooks(JSON.parse(JSON.stringify(foreign))).settings;
    expect(removeCursorHooks(wired).settings).toEqual(foreign);
  });
});

describe('removeService', () => {
  it('disables, removes the unit and reloads', async () => {
    const d = tmp(); const unitDir = join(d, 'systemd'); mkdirSync(unitDir);
    writeFileSync(join(unitDir, SERVICE), '[Unit]\n');
    const f = fakeRun();
    const out = await removeService({ unitDir, run: f.run, pidFile: join(d, 'none.pid') });
    expect(f.keys()).toEqual([`systemctl --user disable --now ${SERVICE}`, 'systemctl --user daemon-reload']);
    expect(existsSync(join(unitDir, SERVICE))).toBe(false);
    expect(out.join('\n')).toContain('stopped and removed');
  });
  it('touches nothing when the service was never installed', async () => {
    const d = tmp(); const f = fakeRun();
    const out = await removeService({ unitDir: join(d, 'systemd'), run: f.run, pidFile: join(d, 'none.pid') });
    expect(f.calls).toEqual([]);
    expect(out.join('\n')).toContain('not installed');
  });
});

describe('runUninstall', () => {
  const setupFiles = (d: string) => {
    const settingsPath = join(d, 'claude', 'settings.json'); mkdirSync(join(d, 'claude'));
    writeFileSync(settingsPath, JSON.stringify(mergeClaudeHooks({ theme: 'dark' }).settings));
    mkdirSync(join(d, 'codex')); writeFileSync(join(d, 'codex', 'hooks.json'), JSON.stringify(mergeCodexHooks({}).settings));
    return { settingsPath, codexDir: join(d, 'codex'), cursorDir: join(d, 'cursor') };
  };

  it('removes the hooks and the link, keeps ~/.ledge, reports running sessions without killing them', async () => {
    const d = tmp(); const files = setupFiles(d);
    mkdirSync(process.env.LEDGE_HOME!); writeFileSync(join(process.env.LEDGE_HOME!, 'sessions.json'), '[]');
    const script = join(d, 'index.js'); writeFileSync(script, '');
    const link = join(d, 'bin-ledge'); symlinkSync(script, link);
    const f = fakeRun({ 'tmux -L ledge list-sessions': { code: 0, stdout: 'otto\nbix\n' } });
    const r = await runUninstall({ ...files, service: false, run: f.run, script, link });
    expect(r.ok).toBe(true);
    expect(JSON.parse(readFileSync(files.settingsPath, 'utf8'))).toEqual({ theme: 'dark' });
    expect(JSON.parse(readFileSync(join(files.codexDir, 'hooks.json'), 'utf8'))).toEqual({});
    expect(existsSync(link)).toBe(false);
    expect(existsSync(process.env.LEDGE_HOME!)).toBe(true);
    expect(f.keys()).not.toContain('tmux -L ledge kill-server');
    const text = r.lines.join('\n');
    expect(text).toContain('Cursor Agent: ');
    expect(text).toContain('2 sessions still running');
  });

  it('with purge removes ~/.ledge; a ledge link to something else stays', async () => {
    const d = tmp(); const files = setupFiles(d);
    mkdirSync(process.env.LEDGE_HOME!);
    const other = join(d, 'other.js'); writeFileSync(other, '');
    const link = join(d, 'bin-ledge'); symlinkSync(other, link);
    const script = join(d, 'index.js'); writeFileSync(script, '');
    const r = await runUninstall({ ...files, service: false, purge: true, run: fakeRun({ tmux: { code: 1 } }).run, script, link });
    expect(r.ok).toBe(true);
    expect(existsSync(process.env.LEDGE_HOME!)).toBe(false);
    expect(existsSync(link)).toBe(true);
  });

  it('leaves a malformed file untouched, carries on and fails at the end', async () => {
    const d = tmp(); const files = setupFiles(d);
    writeFileSync(files.settingsPath, '{"hooks":[]}');
    const r = await runUninstall({ ...files, service: false, run: fakeRun({ tmux: { code: 1 } }).run, script: join(d, 'x.js'), link: join(d, 'nolink') });
    expect(r.ok).toBe(false);
    expect(readFileSync(files.settingsPath, 'utf8')).toBe('{"hooks":[]}');
    expect(JSON.parse(readFileSync(join(files.codexDir, 'hooks.json'), 'utf8'))).toEqual({});
    expect(r.lines.join('\n')).toContain('"hooks" is not an object, not modified');
  });
});
