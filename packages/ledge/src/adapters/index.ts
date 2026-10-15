import { ToolSchema, type Capabilities, type Tool } from '@ledge/protocol';
import type { Adapter } from './types.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { cursorAdapter } from './cursor.js';

export function adapterFor(tool: Tool): Adapter {
  if (tool === 'claude') return claudeAdapter;
  if (tool === 'codex') return codexAdapter;
  if (tool === 'cursor') return cursorAdapter;
  throw new Error(`adapter for ${tool} not implemented yet`);
}
/** What each tool can answer, as its adapter declares it: the phone's snapshot carries it. */
export function capabilitiesByTool(): Record<Tool, Capabilities> {
  return Object.fromEntries(ToolSchema.options.map(t => [t, { ...adapterFor(t).capabilities }])) as Record<Tool, Capabilities>;
}

export type { Adapter, KeyPlan, PanePromptMatch } from './types.js';
export { buildPreview, PREVIEW_LINES, PREVIEW_CAPTURE_LINES } from './preview.js';
