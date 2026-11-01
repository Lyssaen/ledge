import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Codex can silently skip untrusted hooks. Only the standard, synchronous, unfiltered Ledge guard is sufficient. */
export function trustedCodexGuard(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== 1) return false;
  const entry = data[0] as { errors?: unknown; hooks?: unknown };
  if (!Array.isArray(entry.errors) || entry.errors.length !== 0 || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return false;
    const h = raw as Record<string, unknown>;
    return h.eventName === 'preToolUse' && h.handlerType === 'command' && h.command === 'ledge hook codex PreToolUse'
      && h.enabled === true && h.async === false && h.matcher == null && (h.trustStatus === 'trusted' || h.trustStatus === 'managed');
  });
}

/** Ask the installed Codex about its effective hook configuration; any unavailable or unrecognised response fails closed. */
export function checkCodexHookTrust(cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 5000): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn('codex', ['app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true; clearTimeout(timer); lines.close(); child.stdin.destroy(); child.kill('SIGKILL'); resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.on('error', () => finish(false));
    child.on('exit', () => finish(false));
    lines.on('line', line => {
      if (line.length > 1024 * 1024) return finish(false);
      let msg: { id?: number; result?: unknown; error?: unknown };
      try { msg = JSON.parse(line) as typeof msg; } catch { return finish(false); }
      if (msg.id === 1) {
        if (msg.error || !msg.result) return finish(false);
        child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
        child.stdin.write(`${JSON.stringify({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } })}\n`);
      } else if (msg.id === 2) finish(!msg.error && trustedCodexGuard(msg.result));
    });
    child.stdin.on('error', () => finish(false));
    child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'ledge', version: '0.29.0' }, capabilities: { experimentalApi: true } } })}\n`);
  });
}

/** Check the executable resolved by the hook, not merely its name: an older installed Ledge may lack the brain guard. */
export async function checkLedgeBrainHook(cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 2500): Promise<boolean> {
  const home = await mkdtemp(join(tmpdir(), 'ledge-codex-hook-'));
  const probeEnv: NodeJS.ProcessEnv = { ...env, LEDGE_HOME: home, LEDGE_BRAIN: '1', LEDGE_CODEX_HOOK_SESSION: 'brain' };
  delete probeEnv.LEDGE_CHAT;
  const run = (command: string): Promise<boolean> => new Promise(resolve => {
    const child = spawn('ledge', ['hook', 'codex', 'PreToolUse'], { cwd, env: probeEnv, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '', done = false;
    const finish = (ok: boolean) => { if (done) return; done = true; clearTimeout(timer); child.stdin.destroy(); child.kill('SIGKILL'); resolve(ok); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.on('error', () => finish(false));
    child.stdout.on('data', data => { output += String(data); if (output.length > 16384) finish(false); });
    child.on('close', code => {
      if (code !== 0) return finish(false);
      try {
        const o = JSON.parse(output) as { hookSpecificOutput?: { hookEventName?: string; permissionDecision?: string } };
        finish(o.hookSpecificOutput?.hookEventName === 'PreToolUse' && o.hookSpecificOutput.permissionDecision === 'deny');
      } catch { finish(false); }
    });
    child.stdin.on('error', () => finish(false));
    child.stdin.end(JSON.stringify({ session_id: 'guard-probe', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }));
  });
  try { return (await Promise.all(['rig ps', 'tmux ls', 'curl http://127.0.0.1:7433/api'].map(run))).every(Boolean); }
  finally { await rm(home, { recursive: true, force: true }).catch(() => undefined); }
}

/** Both Codex's trust state and the installed hook implementation must be known before the brain runs. */
export async function checkCodexGuard(cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 5000): Promise<boolean> {
  return await checkCodexHookTrust(cwd, env, timeoutMs) && await checkLedgeBrainHook(cwd, env, Math.min(timeoutMs, 2500));
}
