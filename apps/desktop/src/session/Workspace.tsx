import { useMemo, useState, type JSX } from 'react';
import type { Projects, Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { AgentsRail } from './AgentsRail';
import type { SessionPrefs } from './prefs';
import { memoKey } from './memory';
import { SessionPage, type SessionPageProps } from './SessionPage';
import { TerminalPane } from './TerminalPane';
import { subagentOf } from './exchanges';
import { useThread } from './useThread';

export interface WorkspaceProps extends Omit<SessionPageProps, 'items' | 'helper' | 'onShowKids' | 'onTerminal' | 'split' | 'onSplit'> {
  prefs: SessionPrefs; setPrefs(fn: (p: SessionPrefs) => SessionPrefs): void;
  order: readonly Session[]; projects: Projects | null; projectIdOf(s: Session): string | null;
}

/** The session place (the mockup's conversation-workspace): the project's agents, the page, and the terminal when asked for (O).
 *  It asks for the thread and finds the subagent of the place: live in session.helpers, else its thread row; a subagent
 *  known by neither (its thread not there yet, or gone) still gets its page, named by what is known. It lives as long as the
 *  session place: switching agent changes its props (useThread follows the id) and mounts a new SessionPage only. */
export function Workspace({ client, prefs, setPrefs, order, projects, projectIdOf, ...p }: WorkspaceProps): JSX.Element {
  const items = useThread(client, p.session);
  const unnamed = useI18n().t.session.subagent;
  const id = p.nav.place.kind === 'session' ? p.nav.place.helper : undefined;
  // The same object while nothing it is read from changes: the thread is memoised on it.
  const helper = useMemo(() => (id === undefined ? null : subagentOf(p.session, items, id, unnamed)), [p.session, items, id, unnamed]);
  // « N sous-agents »: the subagents show (if hidden), then their group in the rail scrolls into view and lights up.
  const [flash, setFlash] = useState(0);
  const showKids = () => {
    if (!p.nav.helpers) p.dispatch({ type: 'helpers' });
    setFlash(n => n + 1);
  };
  return (
    <div className={`conversation-workspace${prefs.terminal ? ' with-terminal' : ''}`}>
      <AgentsRail session={p.session} helper={helper} order={order} projects={projects} projectIdOf={projectIdOf} nav={p.nav} dispatch={p.dispatch} flash={flash} />
      {/* Only the page starts over for each agent (its key): the rail and the terminal stay, with the focus and the scroll. */}
      <SessionPage key={memoKey(p.session.id, helper?.id)} {...p} items={items} helper={helper} onShowKids={showKids} onTerminal={() => setPrefs(x => ({ ...x, terminal: !x.terminal }))}
        client={client} split={prefs.split} onSplit={v => setPrefs(x => ({ ...x, split: v }))} />
      {prefs.terminal && <TerminalPane client={client} session={p.session} notify={p.notify} />}
    </div>
  );
}
