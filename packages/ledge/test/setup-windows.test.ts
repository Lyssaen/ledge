import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureCodexWindowsSandbox, runSetup, windowsHookCommands } from '../src/cli/setup.js';

// `ledge setup` on Windows (spike, measured): Claude runs its hooks as written, Codex through
// `powershell.exe -NoProfile -Command`, and Codex is set to its non-admin sandbox (the user's call, 2026-11-03).
const fwd = (p: string) => p.replace(/\\/g, '/');

function fixture(codexToml?: string) {
  const root = mkdtempSync(join(tmpdir(), 'ledge-setup-win-'));
  process.env.LEDGE_HOME = join(root, '.ledge');
  const settingsPath = join(root, '.claude', 'settings.json');
  const codexDir = join(root, '.codex'); mkdirSync(codexDir, { recursive: true });
  if (codexToml !== undefined) writeFileSync(join(codexDir, 'config.toml'), codexToml);
  const cli = join(root, 'pkg', 'dist', 'cli', 'index.js'); mkdirSync(join(root, 'pkg', 'dist', 'cli'), { recursive: true }); writeFileSync(cli, '');
  const calls: string[] = [];
  const opts = { platform: 'win32' as const, settingsPath, codexDir, cursorDir: join(root, '.cursor'), cli, link: join(root, '.local', 'bin', 'ledge'), unitDir: join(root, 'systemd'), run: async (cmd: string, args: string[]) => { calls.push(`${cmd} ${args.join(' ')}`); return { code: 0, stdout: '', stderr: '' }; } };
  return { root, settingsPath, codexDir, cli, opts, calls };
}

describe('windowsHookCommands', () => {
  it('Claude: quoted paths; Codex: PowerShell call operator; forward slashes', () => {
    expect(windowsHookCommands('C:\\Program Files\\node\\node.exe', 'C:\\Users\\a b\\cli\\index.js')).toEqual({
      claude: '"C:/Program Files/node/node.exe" "C:/Users/a b/cli/index.js" hook',
      codex: "& 'C:/Program Files/node/node.exe' 'C:/Users/a b/cli/index.js' hook codex",
    });
  });
  it("doubles a ' for PowerShell, refuses a \" it cannot quote", () => {
    expect(windowsHookCommands('C:\\n\\node.exe', "C:\\Users\\o'brien\\index.js").codex).toBe("& 'C:/n/node.exe' 'C:/Users/o''brien/index.js' hook codex");
    expect(() => windowsHookCommands('C:\\n\\node.exe', 'C:\\a"b\\index.js')).toThrow(/quote/);
  });
});

describe('ensureCodexWindowsSandbox', () => {
  it('adds a [windows] section with the non-admin sandbox', () => {
    expect(ensureCodexWindowsSandbox('[tui]\nx = 1\n')).toEqual({ toml: '[tui]\nx = 1\n\n[windows]\nsandbox = "unelevated"\n', changed: true });
    expect(ensureCodexWindowsSandbox('')).toEqual({ toml: '[windows]\nsandbox = "unelevated"\n', changed: true });
  });
  it('adds the key to an existing [windows] section without one', () => {
    expect(ensureCodexWindowsSandbox('[windows]\nother = true\n\n[tui]\n').toml).toBe('[windows]\nsandbox = "unelevated"\nother = true\n\n[tui]\n');
  });
  it('keeps a sandbox already chosen', () => {
    const toml = '[windows]\nsandbox = "elevated"\n';
    expect(ensureCodexWindowsSandbox(toml)).toEqual({ toml, changed: false });
  });
});

describe('ledge setup on Windows', () => {
  it('writes the Windows hook commands and the Codex sandbox, no script and no service', async () => {
    const f = fixture('[tui]\n');
    const lines = await runSetup(f.opts);
    const node = fwd(process.execPath), cli = fwd(f.cli);
    const settings = JSON.parse(readFileSync(f.settingsPath, 'utf8'));
    expect(settings.hooks.Stop[0].hooks[0].command).toBe(`"${node}" "${cli}" hook Stop`);
    const codex = JSON.parse(readFileSync(join(f.codexDir, 'hooks.json'), 'utf8'));
    expect(codex.hooks.Stop[0].hooks[0].command).toBe(`& '${node}' '${cli}' hook codex Stop`);
    expect(readFileSync(join(f.codexDir, 'config.toml'), 'utf8')).toContain('[windows]\nsandbox = "unelevated"');
    expect(existsSync(f.opts.link)).toBe(false);
    expect(f.calls).toEqual([]);
    expect(lines.join('\n')).toMatch(/Ledge Desktop starts the daemon/);
    expect(lines.join('\n')).toMatch(/Cursor Agent.*not on Windows/);
  });
  it('is idempotent: a second run changes no byte', async () => {
    const f = fixture('');
    await runSetup(f.opts);
    const files = [f.settingsPath, join(f.codexDir, 'hooks.json'), join(f.codexDir, 'config.toml')];
    const before = files.map(p => readFileSync(p, 'utf8'));
    await runSetup(f.opts);
    expect(files.map(p => readFileSync(p, 'utf8'))).toEqual(before);
  });
});
