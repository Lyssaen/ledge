import { spawn as ptySpawn, type IPty } from 'node-pty';
import xterm from '@xterm/headless';
import { execFile } from 'node:child_process';
import type { Tmux } from '../tmux.js';
import { keyBytes } from './keys.js';
import { captureLines } from './capture.js';

/** One agent: its pseudo-terminal (ConPTY on Windows) and the headless terminal its output is rendered in. */
interface Pane { pty: IPty; term: xterm.Terminal; exited: Promise<void> }

export type PanesTmux = Tmux & {
  /** The code a pane's program exited with; `undefined` while it runs or for a name never seen. */
  exitCode(name: string): number | null | undefined;
};

/** Ends `pid` and every process it started: the agent's MCP servers and helpers go with it. */
function killTree(pane: Pane): void {
  const pid = pane.pty.pid;
  if (process.platform === 'win32') { execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {}); return; }
  // node-pty starts the program in its own session: its process group holds what it spawned.
  try { process.kill(-pid, 'SIGKILL'); } catch { try { pane.pty.kill('SIGKILL'); } catch { /* already gone */ } }
}

/**
 * The `Tmux` contract on node-pty and @xterm/headless, inside this process: what Ledge needs from tmux on a machine
 * without tmux (Windows). Spike: no attach, no control client, no option, no pane cwd.
 */
export function conptyPanes(opts: { cols?: number; rows?: number; spawn?: typeof ptySpawn } = {}): PanesTmux {
  const cols = opts.cols ?? 200, rows = opts.rows ?? 50;
  const spawn = opts.spawn ?? ptySpawn;
  const live = new Map<string, Pane>();
  const codes = new Map<string, number | null>();
  const get = (name: string) => live.get(name);
  const settle = (term: xterm.Terminal) => new Promise<void>(r => term.write('', r));
  return {
    async newSession({ name, cwd, env, unset = [], command }) {
      if (live.has(name)) throw new Error(`pane ${name} exists`);
      const childEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) if (!unset.includes(k)) childEnv[k] = v;
      const term = new xterm.Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true });
      const pty = spawn(command[0]!, command.slice(1), { name: 'xterm-256color', cols, rows, cwd, env: childEnv });
      codes.delete(name);
      let done!: () => void;
      const exited = new Promise<void>(r => { done = r; });
      pty.onData(d => term.write(d));
      pty.onExit(e => { codes.set(name, e.exitCode); live.delete(name); term.dispose(); done(); });
      live.set(name, { pty, term, exited });
    },
    async sendText(name, text) {
      if (/[\r\n]/.test(text)) throw new Error('sendText: text must not contain newlines; flatten it first');
      const p = get(name); if (!p) throw new Error(`no pane ${name}`);
      p.pty.write(text);
    },
    async sendKeys(name, keys) {
      const p = get(name); if (!p) throw new Error(`no pane ${name}`);
      const bytes = keys.map(keyBytes);
      for (const b of bytes) p.pty.write(b);
    },
    async capture(name, lines) {
      const p = get(name); if (!p) return null;
      await settle(p.term);
      return captureLines(p.term.buffer.active, lines);
    },
    async width(name) { return get(name)?.term.cols ?? null; },
    async paneCwd() { return null; },
    async hasSession(name) { return live.has(name); },
    async listSessions() { return [...live.keys()]; },
    async killSession(name) {
      const p = get(name); if (!p) return;
      killTree(p);
      await Promise.race([p.exited, new Promise(r => setTimeout(r, 5000))]);
    },
    async setOption() {},
    attachArgs() { throw new Error('attach is not available in the ConPTY spike'); },
    controlArgs() { return null; },
    exitCode(name) { return codes.get(name); },
  };
}
