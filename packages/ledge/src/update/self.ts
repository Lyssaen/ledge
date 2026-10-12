import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DaemonInfo } from '@ledge/protocol';
import { LEDGE_VERSION } from '../version.js';
import { SERVICE, inDaemonService } from './guard.js';

export function gitRoot(script: string, exists: (p: string) => boolean = existsSync): string | null {
  for (let dir = dirname(script); ; dir = dirname(dir)) {
    if (exists(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

export function installKind(script: string, exists: (p: string) => boolean = existsSync): DaemonInfo['install'] {
  if (script.includes('/node_modules/@paradow/ledge/')) return 'npm';
  return gitRoot(script, exists) ? 'git' : 'unknown';
}

/** systemd sets INVOCATION_ID for every unit it starts; the cgroup says which one. */
export const underSystemd = (env: NodeJS.ProcessEnv, cgroup: string): boolean => !!env.INVOCATION_ID && inDaemonService(cgroup);

export const manualCommand = (root: string): string =>
  `cd ${root} && git pull && pnpm install && pnpm --filter @paradow/ledge build && systemctl --user restart ${SERVICE.replace(/\.service$/, '')}`;

export async function daemonInfo(): Promise<DaemonInfo> {
  const script = await realpath(process.argv[1] ?? '').catch(() => process.argv[1] ?? '');
  const cgroup = await readFile('/proc/self/cgroup', 'utf8').catch(() => '');
  const install = installKind(script);
  const root = install === 'git' ? gitRoot(script) : null;
  return { version: LEDGE_VERSION, install, systemd: underSystemd(process.env, cgroup), ...(root ? { manual: manualCommand(root) } : {}) };
}
