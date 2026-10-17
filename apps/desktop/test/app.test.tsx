import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

describe('the shell on the real fleet', () => {
  it('boots on the real fleet: the crumb says Atelier and the sidebar lists the local machine', async () => {
    const d = await daemon(); d.upsert(fakeSession('otto')); d.upsert(fakeSession('nova', { name: 'Nova' }));
    render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    expect(within(screen.getByRole('banner')).getByText('Atelier')).toBeVisible();
    const side = within(screen.getByRole('complementary', { name: 'Sidebar' }));
    await waitFor(() => expect(side.getByRole('button', { name: /Local/ })).toHaveTextContent('2 agents'));
  });

  it('shows the local machine offline once the first attempt fails, without throwing', async () => {
    render(<App client={createDesktopFleet({ WebSocketImpl: DeadSocket })} />);
    const side = within(screen.getByRole('complementary', { name: 'Sidebar' }));
    await waitFor(() => expect(side.getByRole('button', { name: /Local/ })).toHaveTextContent('offline'), { timeout: 6000 });
    expect(side.getByRole('button', { name: /Local/ }).querySelector('.machine-dot')).toHaveClass('off');
  });

  it('the footer connection dot is off when the local daemon is down, on when connected', async () => {
    const d = await daemon();
    const ok = render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    await waitFor(() => expect(within(screen.getByRole('complementary', { name: 'Sidebar' })).getByRole('button', { name: /Local/ })).toHaveTextContent('agents'));
    expect(within(screen.getByRole('contentinfo')).getByText('Local and SSH sessions').querySelector('.connection-dot')).not.toHaveClass('off');
    ok.unmount();
    render(<App client={createDesktopFleet({ WebSocketImpl: DeadSocket })} />);
    await waitFor(() => expect(within(screen.getByRole('contentinfo')).getByText('Local and SSH sessions').querySelector('.connection-dot')).toHaveClass('off'), { timeout: 6000 });
  }, 12000);

  it('speaks the stored language from the first render', async () => {
    localStorage.setItem('desktop.lang', 'fr');
    const d = await daemon();
    render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    expect(screen.getByText('Sessions locales et SSH')).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Barre latérale' })).toBeVisible();
  });
});

describe('the bundle', () => {
  it('the session page comes in a chunk of its own: the shell imports neither it nor the Markdown reader', () => {
    const app = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8');
    expect(app).not.toMatch(/from '\.\/session\/Workspace'/);
    expect(app).not.toMatch(/from '@ledge\/ui\/documents\/markdown'/);
    expect(readFileSync(resolve(__dirname, '../src/session/lazy.tsx'), 'utf8')).toMatch(/import\('\.\/Workspace'\)/);
  });
});
