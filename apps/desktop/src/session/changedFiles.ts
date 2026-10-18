import type { FileChange, ThreadItem, ToolItem } from '@ledge/protocol';
import { parseDiff, type ParsedDiff } from './diff';

export type Change = FileChange['change'] | 'rename';
export interface Touch { tool: ToolItem; turn: number; change: FileChange['change']; from?: string; diff: ParsedDiff | null }
export interface ChangedFile { path: string; shown: string; from?: string; change: Change; plus: number; minus: number; cut: boolean; touches: Touch[] }

/** The file name: what follows the last slash. */
export const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** `path` without the `${cwd}/` prefix when below it; as is otherwise. */
export function relativeTo(path: string, cwd: string): string {
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

/** Gone at the end (deleted last, whatever came before: added, renamed) → delete; renamed → rename; created by its first
 *  action, or again by its last (deleted then added back) → add; only rewritten → write; else edit. */
const changeOf = (touches: Touch[], renamed: boolean): Change => {
  const last = touches[touches.length - 1]!.change;
  return last === 'delete' ? 'delete'
    : renamed ? 'rename'
    : touches[0]!.change === 'add' || last === 'add' ? 'add'
    : touches.every(t => t.change === 'write') ? 'write'
    : 'edit';
};

/** The files of the shown thread's successful actions, in order of their first action. A rename moves the entry from the old path to the new. */
export function changedFiles(items: readonly ThreadItem[], cwd: string, helperId?: string): ChangedFile[] {
  const entries: Array<{ path: string; shown: string; from?: string; renamed: boolean; touches: Touch[] }> = [];
  for (const item of items) {
    if (item.kind !== 'tool' || item.status !== 'success' || item.helperId !== helperId) continue;
    for (const f of item.files) {
      const shown = relativeTo(f.path, cwd);
      const from = f.from === undefined ? undefined : relativeTo(f.from, cwd);
      const touch: Touch = { tool: item, turn: item.turn, change: f.change, ...(from !== undefined ? { from } : {}), diff: f.diff ? parseDiff(f.diff) : null };
      let entry = entries.find(e => e.shown === shown) ?? (from !== undefined ? entries.find(e => e.shown === from) : undefined);
      if (!entry) { entry = { path: f.path, shown, renamed: false, touches: [] }; entries.push(entry); }
      if (from !== undefined) { entry.from ??= from; entry.renamed = true; entry.path = f.path; entry.shown = shown; }
      entry.touches.push(touch);
    }
  }
  return entries.map(e => ({
    path: e.path, shown: e.shown, ...(e.from !== undefined ? { from: e.from } : {}),
    change: changeOf(e.touches, e.renamed),
    plus: e.touches.reduce((sum, t) => sum + (t.diff?.plus ?? 0), 0),
    minus: e.touches.reduce((sum, t) => sum + (t.diff?.minus ?? 0), 0),
    cut: e.touches.some(t => t.diff?.cut === true),
    touches: e.touches
  }));
}

/** The file an action names: by its path, else by its path below the cwd (an absolute path for an entry kept relative), else
 *  by an older path of it (an action before a rename); undefined when none. */
export function findFile(files: readonly ChangedFile[], path: string, cwd: string): ChangedFile | undefined {
  const shown = relativeTo(path, cwd);
  return files.find(f => f.path === path) ?? files.find(f => f.shown === shown)
    ?? files.find(f => f.from === shown || f.touches.some(x => x.from === shown));
}

/** Grouped by the folder of `shown` (« . » at the root), in order of first appearance. */
export function byFolder(files: readonly ChangedFile[]): Array<{ dir: string; files: ChangedFile[] }> {
  const groups: Array<{ dir: string; files: ChangedFile[] }> = [];
  for (const f of files) {
    const slash = f.shown.lastIndexOf('/');
    const dir = slash > 0 ? f.shown.slice(0, slash) : '.';
    const g = groups.find(x => x.dir === dir);
    if (g) g.files.push(f); else groups.push({ dir, files: [f] });
  }
  return groups;
}
