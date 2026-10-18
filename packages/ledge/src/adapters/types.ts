import type { Decision, Pending, Tool } from '@ledge/protocol';

/**
 * Steps sent to the pane in order: literal text, tmux key names, a pause (some TUIs need one before Enter), or
 * `until`, which holds the plan until the bottom of the pane passes the check (a TUI that takes a burst of keys in
 * one read can apply them all to the screen it had): if it never does, the rest is not sent. `denied`: the keys before
 * it already refused (a deny with a note waiting for the input box), so a wait that fails leaves a refusal without its note.
 */
export type KeyPlan = Array<{ text: string } | { keys: string[] } | { waitMs: number } | { until: (lastLines: string) => boolean; denied?: true }>;
/**
 * A shell command an approval dialog shows as such: its lines on screen (trimmed, without the dialog's own `$` or the
 * folder it runs in) and the pane column each one ends at, which tells a line the TUI wrapped from one the command ends.
 */
export type ShownCommand = { lines: string[]; ends: number[] };
/** `command`: the shell command an approval dialog shows as such, when it shows one (to check the request it answers). */
export type PanePromptMatch = { kind: 'permission' | 'question' | 'plan'; text: string; options?: string[]; optionDetails?: string[]; body?: string; command?: ShownCommand };

export interface Adapter {
  tool: Tool;
  detectPrompt(pane: string): PanePromptMatch | null;
  promptStillVisible(pane: string): boolean;
  /**
   * `pane` is the bottom of the terminal right before the keys are sent, when the plan depends on the dialog. `always`
   * picks the dialog's own option that stops asking; `note` (with `deny`) is typed where the agent reads it. Either one
   * missing from the dialog on screen throws, for the client to answer in the terminal (NO_ALWAYS, NO_NOTE).
   */
  keysFor(decision: Decision, pending: Pending, pane?: string, note?: string): KeyPlan;
  /** `pending` is what the reply answers, if anything: a question can take an option number. */
  /** `pane` is the bottom of the terminal right before the keys are sent, when a prompt is pending. */
  replyPlan(text: string, pending?: Pending, pane?: string): KeyPlan;
  /** A question can be answered in free text (`replyPlan` with any text); without it, only an option number. */
  freeText?: boolean;
  interruptKeys(): string[];
  /**
   * The pane lines worth showing in the terminal preview, with the tool's own chrome (input box, status
   * line) removed. Optional: without it the preview is the raw pane. Blank runs and the last-N cut are
   * applied afterwards by buildPreview.
   */
  previewLines?(pane: string): string[];
  /**
   * The agent waits for a new prompt: no turn running and no dialog on screen. Optional: without it the daemon never
   * infers rest from the pane and relies on the hooks alone.
   */
  atRest?(pane: string): boolean;
  /** The conversation's title the tool shows in its chrome (Claude Code: on the input box's top rule), or null before it has one. Optional. */
  paneTitle?(pane: string): string | null;
  /**
   * After the keys: the prompt that was answered is gone from the pane (the bottom DETECT_LINES), even if another
   * one followed it. Optional: without it, `promptStillVisible` on the last lines decides.
   */
  promptGone?(pane: string, pending: Pending): boolean;
}

/** `always` asked of a dialog that has no option to stop asking (or no dialog Ledge can read). */
export const NO_ALWAYS = 'no "always" option in this dialog, answer in the terminal';
/** A note asked of a dialog where nothing typed would reach the agent (a trust dialog). */
export const NO_NOTE = 'no place for a note in this dialog, answer in the terminal';
/** The request the user answered is not the one in front of them any more (another dialog, another request): nothing is typed. */
export const STALE = 'the request changed, look again';
/**
 * Throws STALE when the dialog read on screen is of another kind than the request answered (a plan dialog for a
 * permission: « always » would pick its auto mode). A diff is answered in a permission dialog. `shown` null (no dialog
 * read, a pane taller than the capture) keeps each adapter's own fallback.
 */
export function assertDialogIs(pending: Pending, shown: PanePromptMatch['kind'] | null): void {
  if (shown === null) return;
  const want = pending.kind === 'diff' ? 'permission' : pending.kind;
  if (shown !== want) throw new Error(STALE);
}
/** The dialog on screen cannot be read whole (taller than the pane, a command cut with `…`): nothing is typed. */
export const UNCHECKED = 'the request on screen cannot be checked, answer in the terminal';
/** The tools whose request text is the shell command the dialog shows (Claude Code and Codex hooks, Cursor Agent). */
const COMMAND_TOOLS: ReadonlySet<string> = new Set(['Bash', 'shell', 'Shell']);
/** Whitespace aside: the pane wraps a long question at its width, mid-word too. */
const compact = (t: string) => t.replace(/\s+/g, '');
/** Columns a dialog may keep clear at the pane's right edge (its border, its padding): a line ending left of them was not wrapped. */
const EDGE = 4;
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;
/** The columns `text` takes in a terminal (a wide character two). */
export const columns = (text: string) => [...text].reduce((n, c) => n + (WIDE.test(c) ? 2 : 1), 0);
/** The command a dialog draws over `raw` (its pane lines): each line trimmed, blank ones inside kept. */
export function shownCommand(raw: string[]): ShownCommand {
  const lines = raw.map(l => l.trimEnd());
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  while (lines.length && !lines[0]!.trim()) lines.shift();
  return { lines: lines.map(l => l.trim()), ends: lines.map(columns) };
}

/**
 * Null when `asked` is the command drawn, read at the pane's `width`; else why not. Every character counts. A line
 * break where the line leaves room for the next line's first word is one in the command (its indentation aside); one
 * where it does not is the TUI's wrap, at a space, or mid-word when the line reaches the edge. A command the screen
 * cuts with `…`, or drawn over several lines with no width to read them at, is not checked.
 */
function commandMismatch({ lines, ends }: ShownCommand, asked: string, width: number | undefined): string | null {
  if (!lines.length || lines.at(-1)!.endsWith('…') || (lines.length > 1 && !width)) return UNCHECKED;
  const edge = (width ?? 0) - EDGE;
  const a = asked.trim();
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!a.startsWith(lines[i]!, at)) return STALE;
    at += lines[i]!.length;
    if (i === lines.length - 1) break;
    if (ends[i]! + 1 + columns(lines[i + 1]!.split(/\s/)[0]!) <= edge) {
      const nl = /^[ \t]*\n[ \t]*/.exec(a.slice(at));
      if (!nl) return STALE;
      at += nl[0].length;
    } else if (a[at] === ' ') at++;
    else if (ends[i]! < edge) return STALE; // only a line that reaches the edge is cut mid-word
  }
  return at === a.length ? null : STALE;
}

/**
 * Null when the dialog read on screen (`shown`, from the capture right before the keys, the pane `width` columns wide)
 * asks what the request answered asks; else the refusal: STALE when it asks something else (a newer request whose hook
 * is late), UNCHECKED when it cannot be read. Compared where the screen shows what the request says: a request read
 * from the pane, a question (its long text cut on screen, so one starting as the other is the same) and a shell
 * command, which the dialog must show. A plan or a file approval, whose hook text the dialog does not show, need only
 * a dialog of their kind.
 */
export function dialogMismatch(shown: PanePromptMatch | null, pending: Pending, width?: number): string | null {
  if (!shown) return UNCHECKED;
  if (shown.kind !== (pending.kind === 'diff' ? 'permission' : pending.kind)) return STALE;
  if (pending.kind === 'question') {
    const screen = compact(shown.text), asked = compact(pending.text);
    return !asked || screen === asked || (!!screen && (asked.startsWith(screen) || screen.startsWith(asked))) ? null : STALE;
  }
  if (pending.source === 'pane') return shown.text === pending.text ? null : STALE;
  if (pending.tool !== undefined && COMMAND_TOOLS.has(pending.tool)) return shown.command ? commandMismatch(shown.command, pending.text, width) : UNCHECKED;
  return null;
}
/** Tmux.sendText rejects newlines: a reply or a note is flattened to one line, Enter is a separate key step. */
export const flatten = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
