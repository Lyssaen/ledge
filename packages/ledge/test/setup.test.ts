import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeClaudeHooks, runSetup, CLAUDE_EVENTS } from '../src/cli/setup.js';

describe('mergeClaudeHooks', () => {
  it('appends a ledge entry to every event, keeping foreign hooks', () => {
    const settings = { model: 'opus', hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: '/other/tool PreToolUse', timeout: 10 }] }] } };
    const { settings: out, changed } = mergeClaudeHooks(settings);
    expect(changed).toBe(true);
    const o = out as { model: string; hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(o.model).toBe('opus');
    expect(o.hooks.PreToolUse![0]!.hooks[0]!.command).toBe('/other/tool PreToolUse');
    expect(o.hooks.PreToolUse![1]!.hooks[0]!.command).toBe('ledge hook PreToolUse');
    for (const ev of CLAUDE_EVENTS) expect(o.hooks[ev]!.some(e => e.hooks.some(h => h.command === `ledge hook ${ev}`))).toBe(true);
  });
  it('is idempotent', () => {
    const once = mergeClaudeHooks({}).settings;
    const twice = mergeClaudeHooks(once);
    expect(twice.changed).toBe(false);
    expect(twice.settings).toEqual(once);
  });
  it('wires the post-tool, stop-failure and subagent events', () => {
    expect([...CLAUDE_EVENTS]).toEqual(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd',
      'PostToolUse', 'PostToolUseFailure', 'StopFailure', 'SubagentStart', 'SubagentStop']);
  });
  it('on a file wired with the 7 earlier events, adds only the 5 new ones and keeps everything else', () => {
    const old = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'];
    const hooks: Record<string, unknown[]> = {};
    for (const ev of old) hooks[ev] = [{ hooks: [{ type: 'command', command: `ledge hook ${ev}`, timeout: 5 }] }];
    hooks.PostToolUse = [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/other/fmt' }] }];
    const before = { model: 'opus', hooks };
    const { settings: out, changed } = mergeClaudeHooks(JSON.parse(JSON.stringify(before)));
    expect(changed).toBe(true);
    const o = out as { model: string; hooks: Record<string, unknown[]> };
    expect(o.model).toBe('opus');
    for (const ev of old) expect(o.hooks[ev]).toEqual(before.hooks[ev]);
    expect(o.hooks.PostToolUse).toEqual([...before.hooks.PostToolUse!, { hooks: [{ type: 'command', command: 'ledge hook PostToolUse', timeout: 5 }] }]);
    for (const ev of ['PostToolUseFailure', 'StopFailure', 'SubagentStart', 'SubagentStop']) {
      expect(o.hooks[ev]).toEqual([{ hooks: [{ type: 'command', command: `ledge hook ${ev}`, timeout: 5 }] }]);
    }
    expect(mergeClaudeHooks(out).changed).toBe(false);
  });
  it('sets a 5 second timeout on its own entries only', () => {
    const o = mergeClaudeHooks({}).settings as { hooks: Record<string, Array<{ hooks: Array<{ timeout: number }> }>> };
    expect(o.hooks.Stop![0]!.hooks[0]!.timeout).toBe(5);
  });
});

describe('runSetup', () => {
  const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ledge-setup-')); process.env.LEDGE_HOME = join(d, 'ledge'); return d; };
  it('creates settings.json when missing, then is idempotent', async () => {
    const d = tmp(); const p = join(d, 'claude', 'settings.json');
    await runSetup({ settingsPath: p });
    const first = readFileSync(p, 'utf8');
    expect(JSON.parse(first).hooks.Stop).toHaveLength(1);
    expect((await runSetup({ settingsPath: p })).join('\n')).toContain('already present');
    expect(readFileSync(p, 'utf8')).toBe(first);
  });
  it.each([
    ['null root', 'null', 'root is not an object'],
    ['array root', '[]', 'root is not an object'],
    ['object event', '{"hooks":{"Stop":{"a":1}}}', 'hooks.Stop is not an array'],
    ['string event', '{"hooks":{"Stop":"abc"}}', 'hooks.Stop is not an array'],
    ['array hooks', '{"hooks":[]}', '"hooks" is not an object']
  ])('refuses malformed shape (%s) and leaves the file untouched', async (_n, content, msg) => {
    const d = tmp(); const p = join(d, 'settings.json');
    writeFileSync(p, content);
    await expect(runSetup({ settingsPath: p })).rejects.toThrow(`${msg}, not modified`);
    expect(readFileSync(p, 'utf8')).toBe(content);
  });
  it('upgrades a settings.json wired by the earlier version, then is idempotent', async () => {
    const d = tmp(); const p = join(d, 'settings.json');
    const hooks: Record<string, unknown[]> = {};
    for (const ev of CLAUDE_EVENTS.slice(0, 7)) hooks[ev] = [{ hooks: [{ type: 'command', command: `ledge hook ${ev}`, timeout: 5 }] }];
    writeFileSync(p, JSON.stringify({ theme: 'dark', hooks }, null, 2) + '\n');
    expect((await runSetup({ settingsPath: p })).join('\n')).toContain('hooks added');
    const after = JSON.parse(readFileSync(p, 'utf8'));
    expect(after.theme).toBe('dark');
    for (const ev of CLAUDE_EVENTS) expect(after.hooks[ev]).toHaveLength(1);
    const text = readFileSync(p, 'utf8');
    expect((await runSetup({ settingsPath: p })).join('\n')).toContain('already present');
    expect(readFileSync(p, 'utf8')).toBe(text);
  });
  it('leaves no temp file behind after writing', async () => {
    const d = tmp(); const p = join(d, 'settings.json');
    await runSetup({ settingsPath: p });
    expect(readdirSync(d).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });
  it('refuses an existing settings.json that is not valid JSON and leaves it untouched', async () => {
    const d = tmp(); const p = join(d, 'settings.json');
    writeFileSync(p, '{ // comment\n "model": ');
    await expect(runSetup({ settingsPath: p })).rejects.toThrow('settings.json is not valid JSON, not modified');
    expect(readFileSync(p, 'utf8')).toBe('{ // comment\n "model": ');
    expect(existsSync(p)).toBe(true);
  });
});
