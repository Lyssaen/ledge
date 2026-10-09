import type { Pending, Tool } from '@ledge/protocol';

export type KeyPlan = Array<{ text: string } | { keys: string[] }>;
export type PanePromptMatch = { kind: 'permission' | 'question'; text: string; options?: string[] };

export interface Adapter {
  tool: Tool;
  detectPrompt(pane: string): PanePromptMatch | null;
  promptStillVisible(pane: string): boolean;
  keysFor(decision: 'accept' | 'deny', pending: Pending): KeyPlan;
  replyPlan(text: string): KeyPlan;
  interruptKeys(): string[];
}
