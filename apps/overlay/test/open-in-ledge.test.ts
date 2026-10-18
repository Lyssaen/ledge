import { afterEach, describe, expect, it, vi } from 'vitest';
import { openInLedge, subscribeOpenInLedge, type LedgeTarget, type OpenOutcome } from '../src/desktop/openInLedge';

const native = vi.hoisted(() => ({ invoke: vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => undefined) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
const enterTauri = () => { (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}; };
afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; native.invoke.mockReset(); });

describe('openInLedge', () => {
  it('tells every subscriber, in order, and a removed one hears nothing more', () => {
    const heard: LedgeTarget[] = [];
    const stop = subscribeOpenInLedge(target => heard.push(target));
    const other: LedgeTarget[] = [];
    const stopOther = subscribeOpenInLedge(target => other.push(target));
    openInLedge({ kind: 'session', id: 'otto' });
    openInLedge({ kind: 'settings' });
    stop();
    openInLedge({ kind: 'launch' });
    stopOther();
    expect(heard).toEqual([{ kind: 'session', id: 'otto' }, { kind: 'settings' }]);
    expect(other).toEqual([{ kind: 'session', id: 'otto' }, { kind: 'settings' }, { kind: 'launch' }]);
  });
  it('under Tauri, starts Ledge Desktop on the target as JSON; nothing more is said when it starts', async () => {
    enterTauri();
    const heard: OpenOutcome[] = []; const stop = subscribeOpenInLedge((_, o) => heard.push(o));
    openInLedge({ kind: 'session', id: 'local:otto' });
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith('open_in_ledge', { target: '{"kind":"session","id":"local:otto"}' }));
    await Promise.resolve();
    expect(heard).toEqual(['opening']);
    stop();
  });
  it('says when Ledge Desktop is not installed, or could not start', async () => {
    enterTauri();
    const heard: OpenOutcome[] = []; const stop = subscribeOpenInLedge((_, o) => heard.push(o));
    native.invoke.mockRejectedValueOnce('not installed');
    openInLedge({ kind: 'settings' });
    await vi.waitFor(() => expect(heard).toEqual(['opening', 'missing']));
    native.invoke.mockRejectedValueOnce('open Ledge Desktop: access denied');
    openInLedge({ kind: 'machines' });
    await vi.waitFor(() => expect(heard).toEqual(['opening', 'missing', 'opening', 'failed']));
    stop();
  });
});
