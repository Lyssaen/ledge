import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { ensureLedgeDir } from '../paths.js';

export const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'] as const;

type HookEntry = { matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> };

export function mergeClaudeHooks(settings: unknown, command = 'ledge hook'): { settings: object; changed: boolean } {
  const base = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  const hooks = { ...((base.hooks as Record<string, HookEntry[]> | undefined) ?? {}) };
  let changed = false;
  for (const ev of CLAUDE_EVENTS) {
    const list = [...(hooks[ev] ?? [])];
    const mine = `${command} ${ev}`;
    if (!list.some(e => e.hooks?.some(h => h.command === mine))) {
      list.push({ hooks: [{ type: 'command', command: mine, timeout: 5 }] });
      changed = true;
    }
    hooks[ev] = list;
  }
  return { settings: { ...base, hooks }, changed };
}

export async function runSetup(opts: { settingsPath?: string } = {}): Promise<string[]> {
  const out: string[] = [];
  await ensureLedgeDir();
  out.push('~/.ledge ready (tmux.conf written if missing)');
  const settingsPath = opts.settingsPath ?? join(homedir(), '.claude', 'settings.json');
  let current: unknown = {};
  let raw: string | null = null;
  try { raw = await readFile(settingsPath, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; /* new file */ }
  if (raw !== null) {
    try { current = JSON.parse(raw); }
    catch { throw new Error('settings.json is not valid JSON, not modified'); }
  }
  const { settings, changed } = mergeClaudeHooks(current);
  if (changed) {
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    out.push(`Claude Code hooks added in ${settingsPath}`);
  } else out.push('Claude Code hooks already present');
  return out;
}
