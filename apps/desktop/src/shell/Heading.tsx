import { useI18n } from '../i18n/lang';
import type { ViewAction, ViewState } from '../state/view';

export function Heading({ state, dispatch, attentionCount }: { state: ViewState; dispatch: (a: ViewAction) => void; attentionCount: number }) {
  const { t } = useI18n();
  return (
    <header className="view-heading">
      <div>
        <h2>{t.app.title}</h2>
        <p>{attentionCount > 0 ? t.room.pending(attentionCount) : t.room.allGood}</p>
      </div>
      <div className="view-toggle" role="group">
        {(['team', 'room'] as const).map(v => (
          <button key={v} type="button" data-view={v} aria-pressed={state.view === v} onClick={() => dispatch({ type: 'view', view: v })}>{t.views[v]}</button>
        ))}
      </div>
      <button type="button" id="attention" aria-pressed={state.attentionOnly} onClick={() => dispatch({ type: 'attention', on: !state.attentionOnly })}>{t.attention.filter} · {attentionCount}</button>
      <button type="button" className="primary" disabled>{t.newSession}</button>
    </header>
  );
}
