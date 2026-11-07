import { useContext, useEffect, useRef, useSyncExternalStore, useCallback } from 'react';
import { TermStoreContext } from '../term/useTerms';
import type { AgentMode } from '../term/mode';
import { useTabPlace } from '../workspace/tabPlace';

/** Drives the agent's screen for a view that can show it: the session page (while on its Terminal view) or an IDE terminal tab
 *  (always). Outside the IDE the page is the store's default view, asked as before. In an IDE tab the view is the tab (its
 *  key): a hidden tab, a view that stops wanting it, or a gone tab lets its own session's screen go, only if it holds it (R2). */
export function useAgentScreen(sid: string, mode: AgentMode, want: boolean): void {
  const store = useContext(TermStoreContext);
  const tabPlace = useTabPlace();
  const inTab = tabPlace !== null;
  const viewer = tabPlace?.key ?? 'page';
  const shownHere = tabPlace === null || tabPlace.visible;
  const subscribeHolder = useCallback((fn: () => void) => (store ? store.subscribe(fn) : () => {}), [store]);
  const holder = useSyncExternalStore(subscribeHolder, () => store?.viewerOf(sid) ?? null);
  // The session this view last asked for while shown wanting it. Asking again (a fleet update, a new mode) must not take
  // the screen back from a tab that took it since (« Afficher ici »): only a fresh show does, or a screen nobody holds.
  const asked = useRef<string | null>(null);
  const modeKey = JSON.stringify(mode);
  useEffect(() => {
    if (!store) return;
    // A hidden tab lets its screen go (it would keep an attachment open for nothing, and leave a shown tab of the same
    // session on the note): a shown one takes it, and coming back attaches again.
    if (!shownHere) { asked.current = null; store.hideAgent(sid, viewer); return; }
    if (want) {
      // A tab shown outside the focused group (a linked group following a session, a terminal opened beside) was not asked
      // for: it leaves the screen to the view holding it (a shown one: a hidden view holds none) and shows the R2 note.
      // The holder now, not as rendered: a view mounted in the same commit may have just taken it.
      const held = store.viewerOf(sid);
      const unasked = tabPlace !== null && !tabPlace.active && held !== null && held !== viewer;
      // Outside the IDE the page is the store's default view: asked as before.
      if (!unasked && (asked.current !== sid || held === null || held === viewer)) { if (inTab) store.showAgent(sid, mode, viewer); else store.showAgent(sid, mode); }
      asked.current = sid;
    } else {
      asked.current = null;
      if (inTab) store.hideAgent(sid, viewer);
      else store.hideAgent();
    }
    // `mode` is read through its key: the same mode in a new object asks nothing. `tabPlace.active` is not a cause: focusing a
    // group does not take the screen (« Afficher ici » does).
  }, [store, want, sid, modeKey, shownHere, inTab, viewer, holder]); // eslint-disable-line react-hooks/exhaustive-deps
  const leaving = useRef<{ sid: string; viewer: string } | undefined>(undefined);
  leaving.current = inTab ? { sid, viewer } : undefined;
  useEffect(() => () => { const l = leaving.current; if (l) store?.hideAgent(l.sid, l.viewer); else store?.hideAgent(); }, [store]);
}
