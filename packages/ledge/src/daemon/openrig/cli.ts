import { spawn } from 'node:child_process';
import { HUMAN_BINDING, HUMAN_ID } from './facts.js';

/** Runs the `rig` binary (always through agentEnv()); injected so tests can use fakeRigCli. `env` is laid over the agent environment. */
export type RigExec = (args: string[], opts?: { timeoutMs?: number; env?: Record<string, string> }) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface QueueCreate { source: string; destination: string; summary: string; bodyFile: string; /** `--reply-to <qitemId>` */ replyTo?: string }

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
  /** `rig queue create … --json` (facts D6); `qitemId` = the new row's id when the output names one. */
  queueCreate(o: QueueCreate): Promise<{ ok: boolean; qitemId?: string; detail?: string }>;
  /** `rig send <ref> "[Ledge] <text>"` as `ledge@external` (the signed send is unverified on a real OpenRig: first real try). */
  send(ref: string, text: string): Promise<{ ok: boolean; detail?: string }>;
}

/** Without an identity OpenRig delivers `rig send` unsigned. */
export const SEND_SESSION_NAME = 'ledge@external';
/** The signature that opens every message Ledge sends to a seat. */
export const SEND_SIGNATURE = '[Ledge] ';

/** Spawns `rig` with the agent environment; ENOENT -> 127, timeout -> kill + code 124. */
export function realRigExec(env: () => Promise<NodeJS.ProcessEnv>): RigExec {
  return async (args, opts) => {
    const e = opts?.env ? { ...(await env()), ...opts.env } : await env();
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

/** The new row's id in `queue create --json`: `qitemId`/`id` at the top or under `item`/`qitem`/`row`, else the first `qitem-…` token. */
function createdId(stdout: string): string | undefined {
  let j: unknown; try { j = JSON.parse(stdout); } catch { j = undefined; }
  const pick = (o: unknown): string | undefined => {
    const r = o as { qitemId?: unknown; id?: unknown } | null | undefined;
    const v = r && typeof r === 'object' ? (r.qitemId ?? r.id) : undefined;
    return typeof v === 'string' && v !== '' ? v : undefined;
  };
  const o = j as Record<string, unknown> | undefined;
  const found = pick(o) ?? pick(o?.item) ?? pick(o?.qitem) ?? pick(o?.row);
  return found ?? (j === undefined ? /\bqitem-[\w-]+/.exec(stdout)?.[0] : undefined);
}

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
    send: async (ref, text) => outcome(await exec(['send', ref, `${SEND_SIGNATURE}${text}`], { timeoutMs: 30_000, env: { OPENRIG_SESSION_NAME: SEND_SESSION_NAME } })),
    queueCreate: async o => {
      const r = await exec(['queue', 'create', '--source', o.source, '--destination', o.destination, '--summary', o.summary, '--body-file', o.bodyFile,
        ...(o.replyTo ? ['--reply-to', o.replyTo] : []), '--json'], { timeoutMs: 30_000 });
      if (r.code !== 0) return { ok: false, detail: detail(r) };
      const id = createdId(r.stdout); return id ? { ok: true, qitemId: id } : { ok: true };
    },
  };
}
