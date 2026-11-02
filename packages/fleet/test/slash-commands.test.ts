import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import type { DaemonClient } from '../src/client';
import { forgetSlashCommands, SLASH_KEEP_MS, useSlashCommands } from '../src/slashCommands';

function fakeClient() {
  const sent: ClientMessage[] = [];
  const listeners = new Set<(m: ServerMessage) => void>();
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (fn: (m: ServerMessage) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; } } as unknown as DaemonClient;
  const emit = (m: ServerMessage) => act(() => { listeners.forEach(fn => fn(m)); });
  return { client, sent, emit };
}
const asked = (sent: ClientMessage[]) => sent.filter((m): m is Extract<ClientMessage, { type: 'session.commands' }> => m.type === 'session.commands');

afterEach(() => forgetSlashCommands());

describe('useSlashCommands', () => {
  it('asks once « / » is typed, shows loading, then the listing; asks again only after SLASH_KEEP_MS', () => {
    const { client, sent, emit } = fakeClient();
    let t = 0;
    const { result, rerender } = renderHook(({ wanted }) => useSlashCommands(client, 'local:otto', wanted, () => t), { initialProps: { wanted: false } });
    expect(result.current.status).toBe('idle'); expect(sent).toEqual([]);
    rerender({ wanted: true });
    expect(result.current.status).toBe('loading');
    const [ask] = asked(sent); expect(ask).toMatchObject({ id: 'local:otto' });
    emit({ type: 'session.commands.listing', requestId: 'other', id: 'local:otto', commands: [] });
    expect(result.current.status).toBe('loading');
    emit({ type: 'session.commands.listing', requestId: ask!.requestId, id: 'local:otto', tool: 'claude', commands: [{ name: 'compact', source: 'builtin' }] });
    expect(result.current).toEqual({ status: 'ready', tool: 'claude', commands: [{ name: 'compact', source: 'builtin' }] });
    rerender({ wanted: false }); rerender({ wanted: true });
    expect(asked(sent)).toHaveLength(1); expect(result.current.status).toBe('ready');
    t = SLASH_KEEP_MS + 1; rerender({ wanted: false }); rerender({ wanted: true });
    expect(asked(sent)).toHaveLength(2);
  });
  it('shows a failure, and asks again at the next « / »', () => {
    const { client, sent, emit } = fakeClient();
    const { result, rerender } = renderHook(({ wanted }) => useSlashCommands(client, 'local:otto', wanted), { initialProps: { wanted: true } });
    emit({ type: 'session.commands.listing', requestId: asked(sent)[0]!.requestId, id: 'local:otto', commands: [], error: 'outdated' });
    expect(result.current).toEqual({ status: 'ready', commands: [], error: 'outdated' });
    rerender({ wanted: false }); rerender({ wanted: true });
    expect(asked(sent)).toHaveLength(2);
  });
});
