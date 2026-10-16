import { useI18n } from '../i18n/lang';
import { ChatTrigger } from '../chat/ChatTrigger';
import type { ViewAction, ViewState } from '../state/view';

const GLYPHS = { team: '▦', room: '◯' } as const;

/** The mockup's view heading (app.js:102): the view's own title and subtitle, the toggle, the filter, Talk to Ledge, New session (disabled while read-only or while a chat card waits) and ⚙ (with a pip when an app update is ready). */
export function Heading({ state, dispatch, attentionCount, chat, onNewSession, onSettings, updateReady = false }: { state: ViewState; dispatch: (a: ViewAction) => void; attentionCount: number; chat?: { open: boolean; onOpen: () => void }; onNewSession?: () => void; onSettings?: () => void; updateReady?: boolean }) {
  const { t } = useI18n();
  const heading = t.heading[state.view];
  return (
    <header className="view-heading">
      <div>
        <h2>{heading.title}</h2>
        <p>{heading.subtitle}</p>
      </div>
      <div className="view-toggle" role="group" aria-label={t.views.label}>
        {(['team', 'room'] as const).map(v => (
          <button key={v} type="button" data-view={v} aria-pressed={state.view === v} onClick={() => dispatch({ type: 'view', view: v })}><span aria-hidden="true">{GLYPHS[v]}</span> {t.views[v]}</button>
        ))}
      </div>
      <button type="button" id="attention" className="attention-filter" aria-pressed={state.attentionOnly} onClick={() => dispatch({ type: 'attention', on: !state.attentionOnly })}>
        <span aria-hidden="true">◉</span> {t.attention.filter} <span className="attention-count">{attentionCount}</span>
      </button>
      {chat && <ChatTrigger open={chat.open} onOpen={chat.onOpen} place="heading" />}
      <button type="button" className="primary" data-open-launch="heading" disabled={!onNewSession} onClick={onNewSession}><span className="plus" aria-hidden="true">+</span>{t.newSession}</button>
      {onSettings && (() => {
        const label = updateReady ? t.settingsShortcut.update : t.settingsShortcut.label;
        return (
          <button type="button" className="settings-shortcut" data-open-settings aria-label={label} title={label} onClick={onSettings}>
            <span aria-hidden="true">⚙</span>{updateReady && <span className="update-pip" aria-hidden="true" />}
          </button>
        );
      })()}
    </header>
  );
}
