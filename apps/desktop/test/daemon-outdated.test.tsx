import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createTokenSource, type TokenRead, type TokenSource } from '@ledge/fleet';

// One source per test, shared by the fleet and the notice like the real module singleton.
const holder = vi.hoisted(() => ({ source: undefined as TokenSource | undefined }));
vi.mock('../src/tauri/bridge', async (orig) => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), daemonTokenSource: () => holder.source }));
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';

class DeadSocket { static protocols: unknown[] = []; onopen = null; onmessage: unknown = null; onclose: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; readyState = 3;
  constructor(public url: string, protocols?: unknown) { DeadSocket.protocols.push(protocols); setTimeout(() => { this.onerror?.({}); this.onclose?.({ code: 1006 }); }, 0); } send() {} close() {} }

let answer: TokenRead;
beforeEach(() => { localStorage.clear(); DeadSocket.protocols = []; holder.source = createTokenSource(async () => answer); });
afterEach(() => cleanup());
const NPM = 'npm i -g @paradow/ledge && systemctl --user restart ledge-daemon';
const GIT = 'cd <your Ledge clone> && git pull && pnpm install && pnpm --filter @paradow/ledge build && systemctl --user restart ledge-daemon';
const TITLE = 'The Ledge daemon must be updated';
const mount = () => render(<App client={createDesktopFleet({ WebSocketImpl: DeadSocket })} />);

describe('the daemon-too-old notice', () => {
  it('shows both commands when the token is missing', async () => {
    answer = { kind: 'absent' };
    mount();
    expect(await screen.findByText(TITLE)).toBeVisible();
    expect(screen.getByText('Installed with npm')).toBeVisible();
    expect(screen.getByText('Installed from a git clone')).toBeVisible();
    expect(screen.getByText(NPM).tagName).toBe('CODE');
    expect(screen.getByText(GIT).tagName).toBe('CODE');
    expect(DeadSocket.protocols).toEqual([]); // strict client: no socket without a token
  });

  it('hides once the token appears', async () => {
    answer = { kind: 'absent' };
    mount();
    await screen.findByText(TITLE);
    answer = { kind: 'token', token: 'a'.repeat(64) };
    await act(async () => { await holder.source!.get(true); });
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('says nothing while WSL is unavailable', async () => {
    answer = { kind: 'unavailable' };
    mount();
    await act(async () => { await holder.source!.get(true); });
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('the desktop fleet hands its token source to the client: the socket presents ledge.<token>', async () => {
    const token = 'b'.repeat(64);
    answer = { kind: 'token', token };
    mount();
    await vi.waitFor(() => expect(DeadSocket.protocols.length).toBeGreaterThan(0));
    expect(DeadSocket.protocols[0]).toEqual([`ledge.${token}`]);
  });
});
