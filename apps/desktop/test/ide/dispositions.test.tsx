import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../../src/fleet/useFleet';
import { App } from '../../src/App';
import { loadWorkspace } from '../../src/session/lazy';
import { loadSettings } from '../../src/settings/lazy';
import { loadChat } from '../../src/chat/lazy';
import { loadIde } from '../../src/ide/lazy';
import { loadComposer } from '../../src/launch/lazy';
import { BOOT_KEY, capture, loadCurrent, loadDispositions, saveDispositions } from '../../src/workspace/dispositions';
import { empty, open as openTab } from '../../src/workspace/model';
import { WORKSPACE_KEY } from '../../src/workspace/store';
import { PROJECTS } from '../helpers';

/** Lot 10: the status bar's « Dispositions » menu and the palette (`@`, `>`). */
type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'fr'); });
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); localStorage.clear(); });

async function mount() {
  await Promise.all([loadWorkspace(), loadSettings(), loadChat(), loadIde(), loadComposer()]);
 
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
const layButton = () => screen.getByRole('button', { name: /^Dispositions : /, expanded: false });
const layMenu = () => within(screen.getByRole('menu', { name: 'Dispositions' }));
const options = () => within(screen.getByRole('listbox', { name: 'Résultats' })).getAllByRole('option');
const toast = (text: string) => screen.findByText(text);

/** Opens Otto's tab, then saves the workspace as `name` from the status bar. */
async function saveAs(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(layButton());
  await user.click(layMenu().getByRole('menuitem', { name: /^Enregistrer (la disposition actuelle|sous un nouveau nom)…$/ }));
  await user.type(screen.getByRole('textbox', { name: 'Nom de la disposition' }), `${name}{Enter}`);
}

describe('the status bar’s « Dispositions »', () => {
  it('before any is saved: « Disposition » in grey, a menu that says so', async () => {
    const { user } = await mount();
    expect(layButton()).toHaveAccessibleName('Dispositions : Disposition');
    expect(layButton()).toHaveClass('none');
    expect(layButton()).toHaveAttribute('title', 'Aucune disposition enregistrée');
    await user.click(layButton());
    expect(screen.getByText('Aucune disposition enregistrée.')).toBeVisible();
    expect(layMenu().queryAllByRole('menuitem').map(x => x.textContent)).toEqual(['Enregistrer la disposition actuelle…', 'Gérer les dispositionsRéglages']);
  });

  it('saves the workspace under a trimmed name (empty: nothing), then applies it back', async () => {
    const { side, user } = await mount();
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(tabs()).toEqual(['Otto']));
    await user.click(layButton());
    await user.click(layMenu().getByRole('menuitem', { name: 'Enregistrer la disposition actuelle…' }));
    const field = screen.getByRole('textbox', { name: 'Nom de la disposition' });
    expect(field).toHaveFocus();
    await user.type(field, '   {Enter}');
    expect(loadDispositions()).toEqual([]);
    await user.type(field, ' Revue {Enter}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Dispositions' })).toBeNull());
    expect(loadDispositions().map(x => x.name)).toEqual(['Revue']);
    expect(loadCurrent()?.name).toBe('Revue');
    expect(await toast('Disposition « Revue » enregistrée')).toBeVisible();
    expect(layButton()).toHaveAccessibleName('Dispositions : Revue');

    await user.click(side.getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(tabs()).toContain('Nova'));
    await user.click(layButton());
    await user.click(layMenu().getByRole('menuitem', { name: /^Revue/ }));
    await waitFor(() => expect(tabs()).toEqual(['Otto']));
    expect(await toast('Disposition « Revue »')).toBeVisible();
    expect(JSON.parse(JSON.parse(localStorage.getItem(WORKSPACE_KEY)!)).groups[0].tabs.map((t: { ref: string }) => t.ref)).toEqual(['local:otto']);
  });

  it('changed since applied: its name and a « • », « Enregistrer dans « X » » updates it without a question', async () => {
    const { side, user } = await mount();
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(tabs()).toEqual(['Otto']));
    await saveAs(user, 'Revue');
    await waitFor(() => expect(layButton()).toHaveAccessibleName('Dispositions : Revue'));
    await user.click(side.getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(layButton()).toHaveAccessibleName('Dispositions : Revue (modifiée)'));
    expect(layButton()).toHaveAttribute('title', 'Modifiée depuis qu’elle a été appliquée');
    expect(layButton()).toHaveTextContent('Revue•▴');
    await user.click(layButton());
    expect(layMenu().getByRole('menuitem', { name: /^Revue/ })).toHaveTextContent('1 groupe · actuelle · modifiée');
    expect(layMenu().queryAllByRole('menuitem').map(x => x.textContent)).toEqual(['Revue1 groupe · actuelle · modifiée', 'Enregistrer dans « Revue »', 'Enregistrer sous un nouveau nom…', 'Gérer les dispositionsRéglages']);
    await user.click(layMenu().getByRole('menuitem', { name: 'Enregistrer dans « Revue »' }));
    expect(await toast('Disposition « Revue » remplacée')).toBeVisible();
    expect(layButton()).toHaveAccessibleName('Dispositions : Revue');
    expect(loadDispositions()[0]!.ws.groups.flatMap(g => g.tabs.map(t => t.ref))).toContain('local:nova');
  });

  it('a name taken: the field says so in amber, a second Enter replaces, another name clears it', async () => {
    const { side, user } = await mount();
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    await saveAs(user, 'Revue');
    await user.click(layButton());
    await user.click(layMenu().getByRole('menuitem', { name: 'Enregistrer sous un nouveau nom…' }));
    const field = screen.getByRole('textbox', { name: 'Nom de la disposition' });
    await user.type(field, 'Revue{Enter}');
    const hint = () => document.querySelector('.ide-lay-hint');
    expect(hint()).toHaveTextContent('« Revue » existe déjà : Entrée pour la remplacer.');
    expect(hint()).toHaveAttribute('role', 'alert');
    expect(field).toHaveClass('warn');
    await user.type(field, 'x');
    expect(hint()).toBeNull();
    await user.type(field, '{Backspace}{Enter}');
    expect(hint()).toBeVisible();
    await user.type(field, '{Enter}');
    expect(await toast('Disposition « Revue » remplacée')).toBeVisible();
    expect(loadDispositions().map(x => x.name)).toEqual(['Revue']);
  });

  it('applied with a session gone: that tab only stays out, and a toast counts it', async () => {
    const { d, side, user } = await mount();
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    await user.click(side.getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(tabs()).toEqual(expect.arrayContaining(['Otto', 'Nova'])));
    await saveAs(user, 'Deux');
    d.remove('nova');
    await waitFor(() => expect(tabs()).not.toContain('Nova'));
    await user.click(layButton());
    await user.click(layMenu().getByRole('menuitem', { name: /^Deux/ }));
    expect(await toast('« Deux » : 1 onglet n’est pas rouvert, sa session ou son rig n’existe plus.')).toBeVisible();
    expect(tabs()).toEqual(['Otto']);
  });

  it('applied with a rig deleted on a machine still there: that rig\'s tab stays out (the board, review E1); a stopped rig stays', async () => {
    const { d, user } = await mount();
    // OpenRig runs on the machine and lists « kept » (stopped), not « gone ».
    const rig = (name: string) => ({ id: name, name, status: 'stopped', lifecycleState: 'stopped', seats: 0, running: 0, attention: 0, uptime: null, snapshot: null, nodes: [] });
    d.onMessage(m => {
      if (m.type === 'openrig.status') d.reply({ type: 'openrig.state', requestId: m.requestId, machineId: m.machineId ?? 'local', state: { installed: true, daemon: { state: 'running' }, kernel: { state: 'ready' }, rigs: [rig('kept')], at: '2026-11-09T12:00:00.000Z' } } as never);
    });
    const ws = openTab(openTab(empty(), { kind: 'rig', ref: 'local:kept' }, 'active'), { kind: 'rig', ref: 'local:gone' }, 'active');
    saveDispositions([capture('Rigs', ws, { bottom: false, right: true })]);
    await user.click(layButton());
    await user.click(layMenu().getByRole('menuitem', { name: /^Rigs/ }));
    expect(await toast('« Rigs » : 1 onglet n’est pas rouvert, sa session ou son rig n’existe plus.')).toBeVisible();
    expect(JSON.parse(JSON.parse(localStorage.getItem(WORKSPACE_KEY)!)).groups.flatMap((g: { tabs: { ref: string }[] }) => g.tabs.map(t => t.ref))).toEqual(['local:kept']);
  });

  it('« Gérer les dispositions » opens Settings › Espace de travail', async () => {
    const { user } = await mount();
    await user.click(layButton());
    await user.click(screen.getByRole('menuitem', { name: /Gérer les dispositions/ }));
    await waitFor(() => expect(document.querySelector('.ide-dock [role="tab"][aria-label="Réglages"]')).not.toBeNull());
    expect(await screen.findByRole('heading', { name: 'Espace de travail' })).toBeVisible();
  });
});

describe('Settings › Espace de travail', () => {
  async function openSection(user: ReturnType<typeof userEvent.setup>) {
    await user.click(layButton());
    await user.click(screen.getByRole('menuitem', { name: /Gérer les dispositions/ }));
    await screen.findByRole('heading', { name: 'Espace de travail' });
    return within(screen.getByRole('radiogroup', { name: 'Au démarrage' }));
  }

  it('« Au démarrage »: « La disposition » greyed until one is saved; then chosen in its list', async () => {
    const { user } = await mount();
    let boot = await openSection(user);
    expect(boot.getByRole('radio', { name: 'La dernière disposition' })).toBeChecked();
    expect(boot.getByRole('radio', { name: /^La disposition/ })).toBeDisabled();
    expect(screen.getByText('Enregistrez d’abord une disposition.')).toBeVisible();
    await saveAs(user, 'Revue');
    await saveAs(user, 'Terminaux');
    boot = within(screen.getByRole('radiogroup', { name: 'Au démarrage' }));
    await user.click(boot.getByRole('radio', { name: /^La disposition/ }));
    expect(JSON.parse(localStorage.getItem(BOOT_KEY)!)).toEqual({ kind: 'fixed', name: 'Revue' });
    await user.selectOptions(boot.getByRole('combobox', { name: 'Disposition ouverte au démarrage' }), 'Terminaux');
    expect(JSON.parse(localStorage.getItem(BOOT_KEY)!)).toEqual({ kind: 'fixed', name: 'Terminaux' });
    await user.click(boot.getByRole('radio', { name: 'L’atelier seul' }));
    expect(JSON.parse(localStorage.getItem(BOOT_KEY)!)).toEqual({ kind: 'atelier' });
  });

  it('lists the dispositions with their shape; « Supprimer » the one chosen at start: the setting says so', async () => {
    const { side, user } = await mount();
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    await saveAs(user, 'Revue');
    const boot = await openSection(user);
    await user.click(boot.getByRole('radio', { name: /^La disposition/ }));
    const list = within(screen.getByRole('list', { name: 'Dispositions' }));
    expect(list.getByRole('listitem')).toHaveTextContent('Revue1 groupe');
    await user.click(list.getByRole('button', { name: 'Supprimer « Revue »' }));
    expect(loadDispositions()).toEqual([]);
    expect(loadCurrent()).toBeNull();
    expect(screen.getByText('« Revue » a été supprimée : Ledge rouvre la dernière disposition.')).toBeVisible();
    expect(within(screen.getByRole('radiogroup', { name: 'Au démarrage' })).getByRole('radio', { name: 'La dernière disposition' })).toBeChecked();
    expect(layButton()).toHaveAccessibleName('Dispositions : Disposition');
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
    expect(names().slice(0, 3)).toEqual(['@ Nova' + names()[0]!.slice(6), '› Nouvelle session', '› Lancer un rig…']);
    await user.type(input, '@');
    expect(names().every(n => n!.startsWith('@ '))).toBe(true);
    await user.clear(input); await user.type(input, '>regl');
    expect(names()).toEqual(['› Ouvrir les réglages']);
    await user.clear(input); await user.type(input, '>openrig');
    expect(names()).toEqual(['Vue d’ensemble', 'Rigs', 'Rôles', 'Machines', 'Daemon', 'Sortie'].map(x => `› OpenRig : ${x}`));
    await user.clear(input); await user.type(input, 'zzz');
    expect(screen.getByText('Rien ne correspond.')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Palette' })).toBeNull();
  });

  it('« Enregistrer la disposition… » opens the status bar’s menu on its field; « Disposition : X » applies X', async () => {
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
