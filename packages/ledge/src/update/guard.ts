import { readFile } from 'node:fs/promises';
import { run } from '../tmux.js';
import { SERVICE } from '../cli/setup.js';

export { SERVICE };

/** A `/proc/<pid>/cgroup` text: true when the process belongs to the daemon's unit (killed with it on restart). */
export const inDaemonService = (cgroup: string): boolean => cgroup.split('\n').some(l => l.split('/').includes(SERVICE));

/**
 * Whether restarting the daemon would kill the tmux server, hence every agent. A server started before the scope fix
 * still lives in the service. An unreadable cgroup counts as at risk: refusing an update costs less than losing sessions.
 */
export async function tmuxServerAtRisk(opts: { socket?: string; runTmux?: typeof run; readCgroup?: (pid: string) => Promise<string> } = {}): Promise<boolean> {
  const runTmux = opts.runTmux ?? run;
  const readCgroup = opts.readCgroup ?? (pid => readFile(`/proc/${pid}/cgroup`, 'utf8'));
  const r = await runTmux(['-L', opts.socket ?? 'ledge', 'list-sessions', '-F', '#{pid}']);
  if (r.code !== 0) return false;
  const pid = r.stdout.split('\n').map(s => s.trim()).find(Boolean);
  if (!pid) return false;
  try { return inDaemonService(await readCgroup(pid)); } catch { return true; }
}
