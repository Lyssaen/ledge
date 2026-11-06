import type { JSX } from 'react';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { dotOf } from '../nav/agents';
import type { Tab } from '../workspace/model';
import { providerOf, tabView } from '../workspace/sessionTab';
import { ProviderLogo } from './ProviderLogo';

/** What a session or seat tab says (mockup `tabLabel()`): logo, name, `>_` in the terminal view, the rig of a seat, the state
 *  dot. The extras are aria-hidden so the tab's accessible name stays the title alone. A session not known keeps its title. */
export function SessionTabLabel({ session, tab, title }: { session: Session | undefined; tab: Tab; title: string }): JSX.Element {
  const { t } = useI18n();
  if (!session) return <span className="tab-name">{title}</span>;
  const provider = providerOf(session.tool);
  return (
    <>
      {provider && <span aria-hidden="true" className="tab-logo"><ProviderLogo provider={provider} /></span>}
      <span className="tab-name">{title}</span>
      {tabView(tab, session) === 'terminal' && <span aria-hidden="true" className="tab-term" title={t.ide.tabTerminalView}>&gt;_</span>}
      {session.rig && <span aria-hidden="true" className="tab-rig">{session.rig.name}</span>}
      <span aria-hidden="true" className={`tab-dot d-${dotOf(session)}`} />
    </>
  );
}

/** A « Modifications » tab (mockup `tabLabel()`, type diff): its session's provider logo at 12 px, aria-hidden, then its title. */
export function ChangesTabLabel({ session, title }: { session: Session | undefined; title: string }): JSX.Element {
  const provider = session ? providerOf(session.tool) : null;
  return (
    <>
      {provider && <span aria-hidden="true" className="tab-logo"><ProviderLogo provider={provider} size={12} /></span>}
      <span className="tab-name">{title}</span>
    </>
  );
}
