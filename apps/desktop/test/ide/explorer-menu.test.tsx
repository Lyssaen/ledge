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
import { loadOpenSession, saveOpenSession } from '../../src/workspace/openPrefs';
import { PROJECTS } from '../helpers';
import type { Workspace } from '../../src/workspace/model';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'fr'); });
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); saveIdeEnabled(false); saveOpenSession('active'); localStorage.clear(); });

/** `seat`: Pim, a seat of the rig ledge-dev (the rigs view lists it, not the tree). */
async function mount({ ide = true, seat = false }: { ide?: boolean; seat?: boolean } = {}) {
  await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde()]);
  if (ide) saveIdeEnabled(true);
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }]);
  d.projects(PROJECTS);
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }));
  d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'working' }));
  if (seat) d.upsert(fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working', rig: { seat: 'dev@r', name: 'ledge-dev' } }));
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  const side = within(await screen.findByRole('complementary', { name: 'Barre latérale' }));
  const tree = within(await side.findByRole('tree', { name: 'Projets, branches et sessions' }));
  await tree.findByRole('button', { name: /^Otto/ });
  return { d, side, tree, user: userEvent.setup() };
}

const stored = (): Workspace => JSON.parse(JSON.parse(localStorage.getItem('ledge.ide.workspace')!)) as Workspace;
const refs = (w: Workspace) => w.groups.map(g => g.tabs.map(t => `${t.kind}:${t.ref.replace(/^local:/, '').replace(/^agent:local:/, 'agent:')}`));
/** The rigs view of the explorer, where the seats are. */
async function rigsView(side: ReturnType<typeof within>) {
  fireEvent.click(screen.getByRole('button', { name: 'Rigs OpenRig' }));
  return side.findByRole('button', { name: /^Pim/ });
}
const menu = () => within(screen.getByRole('menu'));
const labels = () => menu().getAllByRole('menuitem').map(i => i.getAttribute('aria-label'));

describe('the explorer\'s session menu in the IDE', () => {
  it('on Otto: « Ouvrir », « Ouvrir à droite », then « Son terminal », with their hints; then today\'s entries; nothing of later lots', async () => {
    const { tree } = await mount();
    fireEvent.contextMenu(tree.getByRole('button', { name: /^Otto/ }));
    const items = labels();
    expect(items.slice(0, 3)).toEqual(['Ouvrir', 'Ouvrir à droite', 'Son terminal']);
    expect(items).toContain('Renommer…');
    expect(items).toContain('Supprimer…');
    expect(items).not.toContain('Ouvrir la session');
    expect(items).not.toContain('Capture dans un terminal');
    expect(items).not.toContain('Envoyer un message…');
    expect(items.join(' ')).not.toMatch(/nouvelle fenêtre|éditeur|Redémarrer/i);
    expect(menu().getByRole('menuitem', { name: 'Ouvrir' })).toHaveTextContent('Entrée');
    expect(menu().getByRole('menuitem', { name: 'Ouvrir à droite' })).toHaveTextContent('Ctrl clic');
  });

  it('on a seat: « Capture dans un terminal » and « Envoyer un message… »', async () => {
    const { side } = await mount({ seat: true });
    fireEvent.contextMenu(await rigsView(side));
    const items = labels();
    expect(items.slice(0, 4)).toEqual(['Ouvrir', 'Ouvrir à droite', 'Capture dans un terminal', 'Envoyer un message…']);
    expect(items).not.toContain('Son terminal');
    expect(items.join(' ')).not.toMatch(/nouvelle fenêtre|éditeur|Redémarrer/i);
  });

  it('« Ouvrir à droite » opens the session in a group on the right', async () => {
    const { tree, user } = await mount();
    fireEvent.contextMenu(tree.getByRole('button', { name: /^Otto/ }));
    await user.click(menu().getByRole('menuitem', { name: 'Ouvrir à droite' }));
    await waitFor(() => expect(refs(stored())).toEqual([['atelier:main'], ['session:otto']]));
  });

  it('« Son terminal » opens the agent\'s terminal tab beside the focused group, linked', async () => {
    const { tree, user } = await mount();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(refs(stored())).toEqual([['atelier:main', 'session:otto']]));
    fireEvent.contextMenu(tree.getByRole('button', { name: /^Otto/ }));
    await user.click(menu().getByRole('menuitem', { name: 'Son terminal' }));
    await waitFor(() => expect(refs(stored())).toEqual([['atelier:main', 'session:otto'], ['terminal:agent:otto']]));
    const w = stored();
    expect(w.groups[0]!.link).not.toBeNull();
    expect(w.groups[1]!.link).toBe(w.groups[0]!.link);
  });

  it('« Envoyer un message… » opens the seat, its reply focused', async () => {
    const { side, user } = await mount({ seat: true });
    fireEvent.contextMenu(await rigsView(side));
    await user.click(menu().getByRole('menuitem', { name: 'Envoyer un message…' }));
    await waitFor(() => expect(refs(stored())).toEqual([['atelier:main', 'seat:pim']]));
    await waitFor(() => expect(document.activeElement?.closest('.ide-pane')).not.toBeNull());
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
  });

  it('switched off, the menu is today\'s: « Ouvrir la session », no IDE entries', async () => {
    const { side } = await mount({ ide: false });
    fireEvent.contextMenu(side.getByRole('button', { name: /^Otto/ }));
    const items = labels();
    expect(items[0]).toBe('Ouvrir la session');
    expect(items).not.toContain('Ouvrir');
    expect(items).not.toContain('Ouvrir à droite');
    expect(items).not.toContain('Son terminal');
  });
});

describe('Ctrl+click and « Ouvrir une session »', () => {
  it('Ctrl+click on Nova in the tree opens it in a group on the right', async () => {
    const { tree } = await mount();
    fireEvent.click(tree.getByRole('button', { name: /^Nova/ }), { ctrlKey: true });
    await waitFor(() => expect(refs(stored())).toEqual([['atelier:main'], ['session:nova']]));
  });

  it('⌘+click on a seat of the rigs view opens it on the right', async () => {
    const { side } = await mount({ seat: true });
    fireEvent.click(await rigsView(side), { metaKey: true });
    await waitFor(() => expect(refs(stored())).toEqual([['atelier:main'], ['seat:pim']]));
  });

  it('Ctrl+click on a seat of the atelier opens it on the right', async () => {
    await mount();
    const seat = await screen.findByRole('button', { name: /^Otto,/ });
    fireEvent.click(seat, { ctrlKey: true });
    await waitFor(() => expect(refs(stored())).toEqual([['atelier:main'], ['session:otto']]));
  });

  it('Settings › Espace de travail: « À droite » makes a plain click open on the right, and is read again after a reload', async () => {
    const { user } = await mount();
    await user.keyboard('{Control>},{/Control}');
    const nav = within(await screen.findByRole('navigation', { name: 'Sections des réglages' }));
    expect(nav.getAllByRole('button').map(b => b.textContent).slice(0, 2)).toEqual(['Général', 'Espace de travail']);
    await user.click(nav.getByRole('button', { name: 'Espace de travail' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Espace de travail' })).toBeVisible();
    const group = screen.getByRole('radiogroup', { name: 'Ouvrir une session' });
    expect(within(group).getAllByRole('radio').map(r => r.closest('label')!.textContent)).toEqual(['Dans le groupe actif', 'À droite']);
    expect(within(group).getByRole('radio', { name: 'Dans le groupe actif' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'À droite' }));
    expect(loadOpenSession()).toBe('right');
    expect(await screen.findByText(/Réglage enregistré · /)).toBeVisible();
    // A reload: the app mounts again on what was stored.
    cleanup();
    localStorage.removeItem('ledge.ide.workspace');
    const { tree, user: u2 } = await mount();
    await u2.click(tree.getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(refs(stored())).toEqual([['atelier:main'], ['session:nova']]));
  });

  it('switched off, Settings has no Espace de travail section', async () => {
    const { user } = await mount({ ide: false });
    await user.keyboard('{Control>},{/Control}');
    const nav = within(await screen.findByRole('navigation', { name: 'Sections des réglages' }));
    expect(nav.queryByRole('button', { name: 'Espace de travail' })).toBeNull();
    act(() => saveIdeEnabled(true));
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Sections des réglages' })).getByRole('button', { name: 'Espace de travail' })).toBeVisible());
  });
});
