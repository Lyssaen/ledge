import type { Session } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import type { Wait } from '../list/time';
import { useI18n } from '../i18n/lang';
import { dotOf } from '../nav/agents';
import type { NavAction } from '../nav/state';
import { useDnd } from '../notify/prefs';
import { SHELL_ICONS } from './icons';
import { WindowCaps } from './WindowCaps';

const BELL = ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'];
const ms = (iso: string) => Date.parse(iso) || 0;

/** The sessions that wait for the user (permission or question, not offline), the oldest wait first: since the wait began
 *  (the shell's `waits`, as the List's « depuis »), else the last activity. */
export function waitingSessions(sessions: readonly Session[], waits: ReadonlyMap<string, Wait>): Session[] {
  const since = (s: Session) => ms(waits.get(s.id)?.since ?? s.lastActivityAt);
  return sessions.filter(s => { const d = dotOf(s); return d === 'approval' || d === 'question'; }).sort((a, b) => since(a) - since(b));
}

/** The « Commande » window bar that replaces Windows' own: the word mark, the waiting sessions' pill, « Ne pas déranger », the
 *  chat, and the window buttons; Ctrl K opens the palette, no field needed (#33). The bar and its gaps are the drag region
 *  (Tauri drags and maximises on a double click from the element that carries the attribute, not from its children). */
export function TitleBar({ dispatch, sessions, waits, blocked }: { blocked: boolean; dispatch: (a: NavAction) => void; sessions: readonly Session[]; waits: ReadonlyMap<string, Wait> }) {
  const { t } = useI18n();
  const [dnd, setDnd] = useDnd();
  const waiting = waitingSessions(sessions, waits);
  const first = waiting[0];
  const drag = { 'data-tauri-drag-region': '' } as const;
  return (
    <div className="titlebar" role="group" aria-label={t.titlebar.label} {...drag}>
      <div className="titlebar-left" {...drag}><span className="titlebar-mark" data-brand {...drag}>Ledge<span className="brand-dot">.</span></span></div>
      <div className="titlebar-mid" {...drag} />
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
        <WindowCaps />
      </div>
    </div>
  );
}
