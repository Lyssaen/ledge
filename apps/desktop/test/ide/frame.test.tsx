import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { saveOpenSession } from '../../src/workspace/openPrefs';
import type { DaemonInfo, Machines } from '@ledge/protocol';
import { PROJECTS } from '../helpers';
import { empty, open, serialize, type Workspace } from '../../src/workspace/model';
import { ATELIER_TAB, WORKSPACE_KEY } from '../../src/workspace/store';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
// jsdom has no ResizeObserver: setup.ts poses a silent one, which is all dockview needs to mount here.
beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'fr'); });
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); saveIdeEnabled(false); localStorage.clear(); });

async function mount({ ide = true, machines = [{ id: 'local', label: 'Local' }], daemon }: { ide?: boolean; machines?: Machines; daemon?: DaemonInfo } = {}) {
  await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde()]);
  if (ide) saveIdeEnabled(true);
  const d = await createMockDaemon(); daemons.push(d);
  d.machines(machines);
  if (daemon) d.extras.daemon = daemon;
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
    expect(bars[0]!.querySelector('[data-brand] svg[data-ledge-mark]')).toHaveAttribute('viewBox', '0 0 16 16');
    expect(bars[0]!.querySelector('.brand-dot')).toBeNull();
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

  it("the place sync is not a user open: with « Ouvrir une session » on 'right', switching the IDE on keeps one group", async () => {
    saveOpenSession('right');
    try {
      const { side, user } = await mount({ ide: false });
      await user.click(side.getByRole('button', { name: /^Otto/ }));
      await waitFor(() => expect(within(screen.getByRole('banner')).getByText('Otto')).toBeVisible());
      act(() => saveIdeEnabled(true));
      await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
      expect(JSON.parse(JSON.parse(localStorage.getItem('ledge.ide.workspace')!)).groups).toHaveLength(1);
    } finally { saveOpenSession('active'); }
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

describe('the IDE keyboard: the chat never holds the single keys', () => {
  it('/ focuses the chat; Escape leaves it; then Alt+1 opens the first agent\'s tab and ? the shortcuts', async () => {
    const { user } = await mount();
    await user.keyboard('/');
    const chat = await screen.findByRole('complementary', { name: 'Chat Ledge' });
    await waitFor(() => expect(chat.contains(document.activeElement)).toBe(true));
    await user.keyboard('{Escape}');
    expect(chat.contains(document.activeElement)).toBe(false);
    expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();   // the panel stays: Ctrl+/ hides it
    await user.keyboard('{Alt>}1{/Alt}');
    await waitFor(() => expect(['Otto', 'Nova']).toContain(activeTab()?.getAttribute('aria-label')));
    expect(tabs()).toHaveLength(2);
    await user.keyboard('/');
    await user.keyboard('{Escape}');
    await user.keyboard('?');
    expect(await screen.findByRole('dialog', { name: /Raccourcis clavier/ })).toBeVisible();
  });

  it('a chat left open by the current interface does not hold the keys once the IDE is on', async () => {
    const { user } = await mount({ ide: false });
    await user.keyboard('{Control>}/{/Control}');   // the current interface: the docked chat opens (nav.chat)
    await screen.findByRole('complementary', { name: 'Chat Ledge' });
    act(() => saveIdeEnabled(true));
    await waitFor(() => expect(document.querySelector('.ide')).not.toBeNull());
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('?');
    expect(await screen.findByRole('dialog', { name: /Raccourcis clavier/ })).toBeVisible();
  });
});

describe('the IDE tabs follow the fleet (Review Focus 1)', () => {
  const stored = () => JSON.parse(JSON.parse(localStorage.getItem('ledge.ide.workspace')!)).groups[0].tabs.map((t: { ref: string }) => t.ref) as string[];

  it('a session deleted while open closes its tab; an archived one keeps it, and it reads', async () => {
    const { d, tree, user } = await mount();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await user.click(tree.getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(tabs()).toHaveLength(3));
    act(() => d.remove('nova'));
    await waitFor(() => expect(tabs().map(t => t.getAttribute('aria-label'))).toEqual(['Atelier', 'Otto']));
    expect(stored()).toEqual(['main', 'local:otto']);
    act(() => d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'exited', archivedAt: '2026-11-01T10:00:00.000Z' })));
    await waitFor(() => expect(tree.queryByRole('button', { name: /^Otto/ })).toBeNull());   // archived: out of the projects' tree
    expect(tabs().map(t => t.getAttribute('aria-label'))).toEqual(['Atelier', 'Otto']);
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    expect(document.querySelector('.ide-pane .conversation-workspace')).not.toBeNull();
  });

  it('a tab of an offline machine stays, while a ready machine\'s deleted session closes its own', async () => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serialize(open(open(empty(), ATELIER_TAB), { kind: 'session', ref: 'nas:ghost' }))));
    const { d, tree, user } = await mount({ machines: [{ id: 'local', label: 'Local' }, { id: 'nas', label: 'NAS', ssh: 'nas' }] });
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(stored()).toEqual(['main', 'nas:ghost', 'local:otto']));
    act(() => d.remove('otto'));
    await waitFor(() => expect(stored()).toEqual(['main', 'nas:ghost']));
    expect(tabs().map(t => t.getAttribute('aria-label'))).toEqual(['Atelier', 'nas:ghost']);
  });
});

describe('the IDE tabs carry the place (whole-branch review)', () => {
  const pointer = (name: string) => act(() => { tabs().find(t => t.getAttribute('aria-label') === name)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); });

  it('the Settings tab has no « Retour »; switched off, today\'s Settings page has it', async () => {
    const { user } = await mount();
    await user.keyboard('{Control>},{/Control}');
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Réglages'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Général' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Retour à l’atelier/ })).toBeNull();
    act(() => saveIdeEnabled(false));
    expect(await screen.findByRole('button', { name: /Retour à l’atelier/ })).toBeVisible();
  });

  it('N on the Atelier tab after a session tab opens New session (the place is the overview again)', async () => {
    const { tree, user } = await mount();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    pointer('Atelier');
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Atelier'));
    await user.keyboard('n');
    expect(await screen.findByRole('dialog', { name: 'Nouvelle session' })).toBeVisible();
    await user.keyboard('{Escape}');
    // The activity bar's Atelier does the same.
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    await user.click(screen.getByRole('button', { name: 'Atelier (onglet)' }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Atelier'));
    await user.keyboard('n');
    expect(await screen.findByRole('dialog', { name: 'Nouvelle session' })).toBeVisible();
  });

  it('Settings comes back on the section it was left on, after a session tab; switched off there, today\'s Settings page', async () => {
    const { tree, user } = await mount();
    await user.keyboard('{Control>},{/Control}');
    await user.click(within(await screen.findByRole('navigation', { name: 'Sections des réglages' })).getByRole('button', { name: 'Apparence' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Apparence' })).toBeVisible();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    await user.click(screen.getByRole('button', { name: 'Réglages (onglet)' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Apparence' })).toBeVisible();
    pointer('Otto');
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    pointer('Réglages');
    expect(await screen.findByRole('heading', { level: 1, name: 'Apparence' })).toBeVisible();
    act(() => saveIdeEnabled(false));
    await waitFor(() => expect(document.querySelector('.ide')).toBeNull());
    expect(screen.getByRole('heading', { level: 1, name: 'Apparence' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Retour à l’atelier/ })).toBeVisible();
  });
});

describe('the right panel needs room (whole-branch review)', () => {
  const width = (w: number) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
  afterEach(() => { width(1024); });
  const toggle = () => screen.getByRole('button', { name: 'Panneau de droite (Ctrl+/)' });

  it('900 px, the sidebar open: the panel does not fit and its toggle is off; / folds the sidebar and shows the chat', async () => {
    width(900);
    const { user } = await mount();
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    await user.keyboard('/');
    expect(await screen.findByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
    expect(document.querySelector('.ide-explorer')).toBeNull();
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
  });

  it('600 px: no room even folded — the toggle stays off and nothing shows', async () => {
    width(600);
    const { user } = await mount();
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
    expect(document.querySelector('.ide-explorer')).not.toBeNull();
  });
});

describe('the IDE session tab (lot 2)', () => {
  const tabOf = (name: string) => tabs().find(t => t.getAttribute('aria-label') === name)!;

  it('a session waiting for a permission has the red alert on its tab, one asking a question the amber one', async () => {
    const { d, tree, user } = await mount();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await user.click(tree.getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Nova'));
    act(() => { d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission' })); d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'waiting_input' })); });
    await waitFor(() => expect(tabOf('Otto')).toHaveClass('alert'));
    await waitFor(() => expect(tabOf('Nova')).toHaveClass('alert-a'));
    expect(tabOf('Atelier')).not.toHaveClass('alert');
  });

  it('right click on a tab: the menu switches the view to the terminal and back, closes the others', async () => {
    const { tree, user } = await mount();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await user.click(tree.getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(tabs()).toHaveLength(3));
    fireEvent.contextMenu(tabOf('Otto'));
    const menu = await screen.findByRole('menu', { name: /Otto/ });
    expect(within(menu).getByText('Otto')).toBeVisible();
    expect(within(menu).queryByText(/role\.md|Ouvrir dans/)).toBeNull();
    // « Diviser à droite », Ctrl \ on its right (lot 3).
    expect(within(menu).getByRole('menuitem', { name: /Diviser à droite/ })).toHaveTextContent('Ctrl \\');
    await user.click(within(menu).getByRole('menuitem', { name: /Basculer sur le terminal/ }));
    await waitFor(() => expect(within(tabOf('Otto')).getByTitle('Vue terminal')).toBeInTheDocument());
    expect(tabOf('Otto')).toHaveAccessibleName('Otto');
    fireEvent.contextMenu(tabOf('Otto'));
    await user.click(within(await screen.findByRole('menu', { name: /Otto/ })).getByRole('menuitem', { name: /Revenir au fil/ }));
    await waitFor(() => expect(within(tabOf('Otto')).queryByTitle('Vue terminal')).toBeNull());
    fireEvent.contextMenu(tabOf('Otto'));
    await user.click(within(await screen.findByRole('menu', { name: /Otto/ })).getByRole('menuitem', { name: 'Fermer les autres' }));
    await waitFor(() => expect(tabs()).toHaveLength(1));
    expect(tabs()[0]).toHaveAccessibleName('Otto');
  });

  it('the bottom bar: Otto\'s +1 opens « Modifications · Otto » in a second group and lights; the model chip is in the bar, not the reply', async () => {
    const { d, tree, user } = await mount({ daemon: { version: '1', install: 'npm', systemd: true, models: true, modelSwitch: true } });
    d.thread('otto', [{ kind: 'tool', id: 'w1', at: new Date().toISOString(), turn: 1, tool: 'Write', label: '/w/ledge/notes.md', status: 'success', files: [{ path: '/w/ledge/notes.md', change: 'write', diff: '+ Bonjour' }] }]);
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    const page = () => document.querySelector<HTMLElement>('.ide-pane .session-page[data-session$="otto"]')!;
    await waitFor(() => expect(page().querySelector('.ide-bar .model-chip')).not.toBeNull());
    expect(page().querySelector('.session-reply .model-chip')).toBeNull();
    const chip = await within(page()).findByRole('button', { name: /\+1/ });
    expect(document.querySelectorAll('.ide-dock .dv-groupview')).toHaveLength(1);
    await user.click(chip);
    await waitFor(() => expect(tabs().map(t => t.getAttribute('aria-label'))).toContain('Modifications · Otto'));
    expect(document.querySelectorAll('.ide-dock .dv-groupview')).toHaveLength(2);
    await waitFor(() => expect(within(page()).getByRole('button', { name: /\+1/ })).toHaveClass('on'));
    expect(activeTab()).toHaveAccessibleName('Otto');
    // On the terminal view, the bar stays.
    fireEvent.contextMenu(tabOf('Otto'));
    await user.click(within(await screen.findByRole('menu', { name: /Otto/ })).getByRole('menuitem', { name: /Basculer sur le terminal/ }));
    await waitFor(() => expect(within(tabOf('Otto')).getByTitle('Vue terminal')).toBeInTheDocument());
    expect(page().querySelector('.session-reply')).toBeNull();
    expect(page().querySelector('.ide-bar .model-chip')).not.toBeNull();
    expect(within(page()).getByRole('button', { name: /\+1/ })).toHaveClass('on');
    fireEvent.contextMenu(tabOf('Otto'));
    await user.click(within(await screen.findByRole('menu', { name: /Otto/ })).getByRole('menuitem', { name: /Revenir au fil/ }));
    await waitFor(() => expect(within(tabOf('Otto')).queryByTitle('Vue terminal')).toBeNull());
    // R10: an action clicked in the Changes tab brings Otto's tab forward (its group focused) and lights nothing.
    const changes = await waitFor(() => { const el = document.querySelector<HTMLElement>('.ide-changes .file-touches'); expect(el).not.toBeNull(); return el!; });
    await user.click(tabOf('Modifications · Otto'));
    await waitFor(() => expect(document.querySelector('.dv-active-group')).toContainElement(tabOf('Modifications · Otto')));
    await user.click(within(changes).getByRole('button', { name: /^Write · tour 1/ }));
    await waitFor(() => expect(document.querySelector('.dv-active-group')).toContainElement(tabOf('Otto')));
    expect(document.querySelector('.action-row.flash')).toBeNull();
  });

  // The IDE menu's one terminal entry is « Son terminal » (lot 3); lot 2's « Terminal » stays on the row's button, the chat and the island.
  it('the row\'s « Terminal » opens the tab on its terminal view; the stored preference is left alone', async () => {
    const { tree, user } = await mount();
    const stored = localStorage.getItem('desktop.session');
    await user.click(tree.getByRole('button', { name: 'Ouvrir le terminal de Otto' }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    await waitFor(() => expect(within(tabOf('Otto')).getByTitle('Vue terminal')).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector('.ide-pane .session-page[data-session$="otto"] .agent-view')).not.toBeNull());
    expect(localStorage.getItem('desktop.session')).toBe(stored);
  });

  it('the « Modifications » tab draws its session\'s provider logo, aria-hidden, before its name', async () => {
    const { d, tree, user } = await mount();
    d.thread('otto', [{ kind: 'tool', id: 'w1', at: new Date().toISOString(), turn: 1, tool: 'Write', label: '/w/ledge/notes.md', status: 'success', files: [{ path: '/w/ledge/notes.md', change: 'write', diff: '+ Bonjour' }] }]);
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    const page = await waitFor(() => { const el = document.querySelector<HTMLElement>('.ide-pane .session-page[data-session$="otto"]'); expect(el).not.toBeNull(); return el!; });
    await user.click(await within(page).findByRole('button', { name: /\+1/ }));
    await waitFor(() => expect(tabs().map(t => t.getAttribute('aria-label'))).toContain('Modifications · Otto'));
    const logo = within(tabOf('Modifications · Otto')).getByTitle('Anthropic');
    expect(logo.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(logo.querySelector('svg')).toHaveAttribute('width', '12');
    expect(tabOf('Modifications · Otto')).toHaveAccessibleName('Modifications · Otto');
  });

  it('a session deleted on a ready machine takes its « Modifications » tab with it', async () => {
    const { d, tree, user } = await mount();
    d.thread('otto', [{ kind: 'tool', id: 'w1', at: new Date().toISOString(), turn: 1, tool: 'Write', label: '/w/ledge/notes.md', status: 'success', files: [{ path: '/w/ledge/notes.md', change: 'write', diff: '+ Bonjour' }] }]);
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    const page = await waitFor(() => { const el = document.querySelector<HTMLElement>('.ide-pane .session-page[data-session$="otto"]'); expect(el).not.toBeNull(); return el!; });
    await user.click(await within(page).findByRole('button', { name: /\+1/ }));
    await waitFor(() => expect(tabs().map(t => t.getAttribute('aria-label'))).toContain('Modifications · Otto'));
    act(() => d.remove('otto'));
    await waitFor(() => expect(tabs().map(t => t.getAttribute('aria-label'))).toEqual(['Atelier']));
  });

  it('a lone tab has no « Fermer les autres »; Escape closes the menu', async () => {
    await mount();
    fireEvent.contextMenu(tabOf('Atelier'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Fermer l’onglet' })).toBeVisible();
    expect(within(menu).queryByRole('menuitem', { name: 'Fermer les autres' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /terminal/ })).toBeNull();
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

describe('the IDE bundle', () => {
  it('the reply as the mockup\'s box: its placeholder, no hint row, no send button (Enter sends); a seat says « rig send »', async () => {
    const { d, tree, user } = await mount();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    const page = () => document.querySelector<HTMLElement>('.ide-pane .session-page[data-session$="otto"]')!;
    const box = await waitFor(() => { const el = page()?.querySelector<HTMLTextAreaElement>('.session-reply textarea'); expect(el).toBeTruthy(); return el!; });
    expect(box).toHaveAttribute('placeholder', 'Répondre à Otto…  Entrée envoie, Maj+Entrée passe à la ligne');
    expect(page().querySelector('.reply-hint')).toBeNull();
    expect(within(page()).queryByRole('button', { name: 'Envoyer' })).toBeNull();
    await user.type(box, 'Bonjour{Enter}');
    await waitFor(() => expect(d.received.filter(m => m.type === 'session.reply')).toEqual([expect.objectContaining({ text: 'Bonjour' })]));
    // A seat (session.rig) is answered through « rig send ».
    act(() => d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', rig: { seat: 'dev@r', name: 'ledge-dev' } })));
    await waitFor(() => expect(page().querySelector('.session-reply textarea')).toHaveAttribute('placeholder', 'Répondre à Otto (rig send)…  Entrée envoie, Maj+Entrée passe à la ligne'));
  });

  it('in the IDE, once a note is typed during an approval, the hint says Enter denies with it', async () => {
    const { d, tree, user } = await mount();
    act(() => d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } })));
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    const page = () => document.querySelector<HTMLElement>('.ide-pane .session-page[data-session$="otto"]')!;
    const box = await waitFor(() => { const el = page()?.querySelector<HTMLTextAreaElement>('.session-reply textarea'); expect(el).toBeTruthy(); return el!; });
    expect(page().querySelector('.reply-hint')).toBeNull();
    await user.type(box, 'plutôt pnpm');
    await waitFor(() => expect(page().querySelector('.reply-hint')).toHaveTextContent('Entrée refuse avec ce message'));
  });

  it('in the IDE a hint that says why the field is shut stays', async () => {
    const { d, tree, user } = await mount();
    act(() => d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', tool: 'codex', state: 'waiting_input', pending: { kind: 'question', text: 'Quel port ?', options: ['8080', '3000'], source: 'hook' } })));
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    const hint = await waitFor(() => { const el = document.querySelector('.ide-pane .session-page[data-session$="otto"] .reply-hint'); expect(el).not.toBeNull(); return el!; });
    expect(hint).toHaveTextContent('Choisissez une des réponses proposées (1–9).');
  });

  it('« + » at the right of each tab strip opens the launch dialog', async () => {
    const { tree, user } = await mount();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    const plus = screen.getByRole('button', { name: 'Nouvelle session (N)' });
    expect(plus.closest('.dv-right-actions-container')).not.toBeNull();
    await user.click(plus);
    expect(await screen.findByRole('dialog', { name: 'Nouvelle session' })).toBeVisible();
  });

  it('the shell loads the IDE in a chunk of its own: App imports neither dockview nor the frame', () => {
    const app = readFileSync(resolve(__dirname, '../../src/App.tsx'), 'utf8');
    expect(app).not.toMatch(/from 'dockview/);
    expect(app).not.toMatch(/from '\.\/ide\/(IdeFrame|DockHost)'/);
    expect(readFileSync(resolve(__dirname, '../../src/ide/lazy.tsx'), 'utf8')).toMatch(/import\('\.\/IdeFrame'\)/);
    expect(readFileSync(resolve(__dirname, '../../src/ide/DockHost.tsx'), 'utf8')).toMatch(/dockview-react\/dist\/styles\/dockview\.css/);
  });
});

describe('split and the empty group (lot 3)', () => {
  const groupviews = () => [...document.querySelectorAll<HTMLElement>('.dv-groupview')];
  const splitKey = () => fireEvent.keyDown(window, { key: '\\', ctrlKey: true });

  it('Ctrl+\\ on Otto: a second group, empty and focused, offering « Terminal · Otto » first; its click opens Otto\'s terminal there', async () => {
    const { tree, user } = await mount();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    splitKey();
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    await waitFor(() => expect(groupviews()[1]).toHaveClass('dv-active-group'));
    const second = within(groupviews()[1]!);
    expect(second.getByRole('heading', { name: 'Groupe vide' })).toBeVisible();
    expect(second.getByText('Glisse un onglet ici, ouvre une session depuis l’explorateur, ou :')).toBeVisible();
    const buttons = second.getAllByRole('button').filter(b => b.closest('.ide-empty'));
    expect(buttons.map(b => b.textContent)).toEqual(['Terminal · Otto', 'Nouvelle session', 'OpenRig', 'Réglages', 'Atelier']);
    expect(buttons[0]).toHaveClass('pri');
    expect(second.getByText(/^Astuce : lie ce groupe/)).toHaveTextContent('Astuce : lie ce groupe (carré à gauche des onglets) avec celui de la session : il suivra la session choisie.');
    await user.click(buttons[0]!);
    await waitFor(() => expect(within(groupviews()[1]!).getByRole('tab', { name: '>_ Otto · tmux' })).toBeInTheDocument());
    expect(groupviews()).toHaveLength(2);
    expect(within(groupviews()[0]!).queryByRole('tab', { name: '>_ Otto · tmux' })).toBeNull();
  });

  it('split from the atelier: no « Terminal · … » and no tip; « Nouvelle session » opens the launch dialog, « Réglages » opens its tab in this group', async () => {
    const { user } = await mount();
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Atelier'));
    splitKey();
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    const second = () => within(groupviews()[1]!);
    expect(second().queryByRole('button', { name: /^Terminal/ })).toBeNull();
    expect(second().queryByText(/^Astuce/)).toBeNull();
    await user.click(second().getByRole('button', { name: 'Nouvelle session' }));
    expect(await screen.findByRole('dialog', { name: 'Nouvelle session' })).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nouvelle session' })).toBeNull());
    await user.click(second().getByRole('button', { name: 'Réglages' }));
    await waitFor(() => expect(second().getByRole('tab', { name: 'Réglages' })).toBeInTheDocument());
    expect(groupviews()).toHaveLength(2);
  });

  it('split from a seat: « Capture · Otto » first, which opens its read-only capture in the empty group', async () => {
    const ws: Workspace = { version: 1, windows: ['main'], focus: 'g2', next: 3, groups: [
      { id: 'g1', window: 'main', tabs: [{ kind: 'seat', ref: 'local:otto' }], active: 0, link: null },
      { id: 'g2', window: 'main', tabs: [], active: 0, link: null, from: 'local:otto' }
    ] };
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serialize(ws)));
    const { d, user } = await mount();
    act(() => d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', rig: { seat: 'dev@r', name: 'ledge-dev' } })));
    const second = () => within(groupviews()[1]!);
    await waitFor(() => expect(second().getAllByRole('button').filter(b => b.closest('.ide-empty')).map(b => b.textContent))
      .toEqual(['Capture · Otto', 'Nouvelle session', 'OpenRig', 'Réglages', 'Atelier']));
    expect(second().queryByRole('button', { name: 'Terminal · Otto' })).toBeNull();
    await user.click(second().getByRole('button', { name: 'Capture · Otto' }));
    await waitFor(() => expect(second().getByRole('tab', { name: '>_ Otto · tmux' })).toBeInTheDocument());
    await waitFor(() => expect(groupviews()[1]!.querySelector('.ide-term .chip-k')).toHaveTextContent('lecture seule'));
  });

  it('« Terminal · X » only while X is a known session', async () => {
    const { d, tree, user } = await mount();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    splitKey();
    await waitFor(() => expect(within(groupviews()[1]!).getByRole('button', { name: 'Terminal · Otto' })).toBeVisible());
    act(() => d.remove('otto'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Terminal · Otto' })).toBeNull());
  });

  it('the tab menu\'s « Diviser à droite » splits the tab\'s group', async () => {
    const { tree, user } = await mount();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    fireEvent.contextMenu(tabs().find(t => t.getAttribute('aria-label') === 'Otto')!);
    await user.click(within(await screen.findByRole('menu', { name: /Otto/ })).getByRole('menuitem', { name: /Diviser à droite/ }));
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    expect(within(groupviews()[1]!).getByRole('button', { name: 'Terminal · Otto' })).toBeVisible();
  });
});

describe('tab shortcuts and closing an empty group (lot 3 follow-up)', () => {
  const groupviews = () => [...document.querySelectorAll<HTMLElement>('.dv-groupview')];
  const ctrl = (key: string, more: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ctrlKey: true, ...more });
  const names = (g: HTMLElement) => within(g).queryAllByRole('tab').filter(t => t.closest('.dv-tabs-container')).map(t => t.getAttribute('aria-label'));
  async function withOtto() {
    const m = await mount();
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Atelier'));
    await m.user.click(m.tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    return m;
  }

  it('split, then Ctrl+W on the empty group: back to one group', async () => {
    await mount();
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Atelier'));
    ctrl('\\');
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    ctrl('w');
    await waitFor(() => expect(groupviews()).toHaveLength(1));
    expect(names(groupviews()[0]!)).toEqual(['Atelier']);
  });

  it('the empty group\'s « Fermer le groupe » closes it; the last group has none', async () => {
    const { user } = await mount();
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Atelier'));
    ctrl('\\');
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    expect(within(groupviews()[0]!).queryByRole('button', { name: /Fermer le groupe/ })).toBeNull();
    await user.click(within(groupviews()[1]!).getByRole('button', { name: 'Fermer le groupe (Ctrl+W)' }));
    await waitFor(() => expect(groupviews()).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /Fermer le groupe/ })).toBeNull();
  });

  it('Ctrl+W closes the active tab, Ctrl+Shift+T brings it back where it was', async () => {
    await withOtto();
    ctrl('w');
    await waitFor(() => expect(names(groupviews()[0]!)).toEqual(['Atelier']));
    ctrl('T', { shiftKey: true });
    await waitFor(() => expect(names(groupviews()[0]!)).toEqual(['Atelier', 'Otto']));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
  });

  it('Ctrl+Shift+T does not bring back the tab of a session deleted since: the tab closed before it comes back', async () => {
    const { d, tree, user } = await withOtto();
    await user.click(tree.getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Nova'));
    ctrl('w');                                                        // Nova
    await waitFor(() => expect(names(groupviews()[0]!)).toEqual(['Atelier', 'Otto']));
    ctrl('w');                                                        // Otto
    await waitFor(() => expect(names(groupviews()[0]!)).toEqual(['Atelier']));
    act(() => d.remove('otto'));
    await waitFor(() => expect(tree.queryByRole('button', { name: /^Otto/ })).toBeNull());
    ctrl('T', { shiftKey: true });
    await waitFor(() => expect(names(groupviews()[0]!)).toEqual(['Atelier', 'Nova']));
  });

  it('Ctrl+Tab cycles the focused group\'s tabs, Ctrl+Shift+Tab back', async () => {
    await withOtto();
    ctrl('Tab');
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Atelier'));
    ctrl('Tab');
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    ctrl('Tab', { shiftKey: true });
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Atelier'));
  });

  it('Ctrl+Alt+→ moves the active tab into a new group on the right; Ctrl+1 and Ctrl+2 focus the groups', async () => {
    await withOtto();
    ctrl('ArrowRight', { altKey: true });
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    expect(names(groupviews()[0]!)).toEqual(['Atelier']);
    expect(names(groupviews()[1]!)).toEqual(['Otto']);
    await waitFor(() => expect(groupviews()[1]).toHaveClass('dv-active-group'));
    fireEvent.keyDown(window, { key: '&', code: 'Digit1', ctrlKey: true });
    await waitFor(() => expect(groupviews()[0]).toHaveClass('dv-active-group'));
    fireEvent.keyDown(window, { key: 'é', code: 'Digit2', ctrlKey: true });
    await waitFor(() => expect(groupviews()[1]).toHaveClass('dv-active-group'));
  });
});
