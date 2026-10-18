import { useSyncExternalStore } from 'react';
import type { Tool } from '@ledge/protocol';
import { readJson, writeJson } from '../state/storage';

/** The default agent (Settings › General), ported from origin/feat/desktop (launch/form.ts): it feeds Ledge's chat and its
 *  cards. The New session form keeps no default (spec §5). */
export const TOOL_KEY = 'desktop.tool';
export const TOOLS: readonly Tool[] = ['claude', 'codex', 'cursor'];
const isTool = (v: unknown): v is Tool => typeof v === 'string' && (TOOLS as readonly string[]).includes(v);

/** The stored default agent; Claude Code when none is stored or the stored value is unknown. */
export function loadTool(): Tool {
  const v = readJson(TOOL_KEY);
  return isTool(v) ? v : 'claude';
}

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Keeps the default agent and tells every reader (the chat follows at once, without reloading). */
export function saveTool(t: Tool): void {
  writeJson(TOOL_KEY, t);
  listeners.forEach(l => l());
}

/** The default agent and its setter. The snapshot is read from storage, so it never lags behind a store that was cleared. */
export function useDefaultTool(): [Tool, (t: Tool) => void] {
  return [useSyncExternalStore(subscribe, loadTool, loadTool), saveTool];
}
