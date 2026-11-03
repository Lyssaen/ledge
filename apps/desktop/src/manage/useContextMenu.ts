import { useEffect, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Project, Session } from '@ledge/protocol';

/** What a menu was opened on: a session (its own menu, `SessionMenu`), or a place of the sidebar (`SidebarMenuHost`). */
export type MenuTarget =
  | { kind: 'session'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'unassigned' }
  | { kind: 'archives' }
  | { kind: 'archive'; id: string };

export interface ContextMenuOpen { target: MenuTarget; at: { x: number; y: number }; opener: HTMLElement | null }

export interface ContextMenuState {
  /** The menu open now (one at a time): what it was opened on, where, and what gets the focus back. */
  menu: ContextMenuOpen | null;
  /** The session of a `session` target while it is still listed, else null. */
  session: Session | null;
  /** The session being renamed (the dialog). */
  renaming: Session | null;
  /** Shorthand for a session target (the seats, the tree, the session page's « … »). */
  open(id: string, at: { x: number; y: number }, opener: HTMLElement | null): void;
  openOn(target: MenuTarget, at: { x: number; y: number }, opener: HTMLElement | null): void;
  /** Closes the menu; the focus goes back to the opener unless the menu's own button already has it. */
  close(): void;
  /** The session's page with its terminal pane, on the agent's tab; an offline session shows its frozen screen there. */
  terminal(s: Session): void;
  /** Rename is for a session that answers and has not finished. */
  rename(s: Session): void;
  closeRename(): void;
  sendRename(topic: string): void;
}

/** The target still exists: a menu on something gone closes rather than acting on a stale id. */
function present(t: MenuTarget, sessions: readonly Session[], archived: readonly Session[], projects: readonly Project[]): boolean {
  switch (t.kind) {
    case 'session': return sessions.some(s => s.id === t.id);
    case 'archive': return archived.some(s => s.id === t.id);
    case 'project': return projects.some(p => p.id === t.id);
    default: return true;
  }
}

/** The one context menu of a window: the atelier's seats, the sidebar's rows and the session page's header « … » open it on their target,
 *  the focus goes back to what opened it, and the rename dialog and the terminal (the app's `showTerminal`) ride along. A session target is
 *  rendered by `SessionMenuHost`, the sidebar's by `SidebarMenuHost`. */
export function useContextMenu({ client, sessions, archived, projects, onShowTerminal }: {
  client: DaemonClient; sessions: readonly Session[]; archived: readonly Session[]; projects: readonly Project[]; onShowTerminal(id: string): void;
}): ContextMenuState {
  const [menu, setMenu] = useState<ContextMenuOpen | null>(null);
  const [renaming, setRenaming] = useState<Session | null>(null);
  const target = menu?.target;
  const session = target?.kind === 'session' ? sessions.find(s => s.id === target.id) ?? null : null;
  const gone = target !== undefined && !present(target, sessions, archived, projects);
  useEffect(() => { if (gone) setMenu(null); }, [gone]);
  return {
    menu: gone ? null : menu, session, renaming,
    open: (id, at, opener) => setMenu({ target: { kind: 'session', id }, at, opener }),
    openOn: (t, at, opener) => setMenu({ target: t, at, opener }),
    close: () => {
      const opener = menu?.opener;
      setMenu(null);
      // The menu's own button (the « … ») is given the focus by the menu itself; a context menu has none: back to the row or the seat.
      const active = document.activeElement;
      if (opener?.isConnected && (active === null || active === document.body || active.closest('[role=menu]'))) opener.focus();
    },
    terminal: s => onShowTerminal(s.id),
    rename: s => { if (s.state !== 'exited' && !s.offline) setRenaming(s); },
    closeRename: () => setRenaming(null),
    sendRename: topic => { if (renaming) client.send({ type: 'session.rename', id: renaming.id, topic }); }
  };
}
