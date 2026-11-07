import type { JSX } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { dotOf } from '../nav/agents';
import { keyOf, type Tab } from '../workspace/model';
import { terminalViewTitle, useAgent, useAgentStatus, useHasBackend } from '../session/AgentView';
import { providerOf, tabView } from '../workspace/sessionTab';
import { ProviderLogo } from './ProviderLogo';

/** What a session or seat tab says (mockup `tabLabel()`): logo, name, `>_` in the terminal view, the rig of a seat, the state
 *  dot. The extras are aria-hidden so the tab's accessible name stays the title alone. A session not known keeps its title.
 *  With `client`, the `>_`'s title also says what the agent screen's footer said outside the IDE: its state and its tmux pane;
 *  `helper`, the subagent whose page the tab shows (its parent's screen, read only). */
export function SessionTabLabel({ session, tab, title, client, helper = null }: { session: Session | undefined; tab: Tab; title: string; client?: DaemonClient; helper?: { id: string } | null }): JSX.Element {
  const { t } = useI18n();
  if (!session) return <span className="tab-name">{title}</span>;
  return (
    <>
      <span aria-hidden="true" className="tab-logo"><ProviderLogo provider={providerOf(session.tool)} /></span>
      <span className="tab-name">{title}</span>
      {tabView(tab, session) === 'terminal' && (client
        ? <TermMark client={client} session={session} helper={helper} viewer={keyOf(tab)} />
        : <span aria-hidden="true" className="tab-term" title={t.ide.tabTerminalView}>&gt;_</span>)}
      {session.rig && <span aria-hidden="true" className="tab-rig">{session.rig.name}</span>}
      <span aria-hidden="true" className={`tab-dot d-${dotOf(session)}`} />
    </>
  );
}

/** The `>_` of a session tab on Terminal, titled « Vue terminal · attaché · tmux · ledge-otto » as the tab's screen stands. */
function TermMark({ client, session, helper, viewer }: { client: DaemonClient; session: Session; helper: { id: string } | null; viewer: string }): JSX.Element {
  const { t } = useI18n();
  const agent = useAgent(session, helper, false, useHasBackend(client, session));
  const status = useAgentStatus(session, agent, viewer);
  return <span aria-hidden="true" className="tab-term" title={terminalViewTitle(t.ide.tabTerminalView, status)}>&gt;_</span>;
}

/** A « Modifications » tab (mockup `tabLabel()`, type diff), or an agent's terminal tab (type term, title `>_ name · tmux`): its session's provider logo at 12 px, aria-hidden, then its title. */
export function ChangesTabLabel({ session, title }: { session: Session | undefined; title: string }): JSX.Element {
  return (
    <>
      {session && <span aria-hidden="true" className="tab-logo"><ProviderLogo provider={providerOf(session.tool)} size={12} /></span>}
      <span className="tab-name">{title}</span>
    </>
  );
}
