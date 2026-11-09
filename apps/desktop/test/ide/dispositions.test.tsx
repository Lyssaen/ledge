import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../../src/fleet/useFleet';
import { App } from '../../src/App';
import { loadWorkspace } from '../../src/session/lazy';
import { loadSettings } from '../../src/settings/lazy';
import { loadHome, loadChat } from '../../src/chat/lazy';
import { loadIde } from '../../src/ide/lazy';
import { loadComposer } from '../../src/launch/lazy';
import { saveIdeEnabled } from '../../src/workspace/prefs';
import { CURRENT_KEY, loadDispositions } from '../../src/workspace/dispositions';
import { WORKSPACE_KEY } from '../../src/workspace/store';
import { PROJECTS } from '../helpers';

/** Lot 10: the status bar's « Dispositions » menu and the palette (`@`, `>`). */
type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'fr'); });
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); saveIdeEnabled(false); localStorage.clear(); });

async function mount() {
  await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde(), loadComposer()]);
  saveIdeEnabled(true);
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }]);
  d.projects(PROJECTS);
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }));
  d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'waiting_input' }));
  d.thread('otto', []); d.thread('nova', []);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  const side = within(await screen.findByRole('complementary', { name: 'Barre latérale' }));
  await side.findByRole('button', { name: /^Otto/ });
  return { d, side, user: userEvent.setup() };
}

const tabs = () => [...document.querySelectorAll('.ide-dock [role="tab"]')].map(x => x.getAttribute('aria-label'));
const layButton = () => screen.getByRole('button', { name: /Dispositions/, expanded: false });
const options = () => within(screen.getByRole('listbox', { name: 'Résultats' })).getAllByRole('option');

describe('the status bar’s « Dispositions »', () => {
  it('saves the current workspace under a name, then applies it back', async () => {
    const { side, user } = await mount();
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(tabs()).toEqual(['Otto']));
    // Nothing saved yet: the button says « Dispositions », the menu only offers to save and to manage.
    await user.click(layButton());
    const menu = within(screen.getByRole('menu', { name: 'Dispositions' }));
    expect(menu.queryAllByRole('menuitem').map(x => x.textContent)).toEqual(['Enregistrer la disposition actuelle…', 'Gérer les dispositionsRéglages']);
    await user.click(menu.getByRole('menuitem', { name: 'Enregistrer la disposition actuelle…' }));
    const field = screen.getByRole('textbox', { name: 'Nom de la disposition' });
    expect(field).toHaveFocus();
    await user.type(field, '   {Enter}');
    expect(loadDispositions()).toEqual([]);
    await user.type(field, ' Revue {Enter}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Dispositions' })).toBeNull());
    expect(loadDispositions().map(x => x.name)).toEqual(['Revue']);
    expect(JSON.parse(localStorage.getItem(CURRENT_KEY)!)).toBe('Revue');
    expect(screen.getByText('Disposition « Revue » enregistrée')).toBeVisible();
    expect(screen.getByRole('button', { name: /Revue/, expanded: false })).toBeVisible();

    // Another tab, then « Revue » again: Otto alone, as saved.
    await user.click(side.getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(tabs()).toContain('Nova'));
    await user.click(screen.getByRole('button', { name: /Revue/, expanded: false }));
    const item = within(screen.getByRole('menu', { name: 'Dispositions' })).getByRole('menuitem', { name: /^Revue/ });
    expect(item).toHaveTextContent('1 groupe · actuelle');
    await user.click(item);
    await waitFor(() => expect(tabs()).toEqual(['Otto']));
    expect(JSON.parse(JSON.parse(localStorage.getItem(WORKSPACE_KEY)!)).groups[0].tabs.map((t: { ref: string }) => t.ref)).toEqual(['local:otto']);
  });

  it('« Gérer les dispositions » opens Settings › Espace de travail', async () => {
    const { user } = await mount();
    await user.click(layButton());
    await user.click(screen.getByRole('menuitem', { name: /Gérer les dispositions/ }));
    await waitFor(() => expect(document.querySelector('.ide-dock [role="tab"][aria-label="Réglages"]')).not.toBeNull());
    expect(await screen.findByRole('heading', { name: 'Espace de travail' })).toBeVisible();
  });
});

describe('the IDE palette (Ctrl K)', () => {
  it('lists the waiting session first, then the commands, then the others; @ and > narrow it', async () => {
    const { user } = await mount();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Control>}k{/Control}');
    const input = within(screen.getByRole('dialog', { name: 'Palette' })).getByRole('combobox');
    expect(input).toHaveFocus();
    const names = () => options().map(o => o.textContent);
    expect(names()[0]).toMatch(/^@ Nova/);
    expect(names()[1]).toBe('› Nouvelle session');
    expect(names().at(-1)).toMatch(/^@ Otto/);
    await user.type(input, '@');
    expect(names().every(n => n!.startsWith('@ '))).toBe(true);
    await user.clear(input); await user.type(input, '>regl');
    expect(names()).toEqual(['› Ouvrir les réglages']);
    await user.clear(input); await user.type(input, 'zzz');
    expect(screen.getByText('Rien ne correspond.')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Palette' })).toBeNull();
  });

  it('« Enregistrer la disposition » opens the status bar’s menu on its field; « Disposition : X » applies X', async () => {
    const { side, user } = await mount();
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(tabs()).toEqual(['Otto']));
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('>enregistrer{Enter}');
    const field = await screen.findByRole('textbox', { name: 'Nom de la disposition' });
    await waitFor(() => expect(field).toHaveFocus());
    await user.type(field, 'Seul{Enter}');
    await user.click(side.getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(tabs()).toContain('Nova'));
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('>disposition :');
    expect(options().map(o => o.textContent)).toEqual(['› Disposition : Seulactuelle']);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(tabs()).toEqual(['Otto']));
  });
});
