import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createTokenSource, useTokenMissing, type TokenRead } from '../src/token';

const T = 'a'.repeat(64);
/** A `read` answering each call with the next value of `answers` (the last one repeated). */
function reader(...answers: TokenRead[]) {
  let n = 0;
  return vi.fn(async (): Promise<TokenRead> => answers[Math.min(n++, answers.length - 1)]!);
}

describe('token source', () => {
  it('caches the first token', async () => {
    const read = reader({ kind: 'token', token: T });
    const source = createTokenSource(read);
    await expect(source.get(false)).resolves.toEqual({ kind: 'token', token: T });
    await expect(source.get(false)).resolves.toEqual({ kind: 'token', token: T });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('shares a read in flight', async () => {
    const read = reader({ kind: 'token', token: T });
    const source = createTokenSource(read);
    await Promise.all([source.get(false), source.get(false), source.get(true)]);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('fresh re-reads', async () => {
    const read = reader({ kind: 'token', token: T }, { kind: 'token', token: 'b'.repeat(64) });
    const source = createTokenSource(read);
    await source.get(false);
    await expect(source.get(true)).resolves.toEqual({ kind: 'token', token: 'b'.repeat(64) });
    await expect(source.get(false)).resolves.toEqual({ kind: 'token', token: 'b'.repeat(64) });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('absent sets missing and notifies', async () => {
    const source = createTokenSource(reader({ kind: 'absent' }, { kind: 'token', token: T }));
    const seen: boolean[] = []; source.onMissing(m => seen.push(m));
    expect(source.missing()).toBe(false);
    await expect(source.get(false)).resolves.toEqual({ kind: 'absent' });
    expect(source.missing()).toBe(true);
    expect(seen).toEqual([true]);
    await source.get(true);
    expect(source.missing()).toBe(false);
    expect(seen).toEqual([true, false]);
  });
  it('forgets the cached token when the file is gone', async () => {
    const read = reader({ kind: 'token', token: T }, { kind: 'absent' }, { kind: 'token', token: T });
    const source = createTokenSource(read);
    await source.get(false); await source.get(true);
    await expect(source.get(false)).resolves.toEqual({ kind: 'token', token: T });
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('unavailable is not missing', async () => {
    const source = createTokenSource(reader({ kind: 'absent' }, { kind: 'unavailable' }));
    await source.get(false); expect(source.missing()).toBe(true);
    await expect(source.get(true)).resolves.toEqual({ kind: 'unavailable' });
    expect(source.missing()).toBe(false);
  });
  it('a throwing read is unavailable', async () => {
    const source = createTokenSource(async () => { throw new Error('wsl.exe timed out'); });
    await expect(source.get(false)).resolves.toEqual({ kind: 'unavailable' });
    expect(source.missing()).toBe(false);
  });
  it('an unsubscribed listener hears nothing', async () => {
    const source = createTokenSource(reader({ kind: 'absent' }));
    const fn = vi.fn(); source.onMissing(fn)();
    await source.get(false);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('useTokenMissing', () => {
  it('is false without a source', () => {
    expect(renderHook(() => useTokenMissing(undefined)).result.current).toBe(false);
  });
  it('follows the source', async () => {
    const source = createTokenSource(reader({ kind: 'absent' }, { kind: 'token', token: T }));
    const { result } = renderHook(() => useTokenMissing(source));
    expect(result.current).toBe(false);
    await act(async () => { await source.get(false); });
    expect(result.current).toBe(true);
    await act(async () => { await source.get(true); });
    expect(result.current).toBe(false);
  });
});
