// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPinnedSw } from '../../src/sw/register';
import type { BuildAnswer } from '../../src/sw/types';

const V1 = { version: '0.11.0', fingerprint: '1'.repeat(64) };
const V2 = { version: '0.12.0', fingerprint: '2'.repeat(64) };

/** A worker answering { type: 'build' } with `answer`, and keeping what else it is sent. */
function worker(answer: BuildAnswer) {
  const w = {
    answer,
    sent: [] as unknown[],
    postMessage(m: { type: string }, ports?: MessagePort[]) {
      if (m.type === 'build') ports![0]!.postMessage(w.answer);
      else w.sent.push(m);
    },
    addEventListener() {}
  };
  return w;
}

type Worker = ReturnType<typeof worker>;

/** The page's service worker container with `active` and `waiting` registered, and its reload. */
async function page(active: Worker | null, waiting: Worker | null = null) {
  const on: Record<string, (e?: unknown) => void> = {};
  const reg = { active, waiting, installing: null, addEventListener() {}, update: vi.fn(async () => {}) };
  const container = { register: vi.fn(async () => reg), addEventListener: (type: string, fn: (e?: unknown) => void) => { on[type] = fn; } };
  const reload = vi.fn();
  const watch = await registerPinnedSw(container as unknown as ServiceWorkerContainer, reload);
  const changed = vi.fn();
  watch.subscribe(changed);
  return { reg, on, reload, watch, changed };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('registerPinnedSw', () => {
  it('current is the build the active worker serves; waiting, the waiting worker\'s own', async () => {
    const p = await page(worker({ current: V1, pending: null }), worker({ current: V1, pending: V2 }));
    await vi.waitFor(() => expect(p.watch.waiting()).toEqual(V2));
    expect(p.watch.current()).toEqual(V1);
  });

  it('after a cold open (the browser activated the new build, no worker waits) the pending build still waits', async () => {
    const active = worker({ current: V1, pending: V2 });
    const p = await page(active);
    await vi.waitFor(() => expect(p.watch.waiting()).toEqual(V2));
    expect(p.watch.current()).toEqual(V1);

    p.watch.accept();
    expect(active.sent).toEqual([{ type: 'accept' }]);
    active.answer = { current: V2, pending: null };
    p.on.message!({ data: { type: 'changed' } });
    await vi.waitFor(() => expect(p.reload).toHaveBeenCalledTimes(1));
  });

  it('accept() with no build waiting sends nothing and reloads nothing', async () => {
    const active = worker({ current: V1, pending: null });
    const p = await page(active);
    await vi.waitFor(() => expect(p.watch.current()).toEqual(V1));
    p.watch.accept();
    expect(active.sent).toEqual([]);
    expect(p.reload).not.toHaveBeenCalled();
  });

  it('a build accepted in another tab reloads this one on controllerchange', async () => {
    const v1 = worker({ current: V1, pending: null });
    const v2 = worker({ current: V1, pending: V2 });
    const p = await page(v1, v2);
    await vi.waitFor(() => expect(p.watch.waiting()).toEqual(V2));
    // Another tab accepted: v2 took over and claimed this page.
    v2.answer = { current: V2, pending: null };
    p.reg.active = v2;
    p.reg.waiting = null;
    p.on.controllerchange!();
    await vi.waitFor(() => expect(p.reload).toHaveBeenCalledTimes(1));
  });

  it('the first installation taking the page does not reload it', async () => {
    const p = await page(null);
    await vi.waitFor(() => expect(p.changed).toHaveBeenCalled());
    expect(p.watch.current()).toBeNull();
    p.reg.active = worker({ current: V1, pending: null });
    p.on.controllerchange!();
    await vi.waitFor(() => expect(p.watch.current()).toEqual(V1));
    expect(p.reload).not.toHaveBeenCalled();
  });
});
