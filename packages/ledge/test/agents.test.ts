import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentStatus, CODEX_RELEASE, createAgentInstaller, installCommand, type AgentRun } from '../src/daemon/agents.js';
import { windowsAgentDirs, windowsRegistryEnv } from '../src/shell-path.js';

// Agents on demand on native Windows (spec 2026-11-03 §4.2.6): each from its publisher's own per-user installer.
describe('agents on native Windows', () => {
  it('installCommand gives the official per-user installers', () => {
    expect(CODEX_RELEASE).toBe('0.166.0');
    expect(installCommand('claude')).toEqual({ file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable'] });
    // Codex's installer is fetched by PowerShell itself (irm honours the system proxy, as Claude's does), then run and removed.
    const codex = installCommand('codex');
    expect(codex.file).toBe('powershell.exe');
    expect(codex.args.slice(0, 4)).toEqual(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command']);
    expect(codex.args[4]).toContain("irm https://chatgpt.com/codex/install.ps1 -OutFile $p");
    expect(codex.args[4]).toContain('& $p -Release 0.166.0');
    expect(codex.args[4]).toMatch(/finally \{ Remove-Item .*\$p.*\}; exit \$code$/);
    expect(codex).not.toHaveProperty('download');
  });

  it('agentStatus finds a binary and reads its version', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-agents-')); writeFileSync(join(dir, 'codex.exe'), '');
    const run: AgentRun = async (file, args) => ({ code: 0, output: `${file} ${args.join(' ')}`.includes('--version') ? 'codex-cli 0.166.0\n' : '' });
    expect(await agentStatus('codex', { PATH: `C:\\none;${dir}` }, run)).toEqual({ tool: 'codex', found: true, path: join(dir, 'codex.exe'), version: 'codex-cli 0.166.0' });
  });

  it('agentStatus says not found', async () => {
    const run: AgentRun = async () => { throw new Error('never run'); };
    expect(await agentStatus('claude', { PATH: mkdtempSync(join(tmpdir(), 'ledge-agents-')) }, run)).toEqual({ tool: 'claude', found: false });
  });

  it('a failed install answers its exit code and output tail', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\r\n');
    const i = createAgentInstaller({ platform: 'win32', run: async () => ({ code: 1, output: lines }), env: async () => ({}) });
    const r = await i.install('claude');
    expect(r).toMatchObject({ tool: 'claude', ok: false, code: 1, error: 'failed' });
    expect(r.output!.split('\n')).toEqual(Array.from({ length: 20 }, (_, k) => `line ${k + 11}`));
  });

  it('one install at a time', async () => {
    let release!: () => void;
    const run: AgentRun = () => new Promise(r => { release = () => r({ code: 0, output: '' }); });
    const i = createAgentInstaller({ platform: 'win32', run, env: async () => ({}) });
    const first = i.install('codex');
    await new Promise(r => setTimeout(r, 10));
    expect(await i.install('claude')).toEqual({ tool: 'claude', ok: false, error: 'busy' });
    release();
    expect(await first).toEqual({ tool: 'codex', ok: true });
  });

  it('install is refused off Windows', async () => {
    const i = createAgentInstaller({ platform: 'linux', run: async () => ({ code: 0, output: '' }), env: async () => ({}) });
    expect(await i.install('claude')).toEqual({ tool: 'claude', ok: false, error: 'not_offered' });
  });

  it('the per-user install folders are on the agents\' PATH on Windows', async () => {
    expect(windowsAgentDirs({ USERPROFILE: 'C:\\Users\\po', LOCALAPPDATA: 'C:\\Users\\po\\AppData\\Local' })).toEqual(['C:\\Users\\po\\.local\\bin', 'C:\\Users\\po\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin']);
    const reg = async (key: string) => key.includes('Volatile') ? '    USERPROFILE    REG_SZ    C:\\Users\\po\r\n    LOCALAPPDATA    REG_SZ    C:\\Users\\po\\AppData\\Local\r\n'
      : key.startsWith('HKCU') ? '    Path    REG_SZ    C:\\Users\\po\\.local\\bin;C:\\u\r\n' : '    Path    REG_SZ    C:\\Windows\r\n';
    const env = await windowsRegistryEnv(reg, { PATH: 'C:\\daemon' });
    expect(env.Path).toBe('C:\\Windows;C:\\Users\\po\\.local\\bin;C:\\u;C:\\daemon;C:\\Users\\po\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin');
  });
});

describe('the daemon answers agents.* on native Windows', () => {
  it('agents.status answers a listing and agents.install its result; the snapshot says agents only on win32', async () => {
    const { startServer } = await import('../src/daemon/server.js');
    const { Store } = await import('../src/daemon/store.js');
    const { realTmux } = await import('../src/tmux.js');
    const { connect } = await import('../src/client.js');
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-agents-srv-'));
    const daemon = { version: '0.41.0', install: 'npm' as const, systemd: false };
    const agents = { status: async () => [{ tool: 'claude' as const, found: true, version: '2.1' }, { tool: 'codex' as const, found: false }], install: async (tool: 'claude' | 'codex') => ({ tool, ok: true }), installing: () => null };
    for (const platform of ['win32', 'linux'] as const) {
      const srv = await startServer({ store: new Store(), tmux: realTmux(`ledge-agents-${platform}-${process.pid}`, { scope: async () => false }), port: 0, platform, daemon, agents });
      try {
        const c = await connect({ port: srv.port });
        const snap = await c.next('snapshot') as { daemon?: { agents?: boolean } };
        expect(snap.daemon?.agents === true).toBe(platform === 'win32');
        if (platform === 'win32') {
          c.send({ type: 'agents.status', requestId: 's1' });
          expect(await c.next('agents.listing')).toEqual({ type: 'agents.listing', requestId: 's1', agents: [{ tool: 'claude', found: true, version: '2.1' }, { tool: 'codex', found: false }], installing: null });
          c.send({ type: 'agents.install', requestId: 'i1', tool: 'codex' });
          expect(await c.next('agents.installed')).toEqual({ type: 'agents.installed', requestId: 'i1', tool: 'codex', ok: true });
        }
        await c.close();
      } finally { await srv.close(); }
    }
  });
});
