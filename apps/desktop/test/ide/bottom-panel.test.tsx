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
import { saveIdeEnabled } from '../../src/workspace/prefs';
import { serialize } from '../../src/workspace/model';
import { WORKSPACE_KEY } from '../../src/workspace/store';
import { TermStore } from '../../src/term/store';
import { PROJECTS } from '../helpers';
import { LangProvider } from '../../src/i18n/lang';
import { BottomPanel } from '../../src/ide/BottomPanel';
import type { ShellRow, ShellsAvailable } from '../../src/term/shells';
import type { Panel } from '../../src/workspace/panel';

const ROWS: ShellRow[] = [
  { kind: 'wsl', label: 'WSL · Ubuntu', hint: 'par défaut', isDefault: true, section: 'local' },
  { kind: 'powershell', label: 'PowerShell', hint: '', isDefault: false, section: 'local' },
  { kind: 'ledge', label: 'Ledge', hint: 'ledge, rig', isDefault: false, section: 'ledge' }
];

function mount(panel: Panel, extra: Partial<Parameters<typeof BottomPanel>[0]> = {}) {
  const p = {
    panel, onTab: vi.fn(), outputCount: 3, output: <pre>les sorties</pre>, menu: ROWS, onNewShell: vi.fn(),
    tile: (ref: string) => <div>écran {ref}</div>, tileTitle: (ref: string) => `>_ ${ref}`, tileKind: () => 'shell',
    onClose: vi.fn(), onHide: vi.fn(), ...extra
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
    expect(within(tiles[0] as HTMLElement).getByText('>_ shell:1')).toHaveAttribute('title', 'Glisser vers un groupe');
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
  afterEach(async () => { cleanup(); vi.restoreAllMocks(); for (const d of daemons.splice(0)) await d.close(); saveIdeEnabled(false); localStorage.clear(); });

  async function mountApp() {
    await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde()]);
    saveIdeEnabled(true);
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
    expect(within(tiles()[0]!).getByText('>_ WSL 1')).toBeVisible();
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

  it('« + ▾ » adds the shell picked beside the first and makes it the default', async () => {
    (window as unknown as { __ledgeShells?: ShellsAvailable }).__ledgeShells = { wsl: 'Ubuntu', powershell: true, cmd: false, gitBash: false };
    try {
      const { user } = await mountApp();
      act(() => { ctrlJ(); });
      await waitFor(() => expect(tiles()).toHaveLength(1));
      await user.click(screen.getByRole('button', { name: 'Nouveau terminal' }));
      await user.click(within(screen.getByRole('menu', { name: 'Nouveau terminal' })).getByRole('menuitem', { name: /PowerShell/ }));
      await waitFor(() => expect(tiles()).toHaveLength(2));
      expect(within(tiles()[1]!).getByText('>_ PowerShell 2')).toBeVisible();
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
});
