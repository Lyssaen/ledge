import type { Pending, Tool } from '@ledge/protocol';

export type KeyPlan = Array<{ text: string } | { keys: string[] }>;
export type PanePromptMatch = { kind: 'permission' | 'question'; text: string; options?: string[] };

export interface Adapter {
  tool: Tool;
  detectPrompt(pane: string): PanePromptMatch | null;
  promptStillVisible(pane: string): boolean;
  keysFor(decision: 'accept' | 'deny', pending: Pending): KeyPlan;
  /** `pending` is what the reply answers, if anything: a question can take an option number. */
  replyPlan(text: string, pending?: Pending): KeyPlan;
  interruptKeys(): string[];
  /**
   * The pane lines worth showing in the terminal preview, with the tool's own chrome (input box, status
   * line) removed. Optional: without it the preview is the raw pane. Blank runs and the last-N cut are
   * applied afterwards by buildPreview.
   */
  previewLines?(pane: string): string[];
}
