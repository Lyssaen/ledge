import type { IPty, spawn as PtySpawn } from 'node-pty';
import type { Terminal } from '@xterm/headless';
import type { SerializeAddon } from '@xterm/addon-serialize';
import { execFile } from 'node:child_process';
import type { Tmux } from '../tmux.js';
import { log as daemonLog } from '../log.js';
import { keyBytes } from './keys.js';
import { captureLines } from './capture.js';
import { resolveCommand } from './resolve.js';

/** A text is typed this many characters at a time, SLICE_GAP_MS apart (see `sendText`). */
const SLICE = 256, SLICE_GAP_MS = 20;

/** Where an attached terminal gets a pane's output, then its end. */
export interface PaneSink { data(d: string): void; end(code: number | null): void }
/** An attached terminal: the screen as it was, then input typed into the pane until `detach`. */
export interface PaneAttachment { screen: string; write(input: string): void; detach(): void }

/** One agent: its pseudo-terminal (ConPTY on Windows), the headless terminal its output is rendered in, the queue its
 *  writes go through, and the terminals attached to it. */
interface Pane { pty: IPty; term: Terminal; serializer: SerializeAddon; exited: Promise<void>; queue: Promise<void>; sinks: Set<PaneSink> }

type Loaded = { spawn: typeof PtySpawn; Terminal: typeof Terminal; SerializeAddon: typeof SerializeAddon };
/** node-pty (a native module, no Linux prebuild) and the xterm bundles load on the first pane, never in a process that
 *  starts none: a hook, the CLI, or the daemon on Linux. */
async function load(spawn?: typeof PtySpawn): Promise<Loaded> {
  const xterm = await import('@xterm/headless');
  const serialize = await import('@xterm/addon-serialize');
  return { spawn: spawn ?? (await import('node-pty')).spawn, Terminal: (xterm.default ?? xterm).Terminal, SerializeAddon: (serialize.default ?? serialize).SerializeAddon };
}

export type PanesTmux = Tmux & {
  /** The code a pane's program exited with; `undefined` while it runs or for a name never seen. */
  exitCode(name: string): number | null | undefined;
  /** Attaches a terminal: null when there is no such pane. */
  attachTo(name: string, sink: PaneSink): Promise<PaneAttachment | null>;
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
 * without tmux (Windows). The pane host (`panes/host.ts`) serves it to the daemon. No control client, no option, no
 * pane cwd.
 */
export function conptyPanes(opts: { cols?: number; rows?: number; spawn?: typeof PtySpawn; killWaitMs?: number; log?: (line: string) => void } = {}): PanesTmux {
  const cols = opts.cols ?? 200, rows = opts.rows ?? 50;
  const log = opts.log ?? daemonLog;
  let loaded: Promise<Loaded> | undefined;
  const live = new Map<string, Pane>();
  const codes = new Map<string, number | null>();
  const get = (name: string) => live.get(name);
  const settle = (term: Terminal) => new Promise<void>(r => term.write('', r));
  /** One write at a time per pane: a reply typed in slices is never cut by keys or another reply. */
  const enqueue = (p: Pane, job: () => Promise<void> | void): Promise<void> => { const run = p.queue.then(job); p.queue = run.catch(() => {}); return run; };
  // claude.exe on ConPTY keeps only the end of one big write (spike: 267 of 2316 characters left); 256 characters
  // every 20 ms arrive whole. Sliced by code point, so no surrogate pair is cut.
  const typeSliced = async (p: Pane, text: string) => {
    const chars = [...text];
    for (let i = 0; i < chars.length; i += SLICE) {
      if (i) await new Promise(r => setTimeout(r, SLICE_GAP_MS));
      p.pty.write(chars.slice(i, i + SLICE).join(''));
    }
  };
  const ended = (name: string, p: Pane, code: number | null) => {
    if (live.get(name) !== p) return;
    codes.set(name, code); live.delete(name);
    for (const s of p.sinks) s.end(code);
    p.sinks.clear();
  };
  return {
    async newSession({ name, cwd, env, unset = [], command }) {
      if (live.has(name)) throw new Error(`pane ${name} exists`);
      const { spawn, Terminal, SerializeAddon } = await (loaded ??= load(opts.spawn));
      if (live.has(name)) throw new Error(`pane ${name} exists`);
      const childEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) if (!unset.includes(k)) childEnv[k] = v;
      const term = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true });
      const serializer = new SerializeAddon();
      // Typed for @xterm/xterm, made for the headless terminal too.
      term.loadAddon(serializer as unknown as Parameters<Terminal['loadAddon']>[0]);
      const pty = spawn(resolveCommand(command[0]!, childEnv), command.slice(1), { name: 'xterm-256color', cols, rows, cwd, env: childEnv });
      codes.delete(name);
      let done!: () => void;
      const pane: Pane = { pty, term, serializer, exited: new Promise<void>(r => { done = r; }), queue: Promise.resolve(), sinks: new Set() };
      pty.onData(d => { term.write(d); for (const s of pane.sinks) s.data(d); });
      // The terminal is not disposed: a capture may still be reading it, and it goes with the pane.
      pty.onExit(e => { ended(name, pane, e.exitCode); done(); });
      live.set(name, pane);
    },
    async sendText(name, text) {
      if (/[\r\n]/.test(text)) throw new Error('sendText: text must not contain newlines; flatten it first');
      const p = get(name); if (!p) throw new Error(`no pane ${name}`);
      await enqueue(p, () => typeSliced(p, text));
    },
    async sendKeys(name, keys) {
      const p = get(name); if (!p) throw new Error(`no pane ${name}`);
      const bytes = keys.map(keyBytes);
      await enqueue(p, () => { for (const b of bytes) p.pty.write(b); });
    },
    async capture(name, lines) {
      const p = get(name); if (!p) return null;
      await settle(p.term);
      return captureLines(p.term.buffer.active, lines, { join: false });
    },
    async width(name) { return get(name)?.term.cols ?? null; },
    async paneCwd() { return null; },
    async hasSession(name) { return live.has(name); },
    async listSessions() { return [...live.keys()]; },
    async killSession(name) {
      const p = get(name); if (!p) return;
      killTree(p);
      const waitMs = opts.killWaitMs ?? 5000;
      const gone = await Promise.race([p.exited.then(() => true), new Promise<false>(r => setTimeout(() => r(false), waitMs))]);
      if (gone) return;
      log(`pane ${name} did not end ${waitMs} ms after the kill: pty.kill(), and the pane is forgotten`);
      try { p.pty.kill(); } catch { /* already gone */ }
      ended(name, p, null);
    },
    async setOption() {},
    attachArgs() { throw new Error('a ConPTY pane is attached through the pane host, not by a command'); },
    controlArgs() { return null; },
    exitCode(name) { return codes.get(name); },
    async attachTo(name, sink) {
      const p = get(name); if (!p) return null;
      await settle(p.term);
      // The pane may have ended while its screen settled: its sinks were ended then, a new one would wait forever.
      if (live.get(name) !== p) return null;
      const screen = p.serializer.serialize();
      p.sinks.add(sink);
      return { screen, write: input => { void enqueue(p, () => typeSliced(p, input)); }, detach: () => { p.sinks.delete(sink); } };
    },
  };
}
