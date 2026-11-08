import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ServerMessage } from '@ledge/protocol';
import { createDesktopFleet } from '../../src/fleet/useFleet';
import { App } from '../../src/App';
import { loadWorkspace } from '../../src/session/lazy';
import { loadSettings } from '../../src/settings/lazy';
import { loadHome, loadChat } from '../../src/chat/lazy';
import { loadIde } from '../../src/ide/lazy';
import { saveIdeEnabled, saveShowUsage } from '../../src/workspace/prefs';
import { PROJECTS } from '../helpers';

// The IDE's status bar (mockup `statusbar()`): the footer's status, the waiting requests, a spacer, the usage limits at the
// far right; a limit's detail opens from there.
type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'fr'); });
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); saveIdeEnabled(false); saveShowUsage(true); localStorage.clear(); });

const usage = {
  type: 'usage.state',
  harnesses: [
    { harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: new Date().toISOString(), windows: [{ kind: 'five_hour', pct: 40, resetsAt: null }, { kind: 'seven_day', pct: 20, resetsAt: null }] },
    { harness: 'cursor', account: 'c0ffee000001', status: 'ok', readAt: new Date().toISOString(), windows: [{ kind: 'month', pct: 12, resetsAt: null }, { kind: 'pool', pool: 'cursor', pct: 8, resetsAt: null }, { kind: 'pool', pool: 'other', pct: 56, resetsAt: null }] }
  ],
  alerts: [], prefs: { alert: 0.8 }
} as unknown as ServerMessage;

async function mount({ waitUsage = true } = {}) {
  await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde()]);
  saveIdeEnabled(true);
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }]);
  d.projects(PROJECTS);
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission' }));
  d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'working' }));
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  const side = within(await screen.findByRole('complementary', { name: 'Barre latérale' }));
  await side.findByRole('tree', { name: 'Projets, branches et sessions' });
  act(() => d.push(usage));
  const bar = await waitFor(() => { const b = document.querySelector<HTMLElement>('.ide-status'); expect(b).not.toBeNull(); if (waitUsage) expect(b?.querySelector('.usage-foot')).not.toBeNull(); return b!; });
  return { bar, user: userEvent.setup() };
}

describe('the IDE status bar', () => {
  it('ends with the usage limits, after the waiting requests', async () => {
    const { bar } = await mount();
    const wait = within(bar).getByRole('button', { name: '1 demande' });
    const limits = bar.querySelector('.usage-foot')!;
    // The limits are the bar's own last item, not inside the footer that starts it.
    expect(bar.lastElementChild).toBe(limits);
    expect(wait.compareDocumentPosition(limits) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.querySelector('.workspace-footer .usage-foot')).toBeNull();
  });

  it('a click on a limit opens its detail, a second closes it; Cursor shows its month and its pools', async () => {
    const { bar, user } = await mount();
    const claude = within(bar).getByRole('button', { name: 'Limites de Claude Code : détail' });
    await user.click(claude);
    expect(claude).toHaveAttribute('aria-expanded', 'true');
    expect(within(bar).getByRole('dialog', { name: 'Limites · Claude Code' })).toHaveTextContent('Session · 5 h');
    await user.click(claude);
    expect(within(bar).queryByRole('dialog')).toBeNull();
    await user.click(within(bar).getByRole('button', { name: 'Limites de Cursor Agent : détail' }));
    const pop = within(bar).getByRole('dialog', { name: 'Limites · Cursor Agent' });
    for (const t of ['Total inclus · mois', 'Modèles Cursor', 'Autres modèles']) expect(pop).toHaveTextContent(t);
  });

  it('« Limites d’usage des comptes » unchecked (Settings › Workspace): no limits in the bar; checked again, they come back', async () => {
    saveShowUsage(false);
    const { bar } = await mount({ waitUsage: false });
    // The usage is in (the waiting request shows the bar is live), yet no limit is drawn.
    await within(bar).findByRole('button', { name: '1 demande' });
    expect(bar.querySelector('.usage-foot')).toBeNull();
    act(() => saveShowUsage(true));
    await waitFor(() => expect(bar.querySelector('.usage-foot')).not.toBeNull());
  });
});
