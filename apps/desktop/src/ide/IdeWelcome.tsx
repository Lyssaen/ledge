import type { JSX } from 'react';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { dotOf } from '../nav/agents';
import { LedgeMark } from '../shell/LedgeMark';
import { providerOf } from '../workspace/sessionTab';
import { ProviderLogo } from './ProviderLogo';

export type EmptyPick = 'terminal' | 'launch' | 'search' | 'ledge' | 'next' | 'openrig' | 'atelier' | 'shell' | 'settings';

/** How many sessions « Récentes » lists. */
export const RECENT_MAX = 4;

/** The sessions « Récentes » lists: not archived, the last active first. */
export function recentSessions(sessions: readonly Session[]): Session[] {
  return sessions.filter(s => !s.archivedAt).sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)).slice(0, RECENT_MAX);
}

const Keys = ({ keys }: { keys: string }) => (
  <span className="ide-wl-keys" aria-hidden="true">{keys.split(' ').map(k => <kbd key={k} className="ide-kbd">{k}</kbd>)}</span>
);

/** A group without tabs (mockup docs/mockups/accueil-vide, welcome()): the window's only group as a split's. Ledge's mark, what
 *  to start, the last sessions. `terminal` names the session the group was split from, while it still exists: its Terminal
 *  comes first, set forward, with the tip on linking (a seat's is its read-only capture, R3). Everything opens in this group. */
export function IdeWelcome(p: {
  terminal: string | null; seat?: boolean; recent: readonly Session[]; waiting: boolean;
  /** A recent session's second line: its project and branch, a seat's rig and role. */
  where(s: Session): string;
  onPick(pick: EmptyPick): void; onOpen(id: string): void;
}): JSX.Element {
  const { t } = useI18n();
  const w = t.ide.welcome;
  const row = (pick: EmptyPick, label: string, keys?: string, primary = false) => (
    <button key={pick} type="button" className={`ide-wl-row${primary ? ' pri' : ''}`} aria-keyshortcuts={keys?.replace(/ /g, '+')} onClick={() => p.onPick(pick)}>
      <span className="ide-wl-label">{label}</span>{keys && <Keys keys={keys} />}
    </button>
  );
  return (
    <div className="ide-welcome">
      <div className="ide-wl-in">
        <div className="ide-wl-mark"><LedgeMark size={64} /><span className="ide-wl-word">{w.brand}</span></div>
        <div className="ide-wl-cols">
          <section aria-label={w.start}>
            <h4>{w.start}</h4>
            {p.terminal !== null && row('terminal', p.seat ? w.capture(p.terminal) : w.terminal(p.terminal), undefined, true)}
            {row('launch', w.newSession, 'N')}
            {row('search', w.search, 'Ctrl K')}
            {row('ledge', w.askLedge, '/')}
            {p.waiting && row('next', w.nextAsk)}
            {row('openrig', w.openrig)}
            {row('atelier', w.atelier)}
            {row('shell', w.shell)}
            {row('settings', w.settings, 'Ctrl ,')}
          </section>
          <section aria-label={w.recent}>
            <h4>{w.recent}</h4>
            {p.recent.length === 0 ? (
              <div className="ide-wl-none">
                <p>{t.side.empty.sessions}</p>
                <button type="button" className="ide-wl-row" onClick={() => p.onPick('launch')}><span className="ide-wl-label">{t.side.empty.newSession}</span></button>
              </div>
            ) : <>
              {p.recent.map(s => (
                <button key={s.id} type="button" className="ide-wl-rec" onClick={() => p.onOpen(s.id)}>
                  <span aria-hidden="true" className={`tab-dot d-${dotOf(s)}`} />
                  <ProviderLogo provider={providerOf(s.tool)} size={14} />
                  <b>{s.name}</b><span className="ide-wl-where">{p.where(s)}</span>
                </button>
              ))}
              <button type="button" className="ide-wl-more" onClick={() => p.onPick('search')}>{w.allSessions}</button>
            </>}
          </section>
        </div>
        <p className="ide-wl-tip">{p.terminal !== null ? w.tip : <>{w.reopenTip} <Keys keys="Ctrl ⇧ T" /></>}</p>
      </div>
    </div>
  );
}
