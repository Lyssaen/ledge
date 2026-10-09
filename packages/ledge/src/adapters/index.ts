import type { Tool } from '@ledge/protocol';
import type { Adapter } from './types.js';
import { claudeAdapter } from './claude.js';

export function adapterFor(tool: Tool): Adapter {
  if (tool === 'claude') return claudeAdapter;
  throw new Error(`adapter for ${tool} not implemented yet`);
}
export type { Adapter, KeyPlan, PanePromptMatch } from './types.js';
