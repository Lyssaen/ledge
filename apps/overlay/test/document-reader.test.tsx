import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDocumentReader } from '../src/documents/useDocumentReader';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import type { DaemonClient } from '@ledge/client';

function client() {
  const sent: ClientMessage[] = []; const listeners = new Set<(message: ServerMessage) => void>();
  const c: DaemonClient = {
    send: m => sent.push(m), connect: () => {}, close: () => {}, status: () => 'open',
    onMessage: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, onStatus: () => () => {}
  };
  const emit = (m: ServerMessage) => { for (const fn of listeners) fn(m); };
  return { c, sent, emit };
}
const content = (requestId: string, path: string, text: string): ServerMessage => ({ type: 'document.content', requestId, path, text, bytes: text.length, modifiedAt: '2026-10-11T00:00:00.000Z' });
afterEach(() => vi.useRealTimers());

describe('useDocumentReader', () => {
  it('shows the latest request when replies arrive out of order and ignores replies after close', () => {
    const d = client(); const onExit = vi.fn(); const { result } = renderHook(() => useDocumentReader({ client: d.c, onExit }));
    act(() => { result.current.open({ path: 'a.md' }, { kind: 'session', sessionId: 's1' }); });
    const a = d.sent.at(-1)!; expect(a).toMatchObject({ type: 'document.read', path: 'a.md', sessionId: 's1' });
    act(() => { result.current.open({ path: 'b.md' }, { kind: 'session', sessionId: 's1' }); });
    const b = d.sent.at(-1)!;
    act(() => { d.emit(content((b as any).requestId, '/w/b.md', '# B')); d.emit(content((a as any).requestId, '/w/a.md', '# A')); });
    expect(result.current.state.current?.document?.text).toBe('# B');
    act(() => { result.current.close(); d.emit(content((b as any).requestId, '/w/b.md', '# Late')); });
    expect(result.current.state.current).toBeNull();
  });
  it('retries with a new id after a ten-second timeout', () => {
    vi.useFakeTimers(); const d = client(); const { result } = renderHook(() => useDocumentReader({ client: d.c, onExit: () => {} }));
    act(() => result.current.open({ path: 'a.md' }, { kind: 'chat' }));
    const first = d.sent.at(-1)!;
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.state.current?.error).toBe('timeout');
    act(() => result.current.reload());
    expect((d.sent.at(-1) as any).requestId).not.toBe((first as any).requestId);
    act(() => d.emit(content((first as any).requestId, '/w/a.md', 'stale')));
    expect(result.current.state.current?.document).toBeUndefined();
  });
  it('returns from a linked document to the previous reading position', () => {
    const d = client(); const onExit = vi.fn(); const { result } = renderHook(() => useDocumentReader({ client: d.c, onExit }));
    act(() => result.current.open({ path: '/w/a.md' }, { kind: 'session', sessionId: 's1' }));
    act(() => d.emit(content((d.sent.at(-1) as any).requestId, '/w/a.md', '# A')));
    act(() => result.current.setReading({ scroll: 320, raw: true }));
    act(() => result.current.follow({ path: 'b.md' }));
    expect(d.sent.at(-1)).toMatchObject({ type: 'document.read', path: 'b.md', basePath: '/w/a.md' });
    act(() => result.current.back());
    expect(result.current.state.current).toMatchObject({ document: { text: '# A' }, scroll: 320, raw: true });
    act(() => result.current.back());
    expect(onExit).toHaveBeenCalledWith({ kind: 'session', sessionId: 's1' });
  });
});
