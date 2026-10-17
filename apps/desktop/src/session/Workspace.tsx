import type { JSX } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Helper } from '@ledge/protocol';
import { SessionPage, type SessionPageProps } from './SessionPage';
import { helperOf } from './thread';
import { useThread } from './useThread';

/** The session place (the mockup's conversation-workspace): the agents' rail (task 8), the page, the terminal (task 8).
 *  It asks for the thread and finds the subagent of the place: live in session.helpers, else its thread row; a subagent
 *  known by neither (its thread not there yet, or gone) still gets its page, named by what is known. */
export function Workspace({ client, ...p }: Omit<SessionPageProps, 'items' | 'helper'> & { client: DaemonClient }): JSX.Element {
  const items = useThread(client, p.session);
  const id = p.nav.place.kind === 'session' ? p.nav.place.helper : undefined;
  const helper: Helper | null = id === undefined ? null : helperOf(p.session, items, id) ?? { id, kind: 'subagent', task: '', state: 'exited' };
  return (
    <div className="conversation-workspace">
      <SessionPage {...p} items={items} helper={helper} />
    </div>
  );
}
