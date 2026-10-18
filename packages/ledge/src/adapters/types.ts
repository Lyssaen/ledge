import type { Decision, Pending, Tool } from '@ledge/protocol';

/**
 * Steps sent to the pane in order: literal text, tmux key names, a pause (some TUIs need one before Enter), or
 * `until`, which holds the plan until the bottom of the pane passes the check (a TUI that takes a burst of keys in
 * one read can apply them all to the screen it had): if it never does, the rest is not sent. `denied`: the keys before
 * it already refused (a deny with a note waiting for the input box), so a wait that fails leaves a refusal without its note.
 */
export type KeyPlan = Array<{ text: string } | { keys: string[] } | { waitMs: number } | { until: (lastLines: string) => boolean; denied?: true }>;
/** `command`: the shell command an approval dialog shows as such, when it shows one (to check the request it answers). */
export type PanePromptMatch = { kind: 'permission' | 'question' | 'plan'; text: string; options?: string[]; optionDetails?: string[]; body?: string; command?: string };

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
/** The tools whose request text is the shell command the dialog shows (Claude Code and Codex hooks, Cursor Agent). */
const COMMAND_TOOLS: ReadonlySet<string> = new Set(['Bash', 'shell', 'Shell']);
/** Whitespace aside: the pane wraps a long command or question at its width, mid-word too. */
const compact = (t: string) => t.replace(/\s+/g, '');
/**
 * False when the dialog read on screen (`shown`, from the capture right before the keys) asks something else than the
 * request answered, though the daemon still holds that request (its hook is late): no key then (STALE). Compared where
 * the screen shows what the request says: a request read from the pane, a question (its long text cut on screen, so one
 * starting as the other is the same) and a shell command the dialog shows as such (`…` where the pane cuts it). A plan
 * or a file approval, whose hook text the dialog does not show, and a dialog of another kind (assertDialogIs) are left
 * to the other checks.
 */
export function dialogShows(shown: PanePromptMatch | null, pending: Pending): boolean {
  if (!shown || shown.kind !== (pending.kind === 'diff' ? 'permission' : pending.kind)) return true;
  const screen = compact(shown.text), asked = compact(pending.text);
  if (!asked) return true;
  if (pending.kind === 'question') return screen === asked || (!!screen && (asked.startsWith(screen) || screen.startsWith(asked)));
  const same = (shownText: string) => shownText === asked || (shownText.endsWith('…') && asked.startsWith(shownText.slice(0, -1)));
  if (pending.source === 'pane') return same(screen);
  if (pending.tool !== undefined && COMMAND_TOOLS.has(pending.tool) && shown.command) return same(compact(shown.command));
  return true;
}
/** Tmux.sendText rejects newlines: a reply or a note is flattened to one line, Enter is a separate key step. */
export const flatten = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
