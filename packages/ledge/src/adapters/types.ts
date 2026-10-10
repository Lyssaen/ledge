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
}
