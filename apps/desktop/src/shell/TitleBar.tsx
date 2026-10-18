import { useEffect, useState } from 'react';
import type { Session } from '@ledge/protocol';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon } from '@ledge/ui/ui/icons';
import type { Wait } from '../list/time';
import { useI18n } from '../i18n/lang';
import { dotOf } from '../nav/agents';
import type { NavAction } from '../nav/state';
import { useDnd } from '../notify/prefs';
import { closeWindow, isWindowMaximized, minimizeWindow, onWindowResized, toggleMaximizeWindow } from '../tauri/bridge';
import { SHELL_ICONS } from './icons';

const BELL = ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'];
const ms = (iso: string) => Date.parse(iso) || 0;

/** The sessions that wait for the user (permission or question, not offline), the oldest wait first: since the wait began
 *  (the shell's `waits`, as the List's « depuis »), else the last activity. */
export function waitingSessions(sessions: readonly Session[], waits: ReadonlyMap<string, Wait>): Session[] {
  const since = (s: Session) => ms(waits.get(s.id)?.since ?? s.lastActivityAt);
  return sessions.filter(s => { const d = dotOf(s); return d === 'approval' || d === 'question'; }).sort((a, b) => since(a) - since(b));
}

/** Whether the window is maximised, kept fresh by each resize (maximising and restoring resize it). */
function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () => { void isWindowMaximized().then(m => { if (live) setMaximized(m); }); };
    refresh();
    const off = onWindowResized(refresh);
    return () => { live = false; off(); };
  }, []);
  return maximized;
}

/** The « Commande » window bar that replaces Windows' own: the word mark, the search field (it opens the palette, as Ctrl K),
 *  the waiting sessions' pill, « Ne pas déranger », the chat, and the window buttons. The bar and its gaps are the drag region
 *  (Tauri drags and maximises on a double click from the element that carries the attribute, not from its children). */
export function TitleBar({ dispatch, sessions, waits, blocked }: { blocked: boolean; dispatch: (a: NavAction) => void; sessions: readonly Session[]; waits: ReadonlyMap<string, Wait> }) {
  const { t } = useI18n();
  const [dnd, setDnd] = useDnd();
  const maximized = useMaximized();
  const waiting = waitingSessions(sessions, waits);
  const first = waiting[0];
  const drag = { 'data-tauri-drag-region': '' } as const;
  return (
    <div className="titlebar" role="group" aria-label={t.titlebar.label} {...drag}>
      <div className="titlebar-left" {...drag}><span className="titlebar-mark" data-brand {...drag}>Ledge<span className="brand-dot">.</span></span></div>
      <div className="titlebar-mid" inert={blocked} {...drag}>
        <button className="titlebar-cmd" disabled={blocked} aria-label={t.titlebar.search} onClick={() => dispatch({ type: 'modal', modal: { kind: 'search' } })}>
          <Icon d={SHELL_ICONS.search} size={14} /><span>{t.titlebar.search}</span><Kbd>Ctrl K</Kbd>
        </button>
      </div>
      <div className="titlebar-right" {...drag}>
        <div className="titlebar-tools" inert={blocked}>
        {first && (
          <button className="titlebar-wait" disabled={blocked} aria-label={t.titlebar.waiting(waiting.length)} title={t.titlebar.waiting(waiting.length)} onClick={() => dispatch({ type: 'open', id: first.id })}>
            <i />{waiting.length}
          </button>
        )}
        <button className="titlebar-ib" disabled={blocked} aria-label={t.titlebar.dnd} title={dnd ? t.titlebar.dndOn : t.titlebar.dnd} aria-pressed={dnd} onClick={() => setDnd(!dnd)}>
          <Icon d={BELL} size={16} />
        </button>
        <button className="titlebar-ib" disabled={blocked} aria-label={t.side.chat} title={t.top.chat} onClick={() => dispatch({ type: 'chat', open: true })}>
          <Icon d={SHELL_ICONS.chat} size={16} />
        </button>
        </div>
        <div className="titlebar-caps">
          <button aria-label={t.titlebar.minimize} title={t.titlebar.minimize} onClick={minimizeWindow}>
            <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" /></svg>
          </button>
          <button aria-label={maximized ? t.titlebar.restore : t.titlebar.maximize} title={maximized ? t.titlebar.restore : t.titlebar.maximize} onClick={toggleMaximizeWindow}>
            {maximized
              ? <svg viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y="2.5" width="7" height="7" rx="1" /><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" /></svg>
              : <svg viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y=".5" width="9" height="9" rx="1" /></svg>}
          </button>
          <button className="close" aria-label={t.titlebar.close} title={t.titlebar.close} onClick={closeWindow}>
            <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M.5.5l9 9M9.5.5l-9 9" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
