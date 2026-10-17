import type { FileChange } from '@ledge/protocol';

/** Native tracking (spec 2026-10-13 §3): the files an action touched, read from its input alone. */
export const DIFF_LINES = 80;

const str = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined;
const cap = (lines: string[]): string => lines.length > DIFF_LINES ? [...lines.slice(0, DIFF_LINES), '…'].join('\n') : lines.join('\n');
const edit = (oldS: string, newS: string): string[] => [...oldS.split('\n').map(l => `- ${l}`), ...newS.split('\n').map(l => `+ ${l}`)];

/** Codex's patch format: one `*** Add/Update/Delete File:` header per file, its hunk lines until the next header. */
function fromPatch(patch: string): FileChange[] {
  const out: FileChange[] = [];
  let cur: { file: FileChange; lines: string[] } | null = null;
  const flush = () => { if (cur) { if (cur.lines.length) cur.file.diff = cap(cur.lines); out.push(cur.file); cur = null; } };
  for (const line of patch.split('\n')) {
    const m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (m) { flush(); cur = { file: { path: m[2]!.trim(), change: m[1] === 'Add' ? 'add' : m[1] === 'Update' ? 'edit' : 'delete' }, lines: [] }; continue; }
    const mv = /^\*\*\* Move to: (.+)$/.exec(line);
    if (mv) { if (cur && cur.file.change === 'edit') { cur.file.from = cur.file.path; cur.file.path = mv[1]!.trim(); } continue; }
    if (/^\*\*\* (Begin|End) Patch/.test(line)) continue;
    if (cur && cur.file.change !== 'delete') cur.lines.push(line);
  }
  flush();
  return out;
}

export function filesOf(tool: string | undefined, input: Record<string, unknown> | undefined): FileChange[] {
  if (!tool || !input) return [];
  const path = str(input.file_path) ?? str(input.notebook_path);
  switch (tool) {
    case 'Write': return path ? [{ path, change: 'write', ...(str(input.content) !== undefined ? { diff: cap(str(input.content)!.split('\n').map(l => `+ ${l}`)) } : {}) }] : [];
    case 'Edit': return path ? [{ path, change: 'edit', diff: cap(edit(str(input.old_string) ?? '', str(input.new_string) ?? '')) }] : [];
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits as Array<Record<string, unknown>> : [];
      return path ? [{ path, change: 'edit', diff: cap(edits.flatMap(e => edit(str(e.old_string) ?? '', str(e.new_string) ?? ''))) }] : [];
    }
    case 'NotebookEdit': return path ? [{ path, change: 'edit' }] : [];
    case 'apply_patch': return fromPatch(str(input.patch) ?? str(input.input) ?? '');
    case 'shell': case 'Bash': {
      // Codex may run apply_patch through its shell: `command` is then ['apply_patch', '<patch>'].
      const cmd = Array.isArray(input.command) ? input.command.map(String) : [];
      return cmd[0] === 'apply_patch' && cmd[1] ? fromPatch(cmd[1]) : [];
    }
    default: return [];
  }
}
