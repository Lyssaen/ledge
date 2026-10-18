import { useEffect, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { openSessionTerminal } from '../session/terminal';

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
  /** Terminal and rename are for a session that answers; a finished one cannot be renamed. */
  terminal(s: Session): void;
  rename(s: Session): void;
  closeRename(): void;
  sendRename(topic: string): void;
}

/** The state shared by the atelier's seats and the session page's header « … »: which session's menu is open and where, the focus going
 *  back to what opened it, the rename dialog, and the terminal. Rendered by `SessionMenuHost`. */
export function useSessionMenu({ client, sessions, notify }: { client: DaemonClient; sessions: readonly Session[]; notify(text: string): void }): SessionMenuState {
  const { t } = useI18n();
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
    terminal: s => {
      if (s.offline) return;
      void openSessionTerminal(client, s).then(ok => { if (!ok) notify(t.session.terminal.openFailed(s.name)); });
    },
    rename: s => { if (s.state !== 'exited' && !s.offline) setRenaming(s); },
    closeRename: () => setRenaming(null),
    sendRename: topic => { if (renaming) client.send({ type: 'session.rename', id: renaming.id, topic }); }
  };
}
