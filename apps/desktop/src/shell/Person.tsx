import type { Session } from '@ledge/protocol';
import { Bot, botState, poseFor } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { useTheme } from './theme';

/** The agent's product name under its own name (mockup app.js `names`). */
export const TOOL_NAMES: Record<Session['tool'], string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' };

/** The mascot in its disc (mockup `.avatar`), frozen when its machine is disconnected. */
export function Avatar({ session, size }: { session: Session; size: number }) {
  const theme = useTheme(); const state = botState(session);
  return <span className="avatar"><Bot tool={session.tool} state={state} pose={poseFor(session.id, state)} size={size} theme={theme} seed={session.id} readOnly={!!session.offline} /></span>;
}

/** The state pill, coloured by its class (mockup `badge`): the session's state, or « Déconnectée » for a frozen one. */
export function StateBadge({ session }: { session: Session }) {
  const { t } = useI18n();
  return <span className={`state ${session.offline ? 'offline' : session.state}`} data-state={session.state}>{session.offline ? t.offline.badge : t.states[session.state]}</span>;
}

/** What a card or a seat reads out: its state, or that its machine is disconnected. */
export function useStateLabel(): (s: Session) => string {
  const { t } = useI18n();
  return s => (s.offline ? t.offline.machine : t.states[s.state]);
}
