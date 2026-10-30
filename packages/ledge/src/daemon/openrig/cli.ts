import { spawn } from 'node:child_process';
import { HUMAN_BINDING, HUMAN_ID } from './facts.js';

/** Runs the `rig` binary (always through agentEnv()); injected so tests can use fakeRigCli. */
export type RigExec = (args: string[], opts?: { timeoutMs?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface RigCli {
  /** `rig --version` answers. */
  available(): Promise<boolean>;
  /** First x.y.z on the first line of `rig --version`, else null. */
  version(): Promise<string | null>;
  /** `rig daemon start`, 90 s timeout. */
  daemonStart(): Promise<{ ok: boolean; detail?: string }>;
  /** Registered human ids; null when the command fails or its output is not parseable. */
  humans(): Promise<string[] | null>;
  /** Register Ledge as the human (D2 argv); `replace` appends `--replace` (R3). */
  addHuman(opts?: { replace?: boolean }): Promise<{ ok: boolean; detail?: string }>;
}

/** Spawns `rig` with the agent environment; ENOENT -> 127, timeout -> kill + code 124. */
export function realRigExec(env: () => Promise<NodeJS.ProcessEnv>): RigExec {
  return async (args, opts) => {
    const e = await env();
    return new Promise(resolve => {
      let stdout = '', stderr = '', done = false, timer: NodeJS.Timeout | undefined;
      const finish = (r: { code: number; stdout: string; stderr: string }): void => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(r); };
      let child;
      try { child = spawn('rig', args, { env: e, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (err) { return finish({ code: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 1, stdout, stderr: String(err) }); }
      child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
      child.on('error', err => finish({ code: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 1, stdout, stderr: stderr || String(err.message) }));
      child.on('close', code => finish({ code: code ?? 1, stdout, stderr }));
      if (opts?.timeoutMs) timer = setTimeout(() => { child.kill('SIGKILL'); finish({ code: 124, stdout, stderr: `${stderr}rig ${args.join(' ')} timed out after ${opts.timeoutMs} ms`.trim() }); }, opts.timeoutMs);
    });
  };
}

const idOf = (x: unknown): string | null => {
  if (typeof x === 'string') return x;
  const o = x as { id?: unknown; entityId?: unknown; humanId?: unknown } | null;
  const v = o?.id ?? o?.entityId ?? o?.humanId;
  return typeof v === 'string' ? v : null;
};

export function createRigCli(exec: RigExec): RigCli {
  const detail = (r: { stdout: string; stderr: string; code: number }): string => (r.stderr || r.stdout).trim() || `exit ${r.code}`;
  const outcome = (r: { code: number; stdout: string; stderr: string }): { ok: boolean; detail?: string } => r.code === 0 ? { ok: true } : { ok: false, detail: detail(r) };
  const version = async (): Promise<string | null> => {
    const r = await exec(['--version']); if (r.code !== 0) return null;
    return /\d+\.\d+\.\d+/.exec(r.stdout.split('\n')[0] ?? '')?.[0] ?? null;
  };
  return {
    available: async () => (await exec(['--version'])).code === 0,
    version,
    daemonStart: async () => outcome(await exec(['daemon', 'start'], { timeoutMs: 90_000 })),
    humans: async () => {
      const r = await exec(['gateway', 'human', 'list', '--json']); if (r.code !== 0) return null;
      let j: unknown; try { j = JSON.parse(r.stdout); } catch { return null; }
      const list = Array.isArray(j) ? j : Array.isArray((j as { humans?: unknown })?.humans) ? (j as { humans: unknown[] }).humans
        : Array.isArray((j as { items?: unknown })?.items) ? (j as { items: unknown[] }).items : null;
      return list ? list.map(idOf).filter((s): s is string => s !== null) : null;
    },
    addHuman: async opts => outcome(await exec(['gateway', 'human', 'add', HUMAN_ID, '--display-name', 'Ledge', '--binding', HUMAN_BINDING,
      '--delivery-class', 'D', '--actor', 'ledge', ...(opts?.replace ? ['--replace'] : [])])),
  };
}
