import type { Session } from '@ledge/protocol';
import { groupSessions } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import { SessionCard } from './SessionCard';

/** The mockup's team view (app.js `team`): a toolbar, then one labelled grid of cards per project. */
export function TeamView({ sessions, selected, onSelect, attentionOnly }: { sessions: Session[]; selected: string | null; onSelect: (id: string) => void; attentionOnly: boolean }) {
  const { t } = useI18n();
  return (
    <section className="central">
      <div className="toolbar"><span>{attentionOnly ? t.team.attention(sessions.length) : t.team.all(sessions.length)}</span><span className="right">{t.team.byProject}</span></div>
      {sessions.length === 0 && <p className="empty-sessions">{t.empty.none}</p>}
      {groupSessions(sessions).map((g, i) => (
        <div key={g.key}>
          <div className={`section-label${i ? ' second-project' : ''}`}><i className={`project-dot ${i ? 'project-secondary' : 'project-primary'}`} aria-hidden="true" /><b>{g.label}</b><span className="line" />{t.team.participants(g.sessions.length)}</div>
          <div className="session-grid">{g.sessions.map(s => <SessionCard key={s.id} session={s} selected={s.id === selected} onSelect={onSelect} />)}</div>
        </div>
      ))}
    </section>
  );
}
