import type { Session } from '@ledge/protocol';
import type { Tab } from '../workspace/model';
import { tabView } from '../workspace/sessionTab';

/** The session whose agent screen Ledge shows live (its page on the Terminal view, the window focused), or null: a subagent's
 *  page shows its parent's screen read only, not its own. */
export function watchedSession(s: { focused: boolean; agentView: boolean; placeId: string | null; helper: string | undefined }): string | null {
  return s.focused && s.agentView && s.placeId !== null && s.helper === undefined ? s.placeId : null;
}

/** The IDE's watched session: the front tab of the focused group, on its own view (never the stored preference). A tab that is
 *  not a session or a seat silences nothing. */
export function watchedTab(s: { focused: boolean; front: Tab | undefined; session: Session | undefined; helper: string | undefined }): string | null {
  const { front } = s;
  if (!front || (front.kind !== 'session' && front.kind !== 'seat') || !s.session) return null;
  return watchedSession({ focused: s.focused, agentView: tabView(front, s.session) === 'terminal', placeId: front.ref, helper: s.helper });
}
