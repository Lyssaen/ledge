import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeClaudeHooks, mergeCodexHooks, runSetup, CLAUDE_EVENTS, CODEX_EVENTS, systemdUnit, installService, SERVICE } from '../src/cli/setup.js';

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

describe('mergeCodexHooks', () => {
  // ~/.codex/hooks.json as another tool left it: its entries keep their place, so Codex keeps trusting them.
  const foreign = () => ({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '/other/hook --agent codex Stop', timeout: 10 }] }] } });
  it('appends `ledge hook codex <Event>` to every Codex event after the existing entries', () => {
    const { settings, changed } = mergeCodexHooks(foreign());
    expect(changed).toBe(true);
    const o = settings as { hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout: number }> }>> };
    expect(o.hooks.Stop![0]!.hooks[0]!.command).toBe('/other/hook --agent codex Stop');
    expect(o.hooks.Stop![1]!.hooks[0]).toEqual({ type: 'command', command: 'ledge hook codex Stop', timeout: 5 });
    for (const ev of CODEX_EVENTS) expect(o.hooks[ev]!.some(e => e.hooks.some(h => h.command === `ledge hook codex ${ev}`))).toBe(true);
    expect(mergeCodexHooks(settings).changed).toBe(false);
  });
  it('wires the events Codex 0.162 fires, Interrupt included', () => {
    expect([...CODEX_EVENTS]).toEqual(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop',
      'SubagentStart', 'SubagentStop', 'Interrupt', 'SessionEnd']);
  });
});

describe('runSetup', () => {
  // CODEX_HOME too: a test without codexDir must never reach the real ~/.codex.
  const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ledge-setup-')); process.env.LEDGE_HOME = join(d, 'ledge'); process.env.CODEX_HOME = join(d, 'no-codex'); return d; };
  it('creates settings.json when missing, then is idempotent', async () => {
    const d = tmp(); const p = join(d, 'claude', 'settings.json');
    await runSetup({ settingsPath: p, service: false });
    const first = readFileSync(p, 'utf8');
    expect(JSON.parse(first).hooks.Stop).toHaveLength(1);
    expect((await runSetup({ settingsPath: p, service: false })).join('\n')).toContain('already present');
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
    await expect(runSetup({ settingsPath: p, service: false })).rejects.toThrow(`${msg}, not modified`);
    expect(readFileSync(p, 'utf8')).toBe(content);
  });
  it('upgrades a settings.json wired by the earlier version, then is idempotent', async () => {
    const d = tmp(); const p = join(d, 'settings.json');
    const hooks: Record<string, unknown[]> = {};
    for (const ev of CLAUDE_EVENTS.slice(0, 7)) hooks[ev] = [{ hooks: [{ type: 'command', command: `ledge hook ${ev}`, timeout: 5 }] }];
    writeFileSync(p, JSON.stringify({ theme: 'dark', hooks }, null, 2) + '\n');
    expect((await runSetup({ settingsPath: p, service: false })).join('\n')).toContain('hooks added');
    const after = JSON.parse(readFileSync(p, 'utf8'));
    expect(after.theme).toBe('dark');
    for (const ev of CLAUDE_EVENTS) expect(after.hooks[ev]).toHaveLength(1);
    const text = readFileSync(p, 'utf8');
    expect((await runSetup({ settingsPath: p, service: false })).join('\n')).toContain('already present');
    expect(readFileSync(p, 'utf8')).toBe(text);
  });
  it('wires Codex hooks when ~/.codex exists, then is idempotent', async () => {
    const d = tmp(); const codexDir = join(d, 'codex'); mkdirSync(codexDir);
    writeFileSync(join(codexDir, 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '/other Stop' }] }] } }));
    const out = (await runSetup({ settingsPath: join(d, 'settings.json'), codexDir, service: false })).join('\n');
    expect(out).toContain('Codex hooks added');
    expect(out).toContain('trust');
    const hooks = JSON.parse(readFileSync(join(codexDir, 'hooks.json'), 'utf8')).hooks;
    expect(hooks.Stop.map((e: { hooks: Array<{ command: string }> }) => e.hooks[0]!.command)).toEqual(['/other Stop', 'ledge hook codex Stop']);
    const text = readFileSync(join(codexDir, 'hooks.json'), 'utf8');
    expect((await runSetup({ settingsPath: join(d, 'settings.json'), codexDir, service: false })).join('\n')).toContain('Codex hooks already present');
    expect(readFileSync(join(codexDir, 'hooks.json'), 'utf8')).toBe(text);
  });
  it('skips Codex when it is not installed (no ~/.codex)', async () => {
    const d = tmp(); const codexDir = join(d, 'codex');
    expect((await runSetup({ settingsPath: join(d, 'settings.json'), codexDir, service: false })).join('\n')).toContain('Codex not found');
    expect(existsSync(codexDir)).toBe(false);
  });
  it('leaves no temp file behind after writing', async () => {
    const d = tmp(); const p = join(d, 'settings.json');
    await runSetup({ settingsPath: p, service: false });
    expect(readdirSync(d).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });
  it('refuses an existing settings.json that is not valid JSON and leaves it untouched', async () => {
    const d = tmp(); const p = join(d, 'settings.json');
    writeFileSync(p, '{ // comment\n "model": ');
    await expect(runSetup({ settingsPath: p, service: false })).rejects.toThrow('settings.json is not valid JSON, not modified');
    expect(readFileSync(p, 'utf8')).toBe('{ // comment\n "model": ');
    expect(existsSync(p)).toBe(true);
  });
});

describe('systemd service', () => {
  type Call = [string, string[]];
  const fakeRun = (answers: Record<string, { code: number; stdout?: string }> = {}) => {
    const calls: Call[] = [];
    const run = async (cmd: string, args: string[]) => {
      calls.push([cmd, args]);
      const key = `${cmd} ${args.join(' ')}`;
      const hit = Object.entries(answers).find(([k]) => key.startsWith(k));
      return { code: hit?.[1].code ?? 0, stdout: hit?.[1].stdout ?? '', stderr: '' };
    };
    return { run, calls, key: (c: Call) => `${c[0]} ${c[1].join(' ')}` };
  };
  const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ledge-svc-')); process.env.LEDGE_HOME = join(d, 'ledge'); return d; };

  it('renders a user unit that runs the built CLI with a stable node and restarts on failure', () => {
    const u = systemdUnit({ node: '/opt/node/bin/node', script: '/repo/dist/cli/index.js' });
    expect(u).toContain('ExecStart=/opt/node/bin/node /repo/dist/cli/index.js daemon');
    expect(u).toContain('Restart=on-failure');
    expect(u).toContain('WantedBy=default.target');
    expect(u).toMatch(/\n$/);
  });

  it('writes the unit, reloads, enables now and enables linger', async () => {
    const d = tmp(); const unitDir = join(d, 'systemd');
    const f = fakeRun({ 'systemctl --user is-active': { code: 3 }, 'loginctl show-user': { code: 0, stdout: 'Linger=no\n' } });
    const out = await installService({ unitDir, node: '/n', script: '/s.js', run: f.run });
    expect(readFileSync(join(unitDir, SERVICE), 'utf8')).toBe(systemdUnit({ node: '/n', script: '/s.js' }));
    expect(f.calls.map(f.key)).toEqual([
      'systemctl --user daemon-reload',
      `systemctl --user is-active ${SERVICE}`,
      `systemctl --user enable --now ${SERVICE}`,
      'loginctl show-user paradow -p Linger'.replace('paradow', process.env.USER ?? ''),
      'loginctl enable-linger'
    ]);
    expect(out.join('\n')).toContain(`${SERVICE} installed and started`);
    expect(out.join('\n')).toContain('linger enabled');
  });

  it('is idempotent: same unit, already active and lingering, touches nothing', async () => {
    const d = tmp(); const unitDir = join(d, 'systemd');
    const first = fakeRun({ 'systemctl --user is-active': { code: 3 }, 'loginctl show-user': { code: 0, stdout: 'Linger=no\n' } });
    await installService({ unitDir, node: '/n', script: '/s.js', run: first.run });
    const f = fakeRun({ 'systemctl --user is-active': { code: 0 }, 'loginctl show-user': { code: 0, stdout: 'Linger=yes\n' } });
    const out = await installService({ unitDir, node: '/n', script: '/s.js', run: f.run });
    expect(f.calls.map(f.key)).toEqual([
      'systemctl --user daemon-reload',
      `systemctl --user is-active ${SERVICE}`,
      `loginctl show-user ${process.env.USER ?? ''} -p Linger`
    ]);
    expect(out.join('\n')).toContain(`${SERVICE} already running`);
    expect(readdirSync(unitDir).filter(x => x.endsWith('.tmp'))).toEqual([]);
  });

  it('restarts the active service when the unit changed (new node or script path)', async () => {
    const d = tmp(); const unitDir = join(d, 'systemd');
    await installService({ unitDir, node: '/old', script: '/s.js', run: fakeRun({ 'systemctl --user is-active': { code: 3 }, 'loginctl show-user': { code: 0, stdout: 'Linger=yes\n' } }).run });
    const f = fakeRun({ 'systemctl --user is-active': { code: 0 }, 'loginctl show-user': { code: 0, stdout: 'Linger=yes\n' } });
    const out = await installService({ unitDir, node: '/new', script: '/s.js', run: f.run });
    expect(f.calls.map(f.key)).toContain(`systemctl --user restart ${SERVICE}`);
    expect(f.calls.map(f.key)).not.toContain(`systemctl --user enable --now ${SERVICE}`);
    expect(out.join('\n')).toContain(`${SERVICE} updated and restarted`);
  });

  it('stops a detached daemon before starting the service, so the port is free', async () => {
    const d = tmp(); const unitDir = join(d, 'systemd');
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    const pidFile = join(process.env.LEDGE_HOME!, 'daemon.pid');
    mkdirSync(process.env.LEDGE_HOME!, { recursive: true });
    writeFileSync(pidFile, String(child.pid));
    const f = fakeRun({ 'systemctl --user is-active': { code: 3 }, 'loginctl show-user': { code: 0, stdout: 'Linger=yes\n' } });
    const out = await installService({ unitDir, node: '/n', script: '/s.js', run: f.run });
    expect(out.join('\n')).toContain(`detached daemon (pid ${child.pid}) stopped`);
    await new Promise(r => setTimeout(r, 50));
    expect(() => process.kill(child.pid!, 0)).toThrow();
  });

  it('ignores a stale pid file', async () => {
    const d = tmp(); const unitDir = join(d, 'systemd');
    mkdirSync(process.env.LEDGE_HOME!, { recursive: true });
    writeFileSync(join(process.env.LEDGE_HOME!, 'daemon.pid'), '999999999');
    const f = fakeRun({ 'systemctl --user is-active': { code: 3 }, 'loginctl show-user': { code: 0, stdout: 'Linger=yes\n' } });
    const out = await installService({ unitDir, node: '/n', script: '/s.js', run: f.run });
    expect(out.join('\n')).not.toContain('detached daemon');
    expect(f.calls.map(f.key)).toContain(`systemctl --user enable --now ${SERVICE}`);
  });

  it('reports a linger failure as a hint instead of failing setup', async () => {
    const d = tmp(); const unitDir = join(d, 'systemd');
    const f = fakeRun({ 'systemctl --user is-active': { code: 3 }, 'loginctl show-user': { code: 0, stdout: 'Linger=no\n' }, 'loginctl enable-linger': { code: 1 } });
    const out = await installService({ unitDir, node: '/n', script: '/s.js', run: f.run });
    expect(out.join('\n')).toContain('linger not enabled');
    expect(out.join('\n')).toContain('sudo loginctl enable-linger');
  });

  it('fails clearly when systemd --user is not available', async () => {
    const d = tmp(); const unitDir = join(d, 'systemd');
    const f = fakeRun({ 'systemctl --user daemon-reload': { code: 1 } });
    await expect(installService({ unitDir, node: '/n', script: '/s.js', run: f.run })).rejects.toThrow('systemd user session unavailable');
  });
});
