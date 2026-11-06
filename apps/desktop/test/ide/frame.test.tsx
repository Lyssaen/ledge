import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../../src/fleet/useFleet';
import { App } from '../../src/App';
import { loadWorkspace } from '../../src/session/lazy';
import { loadSettings } from '../../src/settings/lazy';
import { loadHome, loadChat } from '../../src/chat/lazy';
import { loadIde } from '../../src/ide/lazy';
import { saveIdeEnabled } from '../../src/workspace/prefs';
import { PROJECTS } from '../helpers';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
// jsdom has no ResizeObserver: setup.ts poses a silent one, which is all dockview needs to mount here.
beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'fr'); });
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); saveIdeEnabled(false); localStorage.clear(); });

async function mount({ ide = true } = {}) {
  await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde()]);
  if (ide) saveIdeEnabled(true);
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }]);
  d.projects(PROJECTS);
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }));
  d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'working' }));
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  const side = within(await screen.findByRole('complementary', { name: 'Barre latérale' }));
  const tree = within(await side.findByRole('tree', { name: 'Projets, branches et sessions' }));
  await tree.findByRole('button', { name: /^Otto/ });
  return { d, side, tree, user: userEvent.setup() };
}

const tabs = () => screen.queryAllByRole('tab').filter(t => t.closest('.dv-tabs-container'));
const activeTab = () => tabs().find(t => t.getAttribute('aria-selected') === 'true');

describe('the IDE shell (switch on)', () => {
  it('renders its title bar, activity bar and status bar, not the « Commande » bar', async () => {
    await mount();
    const bars = screen.getAllByRole('group', { name: 'Barre de fenêtre' });
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveClass('ide-titlebar');
    expect(within(bars[0]!).getByText('Ledge')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Barre d’activité' })).toBeVisible();
    expect(document.querySelector('.ide-status')).not.toBeNull();
    expect(document.querySelector('.titlebar')).toBeNull();
    expect(document.querySelector('.application')).toBeNull();
  });

  it('first run: the active tab is the Atelier', async () => {
    await mount();
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Atelier'));
    expect(tabs()).toHaveLength(1);
    expect(document.querySelector('.ide-pane .atelier-floor')).not.toBeNull();
  });

  it('a session clicked in Projets opens a tab with its name; a second click opens no other', async () => {
    const { tree, user } = await mount();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    expect(tabs()).toHaveLength(2);
    // Only the tab in front draws its content: Otto's session page, not the atelier.
    await waitFor(() => expect(document.querySelector('.ide-pane .conversation-workspace')).not.toBeNull());
    expect(document.querySelector('.ide-pane .atelier-floor')).toBeNull();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    expect(tabs()).toHaveLength(2);
    await user.click(tree.getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Nova'));
    expect(tabs().map(t => t.getAttribute('aria-label'))).toEqual(['Atelier', 'Otto', 'Nova']);
  });

  it('a tab chosen in dockview becomes the model\'s, a tab closed there leaves it', async () => {
    const { tree, user } = await mount();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    const atelier = tabs().find(t => t.getAttribute('aria-label') === 'Atelier')!;
    act(() => { atelier.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); });
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Atelier'));
    await waitFor(() => expect(JSON.parse(JSON.parse(localStorage.getItem('ledge.ide.workspace')!)).groups[0].active).toBe(0));
    await user.click(screen.getByRole('button', { name: 'Fermer Otto' }));
    await waitFor(() => expect(tabs()).toHaveLength(1));
    expect(JSON.parse(JSON.parse(localStorage.getItem('ledge.ide.workspace')!)).groups[0].tabs).toEqual([{ kind: 'atelier', ref: 'main' }]);
  });

  it('Ctrl+/ hides the chat, then shows it again', async () => {
    const { user } = await mount();
    expect(await screen.findByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
    await user.keyboard('{Control>}/{/Control}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull());
    await user.keyboard('{Control>}/{/Control}');
    expect(await screen.findByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
  });

  it('Ctrl+J shows the bottom frame: Terminaux, Sortie and « Masquer le panneau »', async () => {
    const { user } = await mount();
    expect(screen.queryByRole('region', { name: 'Panneau du bas' })).toBeNull();
    await user.keyboard('{Control>}j{/Control}');
    const bottom = within(await screen.findByRole('region', { name: 'Panneau du bas' }));
    expect(bottom.getByRole('tab', { name: 'Terminaux' })).toBeVisible();
    expect(bottom.getByRole('tab', { name: /^Sortie/ })).toBeVisible();
    await user.click(bottom.getByRole('button', { name: 'Masquer le panneau' }));
    expect(screen.queryByRole('region', { name: 'Panneau du bas' })).toBeNull();
  });

  it('Review Focus 3: a session open with the IDE off is its active tab once on; off again, its page as today', async () => {
    const { side, user } = await mount({ ide: false });
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(within(screen.getByRole('banner')).getByText('Otto')).toBeVisible());
    act(() => saveIdeEnabled(true));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    expect(document.querySelector('.titlebar')).toBeNull();
    act(() => saveIdeEnabled(false));
    await waitFor(() => expect(within(screen.getByRole('banner')).getByText('Otto')).toBeVisible());
    expect(document.querySelector('.ide')).toBeNull();
    // Turning it off closes no tab.
    expect(JSON.parse(JSON.parse(localStorage.getItem('ledge.ide.workspace')!)).groups[0].tabs.map((t: { ref: string }) => t.ref)).toEqual(['main', 'local:otto']);
  });
});

describe('the IDE bundle', () => {
  it('the shell loads the IDE in a chunk of its own: App imports neither dockview nor the frame', () => {
    const app = readFileSync(resolve(__dirname, '../../src/App.tsx'), 'utf8');
    expect(app).not.toMatch(/from 'dockview/);
    expect(app).not.toMatch(/from '\.\/ide\/(IdeFrame|DockHost)'/);
    expect(readFileSync(resolve(__dirname, '../../src/ide/lazy.tsx'), 'utf8')).toMatch(/import\('\.\/IdeFrame'\)/);
    expect(readFileSync(resolve(__dirname, '../../src/ide/DockHost.tsx'), 'utf8')).toMatch(/dockview-react\/dist\/styles\/dockview\.css/);
  });
});
