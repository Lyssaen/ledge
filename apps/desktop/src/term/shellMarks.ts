import { tildeHome } from './home';

/**
 * Shell integration of the free shells (#299, docs/mockups/ledge-shell-marks.html, form A): the OSC 633 sequences a shell's
 * integration script prints (as VS Code's: A prompt start, B command start, C executed, D[;code] finished, E;commandline, P;Cwd=…)
 * cut the screen into commands. A shell without them is left exactly as before: no command is ever made.
 */

/** A place in the buffer that follows the scrollback (an xterm marker): its line, -1 once trimmed. */
export interface Mark { readonly line: number; readonly isDisposed: boolean; dispose(): void }

export interface ShellCommand {
  id: number;
  /** The prompt's first line (A). */
  prompt: Mark;
  /** Where the typed command begins (B): its line and column. */
  input: { mark: Mark; x: number } | null;
  /** The output's first line (C). */
  output: Mark | null;
  /** Where it finished (D): the line and the column the cursor was at. */
  end: { mark: Mark; x: number } | null;
  /** The command line the shell reported (E); else read from the screen. */
  commandLine: string | null;
  /** The exit code; null when it finished with none (Ctrl C in some shells), undefined while not finished. */
  code: number | null | undefined;
  startedAt: number | null;
  endedAt: number | null;
}

export type CommandStatus = 'running' | 'failed' | 'ok' | 'unknown' | 'typing';

/** What the marks show for a command: running (C, no D yet), failed (D with a code other than 0), ok, unknown (finished with no code,
 *  or the next prompt came without a D: Ctrl C, the shell closed), typing (the prompt where the next command is being typed). */
export function statusOf(c: ShellCommand, last: boolean): CommandStatus {
  if (c.end) return c.code == null ? 'unknown' : c.code === 0 ? 'ok' : 'failed';
  if (c.output) return last ? 'running' : 'unknown';
  return last ? 'typing' : 'unknown';
}

/** E's command line: `\\` is a backslash, `\xAB` a byte (`\x3b` is « ; »); a nonce after it is dropped. */
export function unescape633(s: string): string {
  return s.replace(/\\(\\|x([0-9a-fA-F]{2}))/g, (_, a: string, hex?: string) => (hex ? String.fromCharCode(parseInt(hex, 16)) : a));
}

export type Osc633 =
  | { kind: 'A' } | { kind: 'B' } | { kind: 'C' } | { kind: 'D'; code: number | null }
  | { kind: 'E'; commandLine: string } | { kind: 'P'; key: string; value: string } | null;

/** One OSC 633 payload (what follows `633;`); null for what Ledge does not use. */
export function parse633(data: string): Osc633 {
  const [head, ...rest] = data.split(';');
  switch (head) {
    case 'A': return { kind: 'A' };
    case 'B': return { kind: 'B' };
    case 'C': return { kind: 'C' };
    case 'D': {
      const n = rest[0] !== undefined && /^-?\d+$/.test(rest[0]) ? Number(rest[0]) : null;
      return { kind: 'D', code: n };
    }
    case 'E': return rest.length ? { kind: 'E', commandLine: unescape633(rest[0]!) } : null;
    case 'P': {
      const kv = rest.join(';');
      const at = kv.indexOf('=');
      return at > 0 ? { kind: 'P', key: kv.slice(0, at), value: unescape633(kv.slice(at + 1)) } : null;
    }
    default: return null;
  }
}

/** The terminal as the tracker needs it: a mark at the cursor and the cursor's column. */
export interface MarkHost { mark(): Mark | null; /** A mark on an earlier line (`line` absolute), null once out of the buffer. */ markAt?(line: number): Mark | null; cursorX(): number; now(): number }

/** The most commands kept: older ones go (their marks are trimmed by the scrollback long before). */
const KEEP = 500;

export class ShellMarks {
  private list: ShellCommand[] = [];
  private nextId = 1;
  private pendingLine: string | null = null;
  /** True once the shell printed one OSC 633: until then it has no integration and nothing is shown. */
  active = false;
  cwd: string | null = null;
  /** The first folder the shell reported: where it started (a tab's folder is read from there). */
  startCwd: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly host: MarkHost) {}

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(): void { for (const fn of this.listeners) fn(); }

  /** The commands still on the buffer, oldest first. */
  commands(): readonly ShellCommand[] { return this.list.filter(c => !c.prompt.isDisposed && c.prompt.line >= 0); }

  private get last(): ShellCommand | undefined { return this.list[this.list.length - 1]; }

  /** One OSC 633 payload; true (handled) whatever it says, as xterm expects. */
  handle(data: string): boolean {
    const m = parse633(data);
    if (!m) return true;
    this.active = true;
    const h = this.host;
    switch (m.kind) {
      case 'A': {
        const mark = h.mark();
        if (!mark) break;
        // A prompt drawn again (fish as one types, bash at times) sends A and B again: the last pair is the prompt (dev-back, #299).
        const prev = this.last;
        if (prev && !prev.output && !prev.end) { this.list.pop(); prev.prompt.dispose(); prev.input?.mark.dispose(); }
        this.list.push({ id: this.nextId++, prompt: mark, input: null, output: null, end: null, commandLine: null, code: undefined, startedAt: null, endedAt: null });
        while (this.list.length > KEEP) this.list.shift()?.prompt.dispose();
        break;
      }
      case 'B': { const c = this.last; const mark = c && !c.output ? h.mark() : null; if (c && mark) c.input = { mark, x: h.cursorX() }; break; }
      case 'E': this.pendingLine = m.commandLine; { const c = this.last; if (c && !c.end) c.commandLine = m.commandLine; } break;
      case 'C': {
        const c = this.last;
        if (!c || c.output) break;
        c.output = h.mark();
        c.startedAt = h.now();
        if (this.pendingLine !== null) c.commandLine = this.pendingLine;
        this.pendingLine = null;
        break;
      }
      case 'D': {
        const c = this.last;
        if (!c || c.end) break;
        // No C before it: bash with a DEBUG trap of the person's own sends neither C nor E (dev-back, #299). A command was typed
        // (B is known): its output starts on the line after it, its start time is unknown. A D after a prompt with nothing typed
        // (none come from the scripts, an empty line gives no D) ends nothing.
        if (!c.output) {
          if (!c.input || c.input.mark.isDisposed) break;
          // Enter moved the cursor under the typed line; still on it, nothing ran.
          const here = h.mark();
          const moved = !!here && here.line > c.input.mark.line;
          here?.dispose();
          if (!moved) break;
          c.output = h.markAt?.(c.input.mark.line + 1) ?? null;
          if (!c.output) break;
        }
        const mark = h.mark();
        if (mark) c.end = { mark, x: h.cursorX() };
        c.code = m.code;
        c.endedAt = h.now();
        break;
      }
      case 'P': if (m.key === 'Cwd') { this.cwd = m.value; this.startCwd ??= m.value; } break;
    }
    this.emit();
    return true;
  }

  /** The last command, finished or not, that ran something (the prompt being typed in is not one). */
  running(): ShellCommand | undefined { const c = this.last; return c && c.output && !c.end ? c : undefined; }

  /** The xterm made again (another window): its marks are gone, the replay prints the sequences again. */
  reset(): void {
    for (const c of this.list) { c.prompt.dispose(); c.input?.mark.dispose(); c.output?.dispose(); c.end?.mark.dispose(); }
    this.list = [];
    this.pendingLine = null;
    this.emit();
  }

  dispose(): void { this.reset(); this.listeners.clear(); }
}

/** The lines a command covers, prompt to last output line, both included; `cursorLine` ends a running one. A D at column 0 is the
 *  line after the output: the output ends on the line above. */
export function commandRows(c: ShellCommand, cursorLine: number): { from: number; to: number } {
  const from = c.prompt.line;
  let to: number;
  if (c.end && !c.end.mark.isDisposed) to = c.end.x === 0 && c.end.mark.line > from ? c.end.mark.line - 1 : c.end.mark.line;
  else to = Math.max(from, cursorLine);
  return { from, to: Math.max(from, to) };
}

/** What a buffer reads as text, a line at a time, between two columns (cells, not characters: a wide character takes two), xterm's
 *  `translateToString(true, start, end)`. */
export interface LineReader { line(n: number, start?: number, end?: number): string | undefined }

/** The command as typed: E's, else the screen from B to the end of its line (or C's line when it wrapped). */
export function commandText(c: ShellCommand, buf: LineReader): string {
  if (c.commandLine !== null) return c.commandLine;
  if (!c.input) return '';
  const first = c.input.mark.line;
  const last = c.output ? Math.max(first, c.output.line - 1) : first;
  const parts: string[] = [];
  for (let n = first; n <= last; n++) parts.push(buf.line(n, n === first ? c.input.x : 0) ?? '');
  return parts.join('').trimEnd();
}

/** Its output as text: C's line to the last one, trailing blank lines dropped. */
export function outputText(c: ShellCommand, buf: LineReader, cursorLine: number): string {
  if (!c.output || c.output.isDisposed) return '';
  const { to } = commandRows(c, cursorLine);
  // D in the middle of a line (output with no final newline: `printf foo`): the output stops at its column, before the next prompt.
  const endCol = c.end && !c.end.mark.isDisposed && c.end.x > 0 && c.end.mark.line === to ? c.end.x : undefined;
  const lines: string[] = [];
  for (let n = c.output.line; n <= to; n++) lines.push((buf.line(n, 0, n === to ? endCol : undefined) ?? '').trimEnd());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join('\n');
}

/** What is typed at the prompt now (B to the cursor), or null when the prompt is not known: the last command is not a prompt being
 *  typed in (a pause #297 lost its marks, a program runs). « Relancer » types only into an empty prompt (#299 review). */
export function draftText(marks: { commands(): readonly ShellCommand[] }, buf: LineReader, cursorLine: number): string | null {
  const list = marks.commands();
  const c = list[list.length - 1];
  if (!c || statusOf(c, true) !== 'typing' || !c.input || c.input.mark.isDisposed) return null;
  const parts: string[] = [];
  for (let n = c.input.mark.line; n <= Math.max(c.input.mark.line, cursorLine); n++) parts.push(buf.line(n, n === c.input.mark.line ? c.input.x : 0) ?? '');
  return parts.join('').trim();
}

/** The most a tab's folder takes before it is cut in the middle. */
const DIR_MAX = 28;

/**
 * The folder a tab shows after its title (design-ux, qitem-20261113103231, from the validated mockup): the path from the shell's
 * starting folder, prefixed with that folder's name (« ledge », then « ledge/packages/ledge »); outside it, the last two segments
 * with ~ for the home (« ~/Workspace », « /tmp », « ~ »); past 28 characters, cut in the middle keeping the first and last segments
 * (« ledge/…/ledge »). Windows paths (PowerShell) are cut on their backslashes.
 */
export function dirLabel(cwd: string, start: string | null, home?: string): string {
  const sep = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/';
  const trim = (p: string) => (p.length > 1 ? p.replace(sep === '/' ? /\/+$/ : /\\+$/, '') : p) || sep;
  const p = trim(cwd);
  let label: string;
  const from = start ? trim(start) : null;
  if (from && (p === from || p.startsWith(from + sep))) {
    const name = from.slice(from.lastIndexOf(sep) + 1) || from;
    label = name + p.slice(from.length);
  } else {
    const t = sep === '/' ? tildeHome(p, home) : p;
    const parts = t.split(sep);
    label = parts.length <= 2 ? t : parts.slice(-2).join(sep);
  }
  if (label.length <= DIR_MAX) return label;
  const parts = label.split(sep);
  return parts.length > 2 ? `${parts[0]}${sep}…${sep}${parts[parts.length - 1]}` : label;
}
