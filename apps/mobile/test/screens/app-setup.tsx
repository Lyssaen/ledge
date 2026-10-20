import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { MeResponse } from '@ledge/protocol';
import { App } from '../../src/App';
import type { BuildInfo } from '../../src/sw/types';
import { setup } from './setup';

/** `/auth/me` answering `me`, or 401 when it is null; every call recorded. */
export function meStub(me: MeResponse | null = { accountId: 'A', login: 'paradow', peer: 'd_aaaaaaaaaaaaaaaa', kind: 'device' }) {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    me ? new Response(JSON.stringify(me), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response(null, { status: 401 }));
  return fetchImpl;
}

/** The whole app on a fake link and a real store, at `hash`. */
export function app(state: Parameters<typeof setup>[0] = 'ready', opts: { hash?: string; signin?: string | null; lost?: boolean; build?: BuildInfo | null; me?: MeResponse | null } = {}) {
  globalThis.history.replaceState(null, '', `/${opts.hash ?? '#/'}`);
  const t = setup(state);
  const fetchImpl = meStub(opts.me);
  render(
    <App link={t.link} store={t.store} storage={t.storage} fetchImpl={fetchImpl as unknown as typeof fetch} signin={opts.signin ?? null} lost={opts.lost ?? false} build={opts.build ?? null} />
  );
  return { ...t, fetchImpl };
}
