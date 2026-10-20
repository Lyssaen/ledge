import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Who writes a session's journal: the one OMP process the daemon started for it. The pid is kept beside the journal so that a
 * daemon that died (or was killed) without closing OMP, and the one after it, never leave two writers on one conversation: a
 * survivor is ended before the session is resumed (spec 2026-10-20 §6). The pid is only trusted when the process is still an
 * OMP started with this session's directory (pids are reused).
 */
const FILE = 'owner.json';

export async function writeOwner(dir: string, pid: number | undefined): Promise<void> {
  if (pid === undefined) return;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, FILE), JSON.stringify({ pid, at: new Date().toISOString() }));
}

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

/** The process's arguments (Linux /proc, which is where the daemon runs), or null when unreadable. */
async function argsOf(pid: number): Promise<string[] | null> {
  try { return (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean); } catch { return null; }
}

/** Ends the previous OMP of the session directory `dir` if it still runs; true when one was ended. Never touches another process. */
export async function reapOwner(dir: string, opts: { graceMs?: number } = {}): Promise<boolean> {
  let pid: number;
  try { pid = (JSON.parse(await readFile(join(dir, FILE), 'utf8')) as { pid?: number }).pid ?? 0; } catch { return false; }
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid || !alive(pid)) return false;
  const args = await argsOf(pid);
  const i = args?.indexOf('--session-dir') ?? -1;
  if (!args || i === -1 || args[i + 1] !== dir) return false;
  const waitGone = async (ms: number) => { for (const end = Date.now() + ms; Date.now() < end;) { if (!alive(pid)) return true; await new Promise(r => setTimeout(r, 50)); } return !alive(pid); };
  try { process.kill(pid, 'SIGTERM'); } catch { return false; }
  if (!(await waitGone(opts.graceMs ?? 3000))) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } await waitGone(2000); }
  return true;
}
