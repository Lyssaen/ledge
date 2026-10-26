// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import WebSocket from 'ws';
import type { DaemonClient } from '@ledge/fleet';
import type { Session, ThreadItem } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet, useFleet } from '../src/fleet/useFleet';
import { useThread, useThreads } from '../src/session/useThread';
import { ottoThread } from './helpers';

function Count({ client, session }: { client: DaemonClient; session: Session }) {
  const items = useThread(client, session);
  return <output data-testid="count">{items?.length ?? 'loading'}</output>;
}
function Probe({ client, id }: { client: DaemonClient; id: string }) {
  const s = useFleet(client).sessions.find(x => x.id === id);
  return s ? <Count client={client} session={s} /> : null;
}
/** useThreads over the sessions named by `ids` (those the fleet lists), each one's count; every render is written to `log`. */
function Many({ client, ids, log }: { client: DaemonClient; ids: readonly string[]; log?: string[] }) {
  const all = useFleet(client).sessions;
  // A new array on every render: useThreads keys its asking on ids and offline flags, not on the array.
  const threads = useThreads(client, ids.flatMap(id => all.filter(s => s.id === id)));
  return <>{ids.map(id => {
    const shown = String(threads.get(id)?.length ?? 'loading');
    log?.push(`${id}=${shown}`);
    return <output key={id} data-testid={id}>{shown}</output>;
  })}</>;
}
const asked = (d: { received: { type: string; id?: string }[] }, id: string) => d.received.filter(m => m.type === 'session.thread' && m.id === id);
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
  it('the same hook given another session (the Workspace outlives the agent shown): asks for its thread, never shows the last one\'s', async () => {
    const d = await createMockDaemon(); daemons.push(d);
    d.upsert(fakeSession('otto')); d.upsert(fakeSession('nova')); d.thread('otto', ottoThread());
    const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
    const view = render(<Probe client={client} id="local:otto" />);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent(String(ottoThread().length)));
    view.rerender(<Probe client={client} id="local:nova" />);
    expect(screen.getByTestId('count')).toHaveTextContent('loading');
    await waitFor(() => expect(d.received.filter(m => m.type === 'session.thread')).toEqual([{ type: 'session.thread', id: 'otto' }, { type: 'session.thread', id: 'nova' }]));
    view.rerender(<Probe client={client} id="local:otto" />);
    expect(screen.getByTestId('count')).toHaveTextContent(String(ottoThread().length));
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

describe('useThreads', () => {
  const nova = (): ThreadItem[] => [{ kind: 'message', id: 'n1', at: new Date().toISOString(), turn: 1, text: 'Je paie.' }];

  it('useThreads asks each thread once and follows live items', async () => {
    const d = await createMockDaemon(); daemons.push(d);
    d.upsert(fakeSession('otto')); d.upsert(fakeSession('nova', { name: 'Nova' }));
    d.thread('otto', ottoThread()); d.thread('nova', nova());
    render(<Many client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} ids={['local:otto', 'local:nova']} />);
    await waitFor(() => expect(screen.getByTestId('local:otto')).toHaveTextContent(String(ottoThread().length)));
    await waitFor(() => expect(screen.getByTestId('local:nova')).toHaveTextContent('1'));
    d.threadItem('nova', { kind: 'message', id: 'n2', at: new Date().toISOString(), turn: 1, text: 'Payé.' });
    await waitFor(() => expect(screen.getByTestId('local:nova')).toHaveTextContent('2'));
    expect(screen.getByTestId('local:otto')).toHaveTextContent(String(ottoThread().length));
    expect(asked(d, 'otto')).toEqual([{ type: 'session.thread', id: 'otto' }]);
    expect(asked(d, 'nova')).toEqual([{ type: 'session.thread', id: 'nova' }]);
  });

  it('after a reconnect, asks again and keeps the last items meanwhile', async () => {
    const d = await createMockDaemon(); daemons.push(d);
    d.upsert(fakeSession('otto')); d.upsert(fakeSession('nova', { name: 'Nova' }));
    d.thread('otto', ottoThread()); d.thread('nova', nova());
    const log: string[] = [];
    render(<Many client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} ids={['local:otto', 'local:nova']} log={log} />);
    await waitFor(() => expect(screen.getByTestId('local:nova')).toHaveTextContent('1'));
    const from = log.length;
    await d.dropClients();
    await waitFor(() => expect(asked(d, 'nova')).toHaveLength(2), { timeout: 5000 });
    await waitFor(() => expect(asked(d, 'otto')).toHaveLength(2), { timeout: 5000 });
    expect(screen.getByTestId('local:nova')).toHaveTextContent('1');
    expect(log.slice(from).filter(x => x === 'local:nova=loading')).toEqual([]);
  });

  it('an offline session is never asked; one leaving the list is not asked again', async () => {
    const d = await createMockDaemon(); daemons.push(d);
    d.upsert(fakeSession('otto')); d.upsert(fakeSession('nova', { name: 'Nova' })); d.upsert(fakeSession('rio', { name: 'Rio', offline: true }));
    d.thread('otto', ottoThread()); d.thread('nova', nova());
    const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
    const view = render(<Many client={client} ids={['local:otto', 'local:nova', 'local:rio']} />);
    await waitFor(() => expect(screen.getByTestId('local:nova')).toHaveTextContent('1'));
    expect(screen.getByTestId('local:rio')).toHaveTextContent('loading');
    view.rerender(<Many client={client} ids={['local:otto']} />);
    await d.dropClients();
    await waitFor(() => expect(asked(d, 'otto')).toHaveLength(2), { timeout: 5000 });
    await new Promise(r => setTimeout(r, 150));
    expect(asked(d, 'nova')).toHaveLength(1);
    expect(asked(d, 'rio')).toEqual([]);
    // Its kept items went with it: back in the list after the snapshot dropped its thread, it is asked afresh, never shown stale.
    view.rerender(<Many client={client} ids={['local:otto', 'local:nova']} />);
    expect(screen.getByTestId('local:nova')).toHaveTextContent('loading');
    await waitFor(() => expect(asked(d, 'nova')).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId('local:nova')).toHaveTextContent('1'));
  });
});
