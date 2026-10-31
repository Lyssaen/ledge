import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool } from '@ledge/protocol';

/** The harnesses that can be the brain: tmux-driven ones only (OMP has no pane, no env, no hook; ruling C13). */
export const BRAIN_TOOLS = ['claude', 'cursor'] as const satisfies readonly Tool[];
export type BrainTool = typeof BRAIN_TOOLS[number];
export const isBrainTool = (t: unknown): t is BrainTool => (BRAIN_TOOLS as readonly unknown[]).includes(t);

/** ~/.ledge/brain.json. `enabled: null` = the user was never asked; `day` = the last daily relief (Task 10). */
export interface BrainSettings { enabled: boolean | null; tool: Tool; day?: string }

/** The settings, or `{ enabled: null, tool: 'claude' }` for a missing or broken file; an unusable tool falls back to claude. */
export function readBrainSettings(path: string): BrainSettings {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { return { enabled: null, tool: 'claude' }; }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const enabled = o.tool === 'codex' ? false : typeof o.enabled === 'boolean' ? o.enabled : null;
  const tool: Tool = isBrainTool(o.tool) ? o.tool : 'claude';
  return { enabled, tool, ...(typeof o.day === 'string' ? { day: o.day } : {}) };
}

/** Written whole through a temporary file: a torn write never leaves a broken brain.json. */
export async function writeBrainSettings(path: string, s: BrainSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ enabled: s.enabled, tool: s.tool, ...(s.day ? { day: s.day } : {}) }, null, 2)}\n`);
  await rename(tmp, path);
}
