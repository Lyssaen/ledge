import { execFile } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODEX_RELEASE, type AgentStatus, type InstallableTool } from '@ledge/protocol';

export { CODEX_RELEASE };
import { resolveCommand } from '../panes/resolve.js';

/**
 * Claude Code and Codex installed per user on native Windows (spec 2026-11-03 §4.2.6), each from its publisher's own
 * installer, as their official pages give it (checked 2026-11-04): Claude Code's verifies its binary against its checksum
 * manifest and keeps itself up to date (`stable` channel); Codex's is pinned to a release, as OpenAI's Windows deployment
 * guide recommends. Nothing is installed without the user's click.
 */

const CODEX_INSTALLER = 'https://chatgpt.com/codex/install.ps1';
const CLAUDE_INSTALL = '& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable';
const PS = ['-NoProfile', '-ExecutionPolicy', 'Bypass'];

/** The command that installs `tool`; for Codex, `download` is the installer the daemon saves to `tmpScript` first. */
export function installCommand(tool: InstallableTool, tmpScript: string): { file: string; args: string[]; download?: string } {
  if (tool === 'claude') return { file: 'powershell.exe', args: [...PS, '-Command', CLAUDE_INSTALL] };
  return { file: 'powershell.exe', args: [...PS, '-File', tmpScript, '-Release', CODEX_RELEASE], download: CODEX_INSTALLER };
}

/** Runs `file args` without a shell, its streams together; `code` null when it could not start or ran out of time. */
export type AgentRun = (file: string, args: string[], opts: { timeoutMs: number; env?: NodeJS.ProcessEnv }) => Promise<{ code: number | null; output: string }>;

export const runAgentCommand: AgentRun = (file, args, opts) => new Promise(resolve => {
  execFile(file, args, { timeout: opts.timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...(opts.env ? { env: opts.env } : {}) }, (err, stdout, stderr) => {
    const output = `${String(stdout)}${String(stderr)}`;
    if (!err) return resolve({ code: 0, output });
    const code = typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : null;
    resolve({ code, output: output || err.message });
  });
});

/** Whether `tool` is on the agents' PATH, where, and the first line of its `--version`. */
export async function agentStatus(tool: InstallableTool, env: NodeJS.ProcessEnv, run: AgentRun): Promise<AgentStatus> {
  let path: string;
  try { path = resolveCommand(tool, env, 'win32'); } catch { return { tool, found: false }; }
  const r = await run(path, ['--version'], { timeoutMs: 10_000, env });
  const version = r.code === 0 ? r.output.split(/\r?\n/).map(l => l.trim()).find(Boolean) : undefined;
  return { tool, found: true, path, ...(version ? { version: version.slice(0, 200) } : {}) };
}

export interface Installed { tool: InstallableTool; ok: boolean; code?: number | null; output?: string; error?: 'busy' | 'not_offered' | 'failed' }

/** Installs one agent at a time, on native Windows only, within `timeoutMs` (10 min). A failure answers the exit code and
 *  the last 20 lines of output. */
export function createAgentInstaller(deps: { platform?: NodeJS.Platform; run?: AgentRun; env: () => Promise<NodeJS.ProcessEnv>; download?: (url: string, to: string) => Promise<void>; timeoutMs?: number }) {
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? runAgentCommand;
  const download = deps.download ?? (async (url: string, to: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
    await writeFile(to, Buffer.from(await res.arrayBuffer()));
  });
  let running = false;
  return {
    busy: () => running,
    async install(tool: InstallableTool): Promise<Installed> {
      if (platform !== 'win32') return { tool, ok: false, error: 'not_offered' };
      if (running) return { tool, ok: false, error: 'busy' };
      running = true;
      const tmp = join(tmpdir(), `ledge-${tool}-install-${process.pid}-${Date.now()}.ps1`);
      try {
        const cmd = installCommand(tool, tmp);
        if (cmd.download) await download(cmd.download, tmp);
        const r = await run(cmd.file, cmd.args, { timeoutMs: deps.timeoutMs ?? 10 * 60_000, env: await deps.env() });
        if (r.code === 0) return { tool, ok: true };
        return { tool, ok: false, code: r.code, output: r.output.split(/\r?\n/).filter(l => l.trim()).slice(-20).join('\n').slice(-8000), error: 'failed' };
      } catch (e) {
        return { tool, ok: false, code: null, output: (e as Error).message.slice(0, 2000), error: 'failed' };
      } finally {
        running = false;
        await rm(tmp, { force: true }).catch(() => {});
      }
    }
  };
}
