import type { Capabilities, Pending, Tool } from '@ledge/protocol';

/**
 * Steps sent to the pane in order: literal text, tmux key names, a pause (some TUIs need one before Enter), or
 * `until`, which holds the plan until the bottom of the pane passes the check (a TUI that takes a burst of keys in
 * one read can apply them all to the screen it had): if it never does, the rest is not sent.
 */
export type KeyPlan = Array<{ text: string } | { keys: string[] } | { waitMs: number } | { until: (lastLines: string) => boolean }>;
export type PanePromptMatch = { kind: 'permission' | 'question' | 'plan'; text: string; options?: string[]; optionDetails?: string[]; body?: string };

export interface Adapter {
  tool: Tool;
  /** What this adapter can type for a phone beyond accept, deny and an option number; the phone hides the rest. */
  capabilities: Capabilities;
  detectPrompt(pane: string): PanePromptMatch | null;
  promptStillVisible(pane: string): boolean;
  /** `pane` is the bottom of the terminal right before the keys are sent, when the plan depends on the dialog. */
  keysFor(decision: 'accept' | 'deny', pending: Pending, pane?: string): KeyPlan;
  /** `pending` is what the reply answers, if anything: a question can take an option number. */
  /** `pane` is the bottom of the terminal right before the keys are sent, when a prompt is pending. */
  replyPlan(text: string, pending?: Pending, pane?: string): KeyPlan;
  /** A question can be answered in free text (`replyPlan` with any text); without it, only an option number. */
  freeText?: boolean;
  /**
   * A phone's free answer to the question on screen (its "Other" entry): picks the entry, waits until the free field
   * has the cursor, types `text` (one line, already checked by the daemon), then Enter. Throws when the dialog on screen
   * has no free field. Present exactly when `capabilities.freeTextAnswer` is true.
   */
  otherPlan?(text: string, pending: Pending, pane: string): KeyPlan;
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
