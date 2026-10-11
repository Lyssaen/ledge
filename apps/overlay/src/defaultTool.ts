import type { Tool } from '@ledge/protocol';

export const TOOLS: readonly Tool[] = ['claude', 'codex', 'cursor'];
const KEY = 'ledge.defaultTool';
const isTool = (v: unknown): v is Tool => (TOOLS as readonly unknown[]).includes(v);

/** The harness new sessions and the Ledge chat start on; Claude Code when nothing valid is stored. */
export function loadDefaultTool(): Tool {
  try { const v = localStorage.getItem(KEY); return isTool(v) ? v : 'claude'; } catch { return 'claude'; }
}

export function saveDefaultTool(tool: Tool): void {
  try { localStorage.setItem(KEY, tool); } catch { /* in-memory only */ }
}
