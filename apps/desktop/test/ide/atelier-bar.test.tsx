import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../../src/i18n/lang';
import { AtelierBar } from '../../src/ide/AtelierBar';
import { offersRigs, setGrouping } from '../../src/openrig/grouping';
import { createDesktopFleet } from '../../src/fleet/useFleet';
import { App } from '../../src/App';
import { loadWorkspace } from '../../src/session/lazy';
import { loadSettings } from '../../src/settings/lazy';
import { loadChat } from '../../src/chat/lazy';
import { loadIde } from '../../src/ide/lazy';
import { PROJECTS, seedAtelier } from '../helpers';

// The IDE's Atelier tab (docs/ide-workspace.md « Atelier », mockup atelierPage() `.abar`): the bar the old top bar gave it.
type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'fr'); });
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); setGrouping('rigs'); localStorage.clear(); });

type BarProps = Parameters<typeof AtelierBar>[0];
function bar(o: Partial<BarProps> = {}) {
  const p: BarProps = { filter: null, onClearFilter: vi.fn(), grouping: 'rigs', onGrouping: vi.fn(), helpers: true, onHelpers: vi.fn(), paused: false, onPaused: vi.fn(), onDetach: vi.fn(), ...o };
  render(<LangProvider lang="fr"><AtelierBar {...p} /></LangProvider>);
  return { p, user: userEvent.setup() };
}

describe('AtelierBar', () => {
  it('« Projets | Rigs »: the grouping checked, a click asks for the other', async () => {
    const { p, user } = bar({ grouping: 'rigs' });
    const group = screen.getByRole('radiogroup', { name: 'Regrouper les sièges OpenRig' });
    expect(within(group).getByRole('radio', { name: 'Rigs' })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: 'Projets' })).toHaveAttribute('aria-checked', 'false');
    await user.click(within(group).getByRole('radio', { name: 'Projets' }));
    expect(p.onGrouping).toHaveBeenCalledWith('projects');
  });

  it('no grouping offered: no « Projets | Rigs »', () => {
    bar({ grouping: null });
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('« Masquer les sous-agents » while they show, « Afficher » once hidden', async () => {
    const { p, user } = bar({ helpers: true });
    await user.click(screen.getByRole('button', { name: 'Masquer les sous-agents' }));
    expect(p.onHelpers).toHaveBeenCalledTimes(1);
    cleanup();
    bar({ helpers: false });
    expect(screen.getByRole('button', { name: 'Afficher les sous-agents' })).toBeInTheDocument();
  });

  it('« Détacher » only when it can detach', async () => {
    const { p, user } = bar();
    await user.click(screen.getByRole('button', { name: 'Détacher' }));
    expect(p.onDetach).toHaveBeenCalledTimes(1);
    cleanup();
    bar({ onDetach: undefined });
    expect(screen.queryByRole('button', { name: 'Détacher' })).toBeNull();
  });

  it('the project filter after « Atelier », its cross gives every project back', async () => {
    const { p, user } = bar({ filter: { name: 'ledge', color: 'teal' } });
    expect(screen.getByText('ledge')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retirer le filtre : voir tous les projets' }));
    expect(p.onClearFilter).toHaveBeenCalledTimes(1);
    cleanup();
    bar({ filter: null });
    expect(screen.queryByRole('button', { name: 'Retirer le filtre : voir tous les projets' })).toBeNull();
  });

  it('the pause: « Animer » pressed while frozen', async () => {
    const { p, user } = bar({ paused: true });
    const play = screen.getByRole('button', { name: 'Animer' });
    expect(play).toHaveAttribute('aria-pressed', 'true');
    await user.click(play);
    expect(p.onPaused).toHaveBeenCalledTimes(1);
  });
});

describe('offersRigs', () => {
  const s = (rig: string | undefined, state: 'idle' | 'exited' = 'idle') => fakeSession(`s-${rig ?? 'x'}-${state}`, { ...(rig ? { rig: { seat: `dev@${rig}`, name: rig } } : {}), state });
  it('a live seat, or OpenRig installed', () => {
    expect(offersRigs([s('ledge-dev')], undefined)).toBe(true);
    expect(offersRigs([], true)).toBe(true);
    expect(offersRigs([s(undefined)], false)).toBe(false);
    expect(offersRigs([s('ledge-dev', 'exited')], undefined)).toBe(false);
  });
});

describe('the Atelier tab in the IDE', () => {
  it('shows the bar above the atelier; « Projets » regroups', async () => {
    await Promise.all([loadWorkspace(), loadSettings(), loadChat(), loadIde()]);
    seedAtelier();
   
    const d = await createMockDaemon(); daemons.push(d);
    d.machines([{ id: 'local', label: 'Local' }]);
    d.projects(PROJECTS);
    d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }));
    d.upsert(fakeSession('bix', { name: 'Bix', cwd: '/w/ledge-dev', state: 'idle', rig: { seat: 'dev@ledge-dev', name: 'ledge-dev', role: 'dev' } }));
    render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    const abar = await waitFor(() => { const b = document.querySelector<HTMLElement>('.ide-atelier .ide-abar'); expect(b).not.toBeNull(); return b!; }, { timeout: 5000 });
    // The bar comes before the atelier's own zoom bar, which stays as it is.
    expect(abar.compareDocumentPosition(document.querySelector('.ide-atelier .zoom-controls')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const user = userEvent.setup();
    await user.click(await within(abar).findByRole('radio', { name: 'Projets' }));
    expect(localStorage.getItem('desktop.grouping')).toBe('projects');
    expect(within(abar).getByRole('radio', { name: 'Projets' })).toHaveAttribute('aria-checked', 'true');
  });
});
