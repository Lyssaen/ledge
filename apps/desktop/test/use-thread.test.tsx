// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import WebSocket from 'ws';
import type { DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet, useFleet } from '../src/fleet/useFleet';
import { useThread } from '../src/session/useThread';
import { ottoThread } from './helpers';

function Count({ client, session }: { client: DaemonClient; session: Session }) {
  const items = useThread(client, session);
  return <output data-testid="count">{items?.length ?? 'loading'}</output>;
}
function Probe({ client, id }: { client: DaemonClient; id: string }) {
  const s = useFleet(client).sessions.find(x => x.id === id);
  return s ? <Count client={client} session={s} /> : null;
}
const daemons: Awaited<ReturnType<typeof createMockDaemon>>[] = [];
afterEach(async () => { for (const d of daemons.splice(0)) await d.close(); });

describe('useThread', () => {
  it('asks once for the thread, then follows live items', async () => {
    const d = await createMockDaemon(); daemons.push(d);
    d.upsert(fakeSession('otto')); d.thread('otto', ottoThread());
    render(<Probe client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} id="local:otto" />);
    await screen.findByTestId('count');
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent(String(ottoThread().length)));
    d.threadItem('otto', { kind: 'message', id: 'msg-x', at: new Date().toISOString(), turn: 2, text: 'Et voilà.' });
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent(String(ottoThread().length + 1)));
    expect(d.received.filter(m => m.type === 'session.thread')).toEqual([{ type: 'session.thread', id: 'otto' }]);
  });
  it('an offline session asks nothing', async () => {
    const d = await createMockDaemon(); daemons.push(d);
    d.upsert(fakeSession('rio', { offline: true }));
    render(<Probe client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} id="local:rio" />);
    await screen.findByTestId('count');
    await new Promise(r => setTimeout(r, 150));
    expect(screen.getByTestId('count')).toHaveTextContent('loading');
    expect(d.received.filter(m => m.type === 'session.thread')).toEqual([]);
  });
});
