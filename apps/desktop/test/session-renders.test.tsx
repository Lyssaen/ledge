import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import { daemonStore } from '@ledge/fleet';
import { boot, closeDaemons, listSessions, ottoThread } from './helpers';

// Each action group counts its renders by its first action; each exchange's time mark counts the thread's renders.
const groups = vi.hoisted(() => new Map<string, number>());
const marks = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/session/ActionGroup', async importOriginal => {
  const real = await importOriginal<typeof import('../src/session/ActionGroup')>();
  return { ...real, ActionGroup: (p: Parameters<typeof real.ActionGroup>[0]) => { const id = p.tools[0]!.id; groups.set(id, (groups.get(id) ?? 0) + 1); return real.ActionGroup(p); } };
});
vi.mock('../src/session/thread', async importOriginal => {
  const real = await importOriginal<typeof import('../src/session/thread')>();
  return { ...real, timeMark: (...a: Parameters<typeof real.timeMark>) => { marks.n++; return real.timeMark(...a); } };
});

afterEach(async () => { cleanup(); localStorage.clear(); vi.useRealTimers(); groups.clear(); marks.n = 0; await closeDaemons(); });

const thread = () => within(screen.getByRole('region', { name: 'Session thread' }));
/** Otto's page with its thread (an action running in the last exchange), the page's clock held still. */
async function openOtto() {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const env = await boot({ sessions: listSessions(), list: true });
  env.d.thread('otto', ottoThread());
  await env.user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await thread().findByRole('status', { name: 'Action running' });
  // Settled: the thread's renders have stopped (waitFor polls with setInterval, held still here).
  for (let seen = -1; seen !== marks.n;) { seen = marks.n; await pause(150); }
  return env;
}
const pause = (ms: number) => act(() => new Promise<void>(r => setTimeout(r, ms)));
async function until(check: () => boolean) {
  for (let i = 0; i < 40 && !check(); i++) await pause(50);
  expect(check()).toBe(true);
}
const counts = () => ({ thread: marks.n, groups: Object.fromEntries(groups) });

describe('the thread renders only for what it shows', () => {
  it('a preview of another session and a chat delta leave the thread and its action groups alone', async () => {
    const { d } = await openOtto();
    expect([...groups.keys()].sort()).toEqual(['t1', 't4', 't5']);
    const before = counts();
    d.preview('nova', ['$ npm run build']);
    await until(() => daemonStore.getState().previews.get('local:nova')?.[0] === '$ npm run build');
    act(() => { daemonStore.apply({ type: 'chat.delta', qid: 'q1', text: 'Je regarde' }); });
    expect(daemonStore.getState().chatLive).toEqual({ qid: 'q1', text: 'Je regarde' });
    expect(counts()).toEqual(before);
  });

  it('the clock ticks only the exchange whose action runs', async () => {
    await openOtto();
    const before = counts();
    await act(async () => { vi.advanceTimersByTime(1000); });
    const after = counts();
    expect(after.thread).toBeGreaterThan(before.thread);           // the thread took the new time…
    expect(after.groups.t5).toBeGreaterThan(before.groups.t5!);    // …the live exchange's actions count on…
    expect([after.groups.t1, after.groups.t4]).toEqual([before.groups.t1, before.groups.t4]); // …the finished exchange is left alone
  });
});
