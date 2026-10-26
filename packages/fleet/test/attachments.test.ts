import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import type { DaemonClient } from '../src/client';
import { AttachmentFailure, getImage, putImage, useImageUrl } from '../src/attachments';

const ref = { id: 'a'.repeat(64), mime: 'image/png' as const, width: 1, height: 1, bytes: 4, preview: true };
function fake() {
  const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; } } as unknown as DaemonClient;
  return { client, sent, emit: (m: ServerMessage) => listeners.forEach(f => f(m)), listeners };
}
const requestOf = (m: ClientMessage | undefined) => (m as { requestId: string }).requestId;

describe('putImage', () => {
  it('resolves with the stored ref of the matching request', async () => {
    const { client, sent, emit, listeners } = fake();
    const p = putImage(client, { mime: 'image/png', data: 'AAAA' }, { id: 'server:s1' });
    expect(sent[0]).toMatchObject({ type: 'attachment.put', id: 'server:s1', image: { data: 'AAAA' } });
    emit({ type: 'attachment.stored', requestId: 'other', ref: { ...ref, bytes: 9 } });
    emit({ type: 'attachment.stored', requestId: requestOf(sent[0]), ref });
    await expect(p).resolves.toEqual(ref);
    expect(listeners.size).toBe(0);
  });
  it('rejects with the reason of the matching error', async () => {
    const { client, sent, emit } = fake();
    const p = putImage(client, { mime: 'image/png', data: 'AAAA' });
    emit({ type: 'attachment.error', requestId: requestOf(sent[0]), reason: 'too_large' });
    await expect(p).rejects.toMatchObject({ name: 'AttachmentFailure', reason: 'too_large' });
    await expect(p).rejects.toBeInstanceOf(AttachmentFailure);
  });
  it('rejects with « timeout » when nothing answers', async () => {
    vi.useFakeTimers();
    try {
      const { client, listeners } = fake();
      const p = putImage(client, { mime: 'image/png', data: 'AAAA' }, undefined, 50);
      const assertion = expect(p).rejects.toMatchObject({ reason: 'timeout' });
      await vi.advanceTimersByTimeAsync(51);
      await assertion;
      expect(listeners.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

describe('getImage', () => {
  it('asks with the route and the preview flag, and resolves the data', async () => {
    const { client, sent, emit } = fake();
    const p = getImage(client, ref.id, { machine: 'server' }, true);
    expect(sent[0]).toMatchObject({ type: 'attachment.get', attachment: ref.id, machine: 'server', preview: true });
    emit({ type: 'attachment.data', requestId: requestOf(sent[0]), attachment: ref.id, mime: 'image/png', data: 'AAAA' });
    await expect(p).resolves.toEqual({ mime: 'image/png', data: 'AAAA' });
  });
  it('rejects with the error reason', async () => {
    const { client, sent, emit } = fake();
    const p = getImage(client, ref.id);
    emit({ type: 'attachment.error', requestId: requestOf(sent[0]), reason: 'not_found' });
    await expect(p).rejects.toMatchObject({ reason: 'not_found' });
  });
});

describe('useImageUrl', () => {
  // jsdom has no object URLs
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`);
  const answer = (f: ReturnType<typeof fake>) => { const m = f.sent.at(-1)!; f.emit({ type: 'attachment.data', requestId: requestOf(m), attachment: ref.id, mime: 'image/png', data: 'AAAA' }); };
  it('gives an object URL once fetched, and shares it through the cache', async () => {
    const f = fake();
    const route = { machine: 'cache-share' };
    const a = renderHook(() => useImageUrl(f.client, ref, route));
    expect(a.result.current).toEqual({ url: null, failed: false });
    act(() => answer(f));
    await waitFor(() => expect(a.result.current.url).toMatch(/^blob:test\//));
    const b = renderHook(() => useImageUrl(f.client, ref, route));
    await waitFor(() => expect(b.result.current.url).toBe(a.result.current.url));
    expect(f.sent).toHaveLength(1);
  });
  it('flags a failure and does not cache it', async () => {
    const f = fake();
    const route = { machine: 'cache-fail' };
    const a = renderHook(() => useImageUrl(f.client, ref, route));
    act(() => f.emit({ type: 'attachment.error', requestId: requestOf(f.sent.at(-1)), reason: 'not_found' }));
    await waitFor(() => expect(a.result.current.failed).toBe(true));
    const b = renderHook(() => useImageUrl(f.client, ref, route));
    await waitFor(() => expect(f.sent).toHaveLength(2));
    act(() => answer(f));
    await waitFor(() => expect(b.result.current.url).not.toBeNull());
  });
  it('is idle without a ref', () => {
    const f = fake();
    const a = renderHook(() => useImageUrl(f.client, undefined));
    expect(a.result.current).toEqual({ url: null, failed: false });
    expect(f.sent).toEqual([]);
  });
});
