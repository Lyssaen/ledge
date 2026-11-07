import { useContext, type JSX } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { TermStoreContext } from '../term/useTerms';
import { AgentView, useAgent, useAgentStatus, useHasBackend } from './AgentView';
import { useTabPlace } from '../workspace/tabPlace';
import { useAgentScreen } from './useAgentScreen';

export interface AgentTerminalTabProps {
  client: DaemonClient; session: Session; notify(text: string): void;
  /** A seat's capture (R3): the screen shows, and refuses typing. */
  readOnly: boolean;
  /** « Ouvrir la session »: a subagent-less page has no parent to go to, so this brings the session's own tab forward. */
  onOpenSession(): void;
  /** In a bottom-panel tile: the tile's bar already says the kind, so no kind chip; the state shows only while no banner of
   *  AgentView says it (connecting, a preview, read only…: reconnecting, offline and elsewhere have their banner). */
  bare?: boolean;
}

/** An IDE terminal tab of an agent (mockup content() `term`): a 26 px row with the terminal's kind and, on its right, what the
 *  agent screen's footer said outside the IDE (its state, its tmux pane), then the agent's screen, attached while the tab shows. The screen is the session's one (R2): another tab holding it says so and can take it. */
export function AgentTerminalTab({ client, session, notify, readOnly, onOpenSession, bare = false }: AgentTerminalTabProps): JSX.Element {
  const { t } = useI18n();
  const store = useContext(TermStoreContext);
  // The one place the capture's read-only mode is made: useAgent (live becomes the store's read-only mode).
  const agent = useAgent(session, null, readOnly, useHasBackend(client, session));
  useAgentScreen(session.id, agent.mode, store !== null);
  const kind = readOnly ? t.ide.termReadOnly : t.ide.termAttached;
  const { state, where } = useAgentStatus(session, agent, useTabPlace()?.key ?? 'page');
  const view = <AgentView client={client} session={session} helper={null} agent={agent} notify={notify} onGoParent={onOpenSession} onOpenShell={undefined} />;
  if (bare) {
    const tt = t.session.terminal;
    const said = state === null || state === tt.reconnecting || state === tt.offline || state.toLocaleLowerCase() === kind.toLocaleLowerCase();
    return <div className="ide-term">{!said && <div className="ide-term-kind"><span className="ide-term-state">{state}</span></div>}{view}</div>;
  }
  return (
    <div className="ide-term">
      <div className="ide-term-kind">
        <span className="chip-k">{kind}</span>
        {/* The state only when the chip does not already say it (connecting, reconnecting, elsewhere, offline…). */}
        {state && state.toLocaleLowerCase() !== kind.toLocaleLowerCase() && <span className="ide-term-state">{state}</span>}
        {where && <span className="ide-term-where mono">{where}</span>}
      </div>
      {view}
    </div>
  );
}
