import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { serialize } from '../../src/workspace/model';
import { WORKSPACE_KEY } from '../../src/workspace/store';
import { TermStore } from '../../src/term/store';
import { PROJECTS } from '../helpers';
import { LangProvider } from '../../src/i18n/lang';
import { BottomPanel } from '../../src/ide/BottomPanel';
import type { ShellRow, ShellsAvailable } from '../../src/term/shells';
import type { Panel } from '../../src/workspace/panel';

/** A deferred promise: what the tests below hold back (the shells' answer, the session page's chunk). */
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const env = vi.hoisted(() => ({ shells: null as Promise<unknown> | null, chunk: null as Promise<void> | null }));
vi.mock('../../src/tauri/bridge', async importActual => {
  const actual = await importActual<typeof import('../../src/tauri/bridge')>();
  return { ...actual, shellsAvailable: () => (env.shells ?? actual.shellsAvailable()) };
});
// The session page's chunk « not loaded yet » while `env.chunk` is pending.
vi.mock('../../src/session/lazy', async importActual => {
  const actual = await importActual<typeof import('../../src/session/lazy')>();
  return {
    ...actual,
    loadedWorkspace: () => (env.chunk ? undefined : actual.loadedWorkspace()),
    loadWorkspace: () => (env.chunk ? env.chunk.then(() => actual.loadWorkspace()) : actual.loadWorkspace())
  };
});

const ROWS: ShellRow[] = [
  { kind: 'wsl', label: 'WSL · Ubuntu', hint: 'par défaut', isDefault: true, section: 'local' },
  { kind: 'powershell', label: 'PowerShell', hint: '', isDefault: false, section: 'local' },
  { kind: 'ledge', label: 'Ledge', hint: 'ledge, rig', isDefault: false, section: 'ledge' }
];

function mount(panel: Panel, extra: Partial<Parameters<typeof BottomPanel>[0]> = {}) {
  const p = {
    panel, onTab: vi.fn(), outputCount: 3, output: <pre>les sorties</pre>, menu: ROWS, onNewShell: vi.fn(),
    tile: (ref: string) => <div>écran {ref}</div>, tileTitle: (ref: string) => `>_ ${ref}`, tileKind: () => 'shell',
    onClose: vi.fn(), onHide: vi.fn(), onDockDrop: vi.fn(), onRefused: vi.fn(), ...extra
  };
  render(<LangProvider lang="fr"><BottomPanel {...p} /></LangProvider>);
  return { p, user: userEvent.setup(), region: within(screen.getByRole('region', { name: 'Panneau du bas' })) };
}

describe('the bottom panel', () => {
  it('two terminals: two tiles side by side, « 2 » on Terminaux', () => {
    const { region } = mount({ terms: ['shell:1', 'shell:2'], tab: 'term' });
    expect(region.getByRole('tab', { name: /^Terminaux/ })).toHaveTextContent('2');
    const tiles = document.querySelectorAll('.ide-bterms > .ide-btile');
    expect(tiles).toHaveLength(2);
    const tab = (tiles[0] as HTMLElement).querySelector('.ide-btile-tab') as HTMLElement;
    expect(tab).toHaveAttribute('title', 'Glisser vers un groupe');
    expect(tab.querySelector('.tab-term')).toHaveTextContent('>_');
    expect(tab.querySelector('.tab-name')).toHaveTextContent('shell:1');
    expect(tab.querySelector('.ide-tab-x')).not.toBeNull();
    expect(within(tiles[1] as HTMLElement).getByText('écran shell:2')).toBeVisible();
    expect(within(tiles[1] as HTMLElement).getByText('shell')).toHaveClass('chip-k');
  });

  it('« + ▾ » opens the menu: its title, its sections, the default row; a row picked calls onNewShell', async () => {
    const { region, p, user } = mount({ terms: ['shell:1'], tab: 'term' });
    const plus = region.getByRole('button', { name: 'Nouveau terminal' });
    expect(plus).toHaveAttribute('title', 'Nouveau terminal : choisir le shell');
    await user.click(plus);
    const menu = within(screen.getByRole('menu', { name: 'Nouveau terminal' }));
    expect(menu.getByText('Locaux')).toBeVisible();
    expect(menu.getByText('Ledge', { selector: '.ide-shell-menu-h' })).toBeVisible();
    expect(menu.getByRole('menuitem', { name: /WSL · Ubuntu/ })).toHaveTextContent('par défaut');
    await user.click(menu.getByRole('menuitem', { name: /PowerShell/ }));
    expect(p.onNewShell).toHaveBeenCalledWith('powershell');
  });

  it('a tile\'s « × » calls onClose with its ref', async () => {
    const { p, user } = mount({ terms: ['shell:1', 'agent:otto'], tab: 'term' });
    const tile = document.querySelectorAll('.ide-btile')[1] as HTMLElement;
    await user.click(within(tile).getByRole('button', { name: 'Fermer' }));
    expect(p.onClose).toHaveBeenCalledWith('agent:otto');
  });

  it('Sortie shows the output and its count; « Masquer le panneau » calls onHide', async () => {
    const { region, p, user } = mount({ terms: ['shell:1'], tab: 'out' });
    expect(region.getByRole('tab', { name: /^Sortie/ })).toHaveTextContent('3');
    expect(region.getByText('les sorties')).toBeVisible();
    expect(region.queryByText('écran shell:1')).toBeNull();
    await user.click(region.getByRole('tab', { name: /^Terminaux/ }));
    expect(p.onTab).toHaveBeenCalledWith('term');
    await user.click(region.getByRole('button', { name: 'Masquer le panneau' }));
    expect(p.onHide).toHaveBeenCalled();
  });
});

describe('the bottom panel in the IDE (App)', () => {
  type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
  const daemons: Daemon[] = [];
  beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'fr'); });
  afterEach(async () => { env.shells = null; env.chunk = null; cleanup(); vi.restoreAllMocks(); for (const d of daemons.splice(0)) await d.close(); localStorage.clear(); });

  async function mountApp() {
    await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde()]);
   
    const d = await createMockDaemon(); daemons.push(d);
    d.machines([{ id: 'local', label: 'Local' }]);
    d.projects(PROJECTS);
    d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }));
    render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    const side = within(await screen.findByRole('complementary', { name: 'Barre latérale' }));
    await within(await side.findByRole('tree', { name: 'Projets, branches et sessions' })).findByRole('button', { name: /^Otto/ });
    return { user: userEvent.setup() };
  }
  const tiles = () => [...document.querySelectorAll<HTMLElement>('.ide-btile')];
  const ctrlJ = () => fireEvent.keyDown(window, { key: 'j', ctrlKey: true });

  it('shown empty, the panel opens one default shell, one only after quick toggles; closing the last one hides it and says so', async () => {
    const openFree = vi.spyOn(TermStore.prototype, 'openFree');
    const { user } = await mountApp();
    act(() => { ctrlJ(); });
    const bottom = within(await screen.findByRole('region', { name: 'Panneau du bas' }));
    await waitFor(() => expect(tiles()).toHaveLength(1));
    expect(tiles()[0]!.querySelector('.ide-btile-tab')).toHaveTextContent(/>_\s*WSL 1/);
    expect(bottom.getByRole('tab', { name: 'Terminaux' })).toHaveTextContent('1');
    act(() => { ctrlJ(); ctrlJ(); });
    await screen.findByRole('region', { name: 'Panneau du bas' });
    expect(tiles()).toHaveLength(1);
    expect(openFree).toHaveBeenCalledTimes(1);
    const closeFree = vi.spyOn(TermStore.prototype, 'closeFree');
    await user.click(within(tiles()[0]!).getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Panneau du bas' })).toBeNull());
    expect(closeFree).toHaveBeenCalledWith('shell:1');
    expect(await screen.findByText('Dernier terminal fermé : le panneau du bas se masque. Ctrl+J le rouvre avec un shell.')).toBeVisible();
  });

  it('« + ▾ » stacks the shell picked in the existing group, shows it, and makes it the default', async () => {
    (window as unknown as { __ledgeShells?: ShellsAvailable }).__ledgeShells = { wsl: 'Ubuntu', powershell: true, cmd: false, gitBash: false };
    try {
      const { user } = await mountApp();
      act(() => { ctrlJ(); });
      await waitFor(() => expect(tiles()).toHaveLength(1));
      await user.click(screen.getByRole('button', { name: 'Nouveau terminal' }));
      await user.click(within(screen.getByRole('menu', { name: 'Nouveau terminal' })).getByRole('menuitem', { name: /PowerShell/ }));
      await waitFor(() => expect(tiles()).toHaveLength(1));
      const tabs = [...tiles()[0]!.querySelectorAll('.ide-btile-tab')];
      expect(tabs).toHaveLength(2);
      expect(tabs[1]).toHaveTextContent(/>_\s*PowerShell 2/);
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
      expect(localStorage.getItem('ledge.ide.lastShell')).toBe('powershell');
      await user.click(screen.getByRole('button', { name: 'Nouveau terminal' }));
      expect(within(screen.getByRole('menu', { name: 'Nouveau terminal' })).getByRole('menuitem', { name: /PowerShell/ })).toHaveTextContent('par défaut');
    } finally { delete (window as unknown as { __ledgeShells?: ShellsAvailable }).__ledgeShells; }
  });

  it('the empty group\'s « Terminal » opens a shell tab there; its × kills the shell; a shell tab from the last run goes', async () => {
    const ws = { version: 1 as const, windows: ['main'], focus: 'g1', next: 3, groups: [
      { id: 'g1', window: 'main', tabs: [{ kind: 'atelier' as const, ref: 'main' }], active: 0, link: null },
      { id: 'g2', window: 'main', tabs: [{ kind: 'terminal' as const, ref: 'shell:4' }], active: 0, link: null }
    ] };
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serialize(ws)));
    const { user } = await mountApp();
    const groups = () => [...document.querySelectorAll<HTMLElement>('.dv-groupview')];
    await waitFor(() => expect(groups()).toHaveLength(1));
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
    await waitFor(() => expect(groups()).toHaveLength(2));
    const closeFree = vi.spyOn(TermStore.prototype, 'closeFree');
    await user.click(within(groups()[1]!).getByRole('button', { name: 'Terminal' }));
    const tab = await within(groups()[1]!).findByRole('tab', { name: '>_ WSL 1' });
    expect(tab).toBeInTheDocument();
    expect(within(groups()[1]!).getByText('shell')).toHaveClass('chip-k');
    await user.click(screen.getByRole('button', { name: 'Fermer >_ WSL 1' }));
    await waitFor(() => expect(closeFree).toHaveBeenCalledWith('shell:1'));
  });

  it('shown before the shells are known: no shell yet; once they are, exactly one, of the kind last chosen', async () => {
    const openFree = vi.spyOn(TermStore.prototype, 'openFree');
    localStorage.setItem('ledge.ide.lastShell', 'powershell');
    const shells = deferred<ShellsAvailable>();
    env.shells = shells.promise;
    await mountApp();
    act(() => { ctrlJ(); });
    await screen.findByRole('region', { name: 'Panneau du bas' });
    act(() => { ctrlJ(); });
    act(() => { ctrlJ(); });
    await screen.findByRole('region', { name: 'Panneau du bas' });
    expect(openFree).not.toHaveBeenCalled();
    expect(tiles()).toHaveLength(0);
    await act(async () => { shells.resolve({ wsl: 'Ubuntu', powershell: true, cmd: false, gitBash: false }); });
    await waitFor(() => expect(tiles()).toHaveLength(1));
    expect(openFree).toHaveBeenCalledTimes(1);
    expect(openFree).toHaveBeenCalledWith('powershell', '');
    expect(tiles()[0]!.querySelector('.ide-btile-tab')).toHaveTextContent(/>_\s*PowerShell 1/);
  });

  it('the chunk still loading: toggles in separate acts open one shell only', async () => {
    const openFree = vi.spyOn(TermStore.prototype, 'openFree');
    await mountApp();
    const chunk = deferred<void>();
    env.chunk = chunk.promise;
    act(() => { ctrlJ(); });
    await screen.findByRole('region', { name: 'Panneau du bas' });
    act(() => { ctrlJ(); });
    act(() => { ctrlJ(); });
    await screen.findByRole('region', { name: 'Panneau du bas' });
    expect(tiles()).toHaveLength(0);
    env.chunk = null;
    await act(async () => { chunk.resolve(); await chunk.promise; });
    await waitFor(() => expect(tiles()).toHaveLength(1));
    expect(openFree).toHaveBeenCalledTimes(1);
  });

  it('hidden while its default shell opened: the panel stays hidden, and shows that shell when asked again', async () => {
    const openFree = vi.spyOn(TermStore.prototype, 'openFree');
    await mountApp();
    const chunk = deferred<void>();
    env.chunk = chunk.promise;
    act(() => { ctrlJ(); });
    await screen.findByRole('region', { name: 'Panneau du bas' });
    act(() => { ctrlJ(); });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Panneau du bas' })).toBeNull());
    env.chunk = null;
    await act(async () => { chunk.resolve(); await chunk.promise; });
    await waitFor(() => expect(openFree).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('region', { name: 'Panneau du bas' })).toBeNull();
    act(() => { ctrlJ(); });
    await waitFor(() => expect(tiles()).toHaveLength(1));
    expect(openFree).toHaveBeenCalledTimes(1);
  });

  it('the empty group\'s « Terminal » opens in the folder of the session it was split from', async () => {
    const openFree = vi.spyOn(TermStore.prototype, 'openFree');
    const { user } = await mountApp();
    const side = within(screen.getByRole('complementary', { name: 'Barre latérale' }));
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    const groups = () => [...document.querySelectorAll<HTMLElement>('.dv-groupview')];
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
    await waitFor(() => expect(groups()).toHaveLength(2));
    await user.click(within(groups()[1]!).getByRole('button', { name: 'Terminal' }));
    await waitFor(() => expect(openFree).toHaveBeenCalledWith('wsl', '/w/ledge'));
  });
});
