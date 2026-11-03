import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** What the daemon reads of the processes: Linux /proc, where it runs. Faked in tests. */
export interface ProcFs {
  /** Every process id. */
  pids(): Promise<number[]>;
  /** The parent of `pid`, or null when it is gone. */
  ppid(pid: number): Promise<number | null>;
  /** Its arguments, or null when unreadable. */
  cmdline(pid: number): Promise<string[] | null>;
  /** A file's text, or null when it cannot be read. */
  read(path: string): Promise<string | null>;
}

export const realProcFs: ProcFs = {
  async pids() {
    try { return (await readdir('/proc')).filter(d => /^\d+$/.test(d)).map(Number); } catch { return []; }
  },
  async ppid(pid) {
    try {
      // `pid (comm) state ppid …`: the command may hold spaces and parentheses, so the fields are read after the last ')'.
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const n = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      return Number.isInteger(n) ? n : null;
    } catch { return null; }
  },
  async cmdline(pid) {
    try { return (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean); } catch { return null; }
  },
  async read(path) {
    try { return await readFile(path, 'utf8'); } catch { return null; }
  }
};

export type ProcessTable = Map<number, number[]>;

/** Each process's children, from one reading of the process table. */
export async function processTable(fs: ProcFs): Promise<ProcessTable> {
  const children: ProcessTable = new Map();
  for (const pid of await fs.pids()) {
    const parent = await fs.ppid(pid);
    if (parent === null) continue;
    const list = children.get(parent);
    if (list) list.push(pid); else children.set(parent, [pid]);
  }
  return children;
}

/** Every descendant of `root`. */
export async function descendants(root: number, fs: ProcFs, table?: ProcessTable): Promise<number[]> {
  const children = table ?? await processTable(fs);
  const out: number[] = [];
  const stack = [...(children.get(root) ?? [])];
  while (stack.length) {
    const pid = stack.pop()!;
    out.push(pid);
    stack.push(...(children.get(pid) ?? []));
  }
  return out;
}

/** A Chrome found under a session's pane. `port` and `path`: its CDP endpoint, when it opened one (`--remote-debugging-port`). */
export interface FoundBrowser {
  pid: number;
  userDataDir: string;
  port?: number;
  path?: string;
  /** Driven through a pipe only (Playwright's default): Ledge cannot watch it. */
  pipeOnly: boolean;
}

/**
 * A process's arguments as Chrome leaves them. Chrome rewrites its title, so `/proc/<pid>/cmdline` often holds them as one
 * string; they are then cut before each `--`, and a page given last (`about:blank`) is taken off the flag it was glued to.
 */
export function chromeArgs(raw: string[]): string[] {
  if (raw.length !== 1 || !raw[0]!.includes(' --')) return raw;
  return raw[0]!.split(/ (?=--)/).map(a => a.replace(/ (?:about:|https?:|data:|file:|chrome:)\S*$/, ''));
}

const CHROME = /^(?:chrome|chromium|chromium-browser|google-chrome(?:-stable|-beta|-unstable)?|headless_shell|chrome-headless-shell|msedge)$/i;
const arg = (args: string[], name: string): string | undefined => {
  const hit = args.find(a => a === name || a.startsWith(`${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 1);
};

/**
 * The browsers under a pane: the main Chrome processes (not their renderers, `--type=…`) among the pane's descendants, each
 * with the CDP port Chrome wrote in `<user-data-dir>/DevToolsActivePort` when it was started with one. A port file left by
 * an earlier browser in the same profile is told apart by the caller, which checks the port answers.
 */
export async function findBrowsers(panePid: number, fs: ProcFs, table?: ProcessTable): Promise<FoundBrowser[]> {
  const out: FoundBrowser[] = [];
  for (const pid of await descendants(panePid, fs, table)) {
    const raw = await fs.cmdline(pid);
    const args = raw ? chromeArgs(raw) : null;
    if (!args?.length || !CHROME.test(basename(args[0]!)) || args.some(a => a.startsWith('--type='))) continue;
    const userDataDir = arg(args, '--user-data-dir');
    if (!userDataDir) continue;
    const wantsPort = arg(args, '--remote-debugging-port') !== undefined;
    const found: FoundBrowser = { pid, userDataDir, pipeOnly: !wantsPort && args.includes('--remote-debugging-pipe') };
    if (wantsPort) {
      const [port, path] = ((await fs.read(join(userDataDir, 'DevToolsActivePort'))) ?? '').split('\n').map(s => s.trim());
      const n = Number(port);
      // Only Chrome's own browser endpoint, on this machine: nothing read from the file reaches a URL unchecked.
      if (Number.isInteger(n) && n > 0 && n < 65536 && /^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(path ?? '')) { found.port = n; found.path = path; }
    }
    out.push(found);
  }
  return out;
}
