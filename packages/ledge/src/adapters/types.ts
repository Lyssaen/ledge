import type { Pending, Tool } from '@ledge/protocol';

/** Steps sent to the pane in order: literal text, tmux key names, or a pause (some TUIs need one before Enter). */
export type KeyPlan = Array<{ text: string } | { keys: string[] } | { waitMs: number }>;
export type PanePromptMatch = { kind: 'permission' | 'question' | 'plan'; text: string; options?: string[] };

export interface Adapter {
  tool: Tool;
  detectPrompt(pane: string): PanePromptMatch | null;
  promptStillVisible(pane: string): boolean;
  /** `pane` is the bottom of the terminal right before the keys are sent, when the plan depends on the dialog. */
  keysFor(decision: 'accept' | 'deny', pending: Pending, pane?: string): KeyPlan;
  /** `pending` is what the reply answers, if anything: a question can take an option number. */
  replyPlan(text: string, pending?: Pending): KeyPlan;
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
}
