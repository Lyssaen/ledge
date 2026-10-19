import { useMemo, type JSX } from 'react';
import { useI18n } from '../i18n/lang';
import type { SessionPrefs } from './prefs';
import { memoKey } from './memory';
import { SessionPage, type SessionPageProps } from './SessionPage';
import { TerminalPane } from './TerminalPane';
import { subagentOf } from './exchanges';
import { useThread } from './useThread';

export interface WorkspaceProps extends Omit<SessionPageProps, 'items' | 'helper' | 'onShowKids' | 'onTerminal' | 'split' | 'onSplit'> {
  prefs: SessionPrefs; setPrefs(fn: (p: SessionPrefs) => SessionPrefs): void;
  /** « N sous-agents »: the sidebar tree unfolds this session and scrolls to it. */
  onRevealCurrent(): void;
}

/** The session place (the mockup's conversation-workspace): the page, and the terminal when asked for (O). The project's
 *  agents and their subagents are the sidebar tree's.
 *  It asks for the thread and finds the subagent of the place: live in session.helpers, else its thread row; a subagent
 *  known by neither (its thread not there yet, or gone) still gets its page, named by what is known. It lives as long as the
 *  session place: switching agent changes its props (useThread follows the id) and mounts a new SessionPage only. */
export function Workspace({ client, prefs, setPrefs, onRevealCurrent, ...p }: WorkspaceProps): JSX.Element {
  const items = useThread(client, p.session);
  const unnamed = useI18n().t.session.subagent;
  const id = p.nav.place.kind === 'session' ? p.nav.place.helper : undefined;
  // The same object while nothing it is read from changes: the thread is memoised on it.
  const helper = useMemo(() => (id === undefined ? null : subagentOf(p.session, items, id, unnamed)), [p.session, items, id, unnamed]);
  // « N sous-agents »: the subagents show (if hidden) and the sidebar tree unfolds this session.
  const showKids = () => {
    if (!p.nav.helpers) p.dispatch({ type: 'helpers' });
    onRevealCurrent();
  };
  return (
    <div className={`conversation-workspace${prefs.terminal ? ' with-terminal' : ''}`}>
      {/* Only the page starts over for each agent (its key): the terminal stays. */}
      <SessionPage key={memoKey(p.session.id, helper?.id)} {...p} items={items} helper={helper} onShowKids={showKids} onTerminal={() => setPrefs(x => ({ ...x, terminal: !x.terminal }))}
        client={client} split={prefs.split} onSplit={v => setPrefs(x => ({ ...x, split: v }))} />
      {prefs.terminal && <TerminalPane client={client} session={p.session} notify={p.notify} />}
    </div>
  );
}
