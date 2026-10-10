import type { Tool } from '@ledge/protocol';
import type { Adapter } from './types.js';
import { claudeAdapter } from './claude.js';

export function adapterFor(tool: Tool): Adapter {
  if (tool === 'claude') return claudeAdapter;
  throw new Error(`adapter for ${tool} not implemented yet`);
}
export type { Adapter, KeyPlan, PanePromptMatch } from './types.js';
export { buildPreview, PREVIEW_LINES, PREVIEW_CAPTURE_LINES } from './preview.js';
