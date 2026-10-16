import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); });
async function daemon() { const d = await createMockDaemon(); daemons.push(d); d.machines([{ id: 'local', label: 'Local' }]); return d; }

/** A local daemon that refuses at once: the fleet settles on `unreachable` after its first attempt. */
class DeadSocket { onopen = null; onmessage: unknown = null; onclose: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; readyState = 3; constructor(public url: string) { setTimeout(() => { this.onerror?.({}); this.onclose?.({ code: 1006 }); }, 0); } send() {} close() {} }

describe('the waiting shell', () => {
  it('waits on the real fleet: product name, session count and the local machine connected', async () => {
    const d = await daemon(); d.upsert(fakeSession('otto')); d.upsert(fakeSession('nova'));
    render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    expect(await screen.findByRole('heading', { name: 'Ledge Desktop' })).toBeVisible();
    expect(await screen.findByText('2 sessions')).toBeVisible();
    expect(await screen.findByText('Local connected')).toBeVisible();
  });

  it('says the local daemon is disconnected once the first attempt fails, without throwing', async () => {
    render(<App client={createDesktopFleet({ WebSocketImpl: DeadSocket })} />);
    expect(await screen.findByText('Local disconnected', {}, { timeout: 6000 })).toBeVisible();
    expect(screen.getByText('0 sessions')).toBeVisible();
  });

  it('speaks the stored language from the first render', async () => {
    localStorage.setItem('desktop.lang', 'fr');
    const d = await daemon();
    render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    expect(screen.getByText('L’Atelier se construit. Ledge suit vos agents en attendant.')).toBeVisible();
    expect(await screen.findByText('Local connecté')).toBeVisible();
  });
});
