import { render } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import type { MeResponse } from '@ledge/protocol';
import { App } from '../../src/App';
import type { UpdateWatch } from '../../src/sw/register';
import type { BuildInfo } from '../../src/sw/types';
import { setup } from './setup';

/** `/auth/me` answering `me`, or 401 when it is null; every call recorded. */
export function meStub(me: MeResponse | null = { accountId: 'A', login: 'paradow', peer: 'd_aaaaaaaaaaaaaaaa', kind: 'device' }) {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    me ? new Response(JSON.stringify(me), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response(null, { status: 401 }));
  return fetchImpl;
}

/** A service worker's watch, its builds set by the test; `accept` recorded. */
type Builds = { current: BuildInfo | null; waiting: BuildInfo | null };

export function fakeUpdates(current: BuildInfo | null = null, waiting: BuildInfo | null = null): { watch: UpdateWatch; set(next: Partial<Builds>): void; accept: Mock<() => void> } {
  const listeners = new Set<() => void>();
  const builds: Builds = { current, waiting };
  const accept = vi.fn<() => void>();
  const watch: UpdateWatch = {
    current: () => builds.current,
    waiting: () => builds.waiting,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    accept
  };
  const set = (next: Partial<Builds>) => { Object.assign(builds, next); for (const fn of listeners) fn(); };
  return { watch, set, accept };
}

/** The whole app on a fake link and a real store, at `hash`. */
export function app(state: Parameters<typeof setup>[0] = 'ready', opts: { hash?: string; signin?: string | null; lost?: boolean; updates?: UpdateWatch | null; me?: MeResponse | null } = {}) {
  globalThis.history.replaceState(null, '', `/${opts.hash ?? '#/'}`);
  const t = setup(state);
  const fetchImpl = meStub(opts.me);
  render(
    <App link={t.link} store={t.store} storage={t.storage} fetchImpl={fetchImpl as unknown as typeof fetch} signin={opts.signin ?? null} lost={opts.lost ?? false} updates={opts.updates ?? null} />
  );
  return { ...t, fetchImpl };
}
