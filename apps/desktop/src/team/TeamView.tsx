import type { Session } from '@ledge/protocol';
import { groupSessions } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import { SessionCard } from './SessionCard';
import { useTheme } from '../shell/theme';

export function TeamView({ sessions, selected, onSelect, attentionOnly }: { sessions: Session[]; selected: string | null; onSelect: (id: string) => void; attentionOnly: boolean }) {
  const { t } = useI18n(); const theme = useTheme();
  if (sessions.length === 0 && !attentionOnly) return <section className="empty"><h2>{t.empty.title}</h2><p>{t.empty.text}</p></section>;
  return (
    <section className="central">
      <div className="toolbar">{attentionOnly ? t.team.attention : t.team.all(sessions.length)}</div>
      {groupSessions(sessions).map(g => (
        <div key={g.key}>
          <h3 className="section-label">{g.label}</h3>
          <div className="session-grid">{g.sessions.map(s => <SessionCard key={s.id} session={s} theme={theme} selected={s.id === selected} onSelect={onSelect} />)}</div>
        </div>
      ))}
    </section>
  );
}
