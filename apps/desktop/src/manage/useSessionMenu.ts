import { useEffect, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';

export interface SessionMenuOpen { id: string; at: { x: number; y: number }; opener: HTMLElement | null }

export interface SessionMenuState {
  /** The menu open now (one at a time), and its session while it is still listed. */
  menu: SessionMenuOpen | null;
  session: Session | null;
  /** The session being renamed (the dialog). */
  renaming: Session | null;
  open(id: string, at: { x: number; y: number }, opener: HTMLElement | null): void;
  /** Closes the menu; the focus goes back to the opener unless the menu's own button already has it. */
  close(): void;
  /** The session's page with its terminal pane, on the agent's tab; an offline session shows its frozen screen there. */
  terminal(s: Session): void;
  /** Rename is for a session that answers and has not finished. */
  rename(s: Session): void;
  closeRename(): void;
  sendRename(topic: string): void;
}

/** The state shared by the atelier's seats and the session page's header « … »: which session's menu is open and where, the focus going
 *  back to what opened it, the rename dialog, and the terminal (the app's `showTerminal`). Rendered by `SessionMenuHost`. */
export function useSessionMenu({ client, sessions, onShowTerminal }: { client: DaemonClient; sessions: readonly Session[]; onShowTerminal(id: string): void }): SessionMenuState {
  const [menu, setMenu] = useState<SessionMenuOpen | null>(null);
  const [renaming, setRenaming] = useState<Session | null>(null);
  const session = menu ? sessions.find(s => s.id === menu.id) ?? null : null;
  useEffect(() => { if (menu !== null && session === null) setMenu(null); }, [menu, session]);
  return {
    menu, session, renaming,
    open: (id, at, opener) => setMenu({ id, at, opener }),
    close: () => {
      const opener = menu?.opener;
      setMenu(null);
      // The menu's own button (the « … ») is given the focus by the menu itself; a context menu has none: back to the seat.
      const active = document.activeElement;
      if (opener?.isConnected && (active === null || active === document.body || active.closest('[role=menu]'))) opener.focus();
    },
    terminal: s => onShowTerminal(s.id),
    rename: s => { if (s.state !== 'exited' && !s.offline) setRenaming(s); },
    closeRename: () => setRenaming(null),
    sendRename: topic => { if (renaming) client.send({ type: 'session.rename', id: renaming.id, topic }); }
  };
}
