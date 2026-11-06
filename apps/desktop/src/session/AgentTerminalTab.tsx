import { useContext, type JSX } from 'react';
import { useMachines, type DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { ptyBackend } from '../term/backend';
import { agentMode, type AgentMode } from '../term/mode';
import { TermStoreContext } from '../term/useTerms';
import { AgentView, useAgent } from './AgentView';
import { useAgentScreen } from './useAgentScreen';

export interface AgentTerminalTabProps {
  client: DaemonClient; session: Session; notify(text: string): void;
  /** A seat's capture (R3): the screen shows, and refuses typing. */
  readOnly: boolean;
  /** « Ouvrir la session »: a subagent-less page has no parent to go to, so this brings the session's own tab forward. */
  onOpenSession(): void;
}

/** An IDE terminal tab of an agent (mockup content() `term`): a 26 px row with the terminal's kind, then the agent's screen,
 *  attached while the tab shows. The screen is the session's one (R2): another tab holding it says so and can take it. */
export function AgentTerminalTab({ client, session, notify, readOnly, onOpenSession }: AgentTerminalTabProps): JSX.Element {
  const { t } = useI18n();
  const store = useContext(TermStoreContext);
  const agent = useAgent(session, null, readOnly);
  // The way to attach is the session page's: a pseudo-terminal, or a daemon that streams the pane.
  const machines = useMachines(client);
  const hasBackend = ptyBackend() !== null || machines.find(m => m.id === (session.machineId ?? 'local'))?.daemon?.terminalStream === true;
  const base = agentMode(session, null, hasBackend);
  const mode: AgentMode = readOnly && base.kind === 'live' ? { kind: 'parent', parentId: session.id } : base;
  useAgentScreen(session.id, mode, store !== null);
  return (
    <div className="ide-term">
      <div className="ide-term-kind"><span className="chip-k">{readOnly ? t.ide.termReadOnly : t.ide.termAttached}</span></div>
      <AgentView client={client} session={session} helper={null} agent={agent} notify={notify} onGoParent={onOpenSession} onOpenShell={onOpenSession} />
    </div>
  );
}
