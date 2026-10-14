import type { Session } from '@ledge/protocol';
import { Bot, botState, poseFor } from '@ledge/ui';
import { useI18n } from '../i18n/lang';

export function SessionCard({ session, theme, selected, onSelect }: { session: Session; theme: 'dark' | 'light'; selected: boolean; onSelect: (id: string) => void }) {
  const { t } = useI18n(); const state = botState(session);
  return (
    <button type="button" className="session-card" data-session={session.id} data-offline={session.offline ? 'true' : undefined} aria-pressed={selected} aria-label={`${session.name} · ${t.states[session.state]}`} onClick={() => onSelect(session.id)}>
      <Bot tool={session.tool} state={state} pose={poseFor(session.id, state)} size={48} theme={theme} seed={session.id} readOnly={!!session.offline} />
      <span className="session-name">{session.name}</span>
      <span className="session-meta">{session.project}{session.machineName ? ` · ${session.machineName}` : ''}</span>
      <span className="session-state" data-state={session.state}>{t.states[session.state]}</span>
    </button>
  );
}
