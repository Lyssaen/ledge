import { useSyncExternalStore } from 'react';
import type { Machine, Session } from '@ledge/protocol';
import { readJson, writeJson } from '../state/storage';
import { editorsAvailable, openInEditor, type EditorId, type EditorOutcome, type EditorsInstalled } from '../tauri/bridge';

/** « Ouvrir dans… » (IDE lot 11; docs/mockups/ledge-ide-interactive.html, docs/mockups/ledge-ide-open-in.html): Ledge edits
 *  no code, it opens a session's worktree in the editor the setting names. */

export const EDITORS: readonly EditorId[] = ['cursor', 'vscode', 'zed'];
/** An editor's name, the same in every language. */
export const EDITOR_NAMES: Record<EditorId, string> = { cursor: 'Cursor', vscode: 'VS Code', zed: 'Zed' };

const KEY = 'ledge.ide.openIn';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The setting: Cursor by default (docs/ide-workspace.md); anything else stored reads as Cursor. */
export const loadEditor = (): EditorId => { const v = readJson(KEY); return v === 'vscode' || v === 'zed' ? v : 'cursor'; };
export function saveEditor(e: EditorId): void { writeJson(KEY, e); notify(); }
/** The setting's value, shared: every consumer (menus, Settings) re-renders when one sets it. */
export function useEditor(): [EditorId, (e: EditorId) => void] { return [useSyncExternalStore(subscribe, loadEditor), saveEditor]; }

// The editors installed on this PC, asked once: null until the native side answers (Settings then shows nothing, no loading state).
let installed: EditorsInstalled | null = null;
let asked = false;
function ask(): void {
  if (asked) return;
  asked = true;
  void editorsAvailable().then(found => { installed = found; notify(); });
}
/** Which editors this PC has; null while unknown. Asks the native side on first use. */
export function useEditorsInstalled(): EditorsInstalled | null {
  return useSyncExternalStore(l => { ask(); return subscribe(l); }, () => installed);
}

/** Where a session's worktree is, for the editor: the folder the agent works in now (`workdir`, else where it started), in WSL
 *  for a local session, on the machine's SSH alias for a remote one. Null when nothing can say it (a remote machine Ledge
 *  no longer knows, or one without an alias). */
export function editorTarget(s: Session, machines: readonly Machine[]): { path: string; ssh?: string } | null {
  const path = s.workdir ?? s.cwd;
  const id = s.machineId ?? 'local';
  if (id === 'local') return { path };
  const ssh = machines.find(m => m.id === id)?.ssh;
  return ssh ? { path, ssh } : null;
}

/** What the page shows once the editor answered: nothing for a success, else a toast, with the Settings button for an
 *  editor this PC lacks and for Zed asked for a WSL folder (docs/mockups/ledge-ide-open-in.html, states 1, 2, 4 and 7). */
export type OpenInNotice = null | { text: string; settings: boolean };

export interface OpenInCopy {
  missing(editor: string): string; zedWsl: string; failed(editor: string, reason: string): string;
  reason: { exe: string; distro: string; path: string };
}

export function noticeFor(outcome: EditorOutcome, editor: EditorId, c: OpenInCopy): OpenInNotice {
  const name = EDITOR_NAMES[editor];
  switch (outcome.kind) {
    case 'opened': return null;
    case 'missing': return { text: c.missing(name), settings: true };
    case 'zedWsl': return { text: c.zedWsl, settings: true };
    // A reason the page does not know falls back to « the program won't start » (planche, state 7).
    case 'failed': return { text: c.failed(name, c.reason[outcome.reason] ?? c.reason.exe), settings: false };
  }
}

/** Opens the session's worktree in `editor` and says what to show. A session whose place cannot be said fails as a path
 *  the editor cannot receive. */
export async function openSessionInEditor(s: Session, machines: readonly Machine[], editor: EditorId, c: OpenInCopy): Promise<OpenInNotice> {
  const target = editorTarget(s, machines);
  if (!target) return noticeFor({ kind: 'failed', reason: 'path' }, editor, c);
  return noticeFor(await openInEditor(editor, target.path, target.ssh), editor, c);
}
