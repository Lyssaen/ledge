import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../../src/i18n/lang';
import { ActivityBar } from '../../src/ide/ActivityBar';
import { IdeStatusBar } from '../../src/ide/IdeStatusBar';
import { IdeTitleBar } from '../../src/ide/IdeTitleBar';
import type { IdeLayout } from '../../src/workspace/layout';
import { keyOf } from '../../src/workspace/model';

afterEach(cleanup);
const L: IdeLayout = { sideOpen: true, sideWidth: 248, sideView: 'projects', bottom: false, bottomHeight: 240, right: true };
const fr = (ui: React.ReactElement) => render(<LangProvider lang="fr">{ui}</LangProvider>);
const none = { perm: 0, ask: 0 };
const activity = (layout = L, badge = none, extra: Partial<Parameters<typeof ActivityBar>[0]> = {}) =>
  fr(<ActivityBar layout={layout} onLayout={vi.fn()} onTab={vi.fn()} activeTab={null} badge={badge} {...extra} />);

describe('the IDE chrome', () => {
  it('title bar toggles', () => {
    const onLayout = vi.fn();
    fr(<IdeTitleBar layout={L} onLayout={onLayout} onSearch={vi.fn()} blocked={false} />);
    const bottom = screen.getByRole('button', { name: /Panneau du bas/ });
    expect(bottom).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Panneau de droite/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Barre latérale/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(bottom);
    expect(onLayout).toHaveBeenCalledWith({ type: 'toggle', panel: 'bottom' });
  });

  it('search opens the palette', () => {
    const onSearch = vi.fn();
    fr(<IdeTitleBar layout={L} onLayout={vi.fn()} onSearch={onSearch} blocked={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Session, commande, tâche, rig/ }));
    expect(onSearch).toHaveBeenCalledOnce();
    expect(screen.getByText('Ctrl K')).toBeInTheDocument();
  });

  it('activity views and tabs', () => {
    const onLayout = vi.fn(), onTab = vi.fn();
    activity(L, none, { onLayout, onTab });
    fireEvent.click(screen.getByRole('button', { name: 'Rigs OpenRig' }));
    expect(onLayout).toHaveBeenCalledWith({ type: 'view', view: 'rigs' });
    fireEvent.click(screen.getByRole('button', { name: 'Atelier (onglet)' }));
    expect(keyOf(onTab.mock.calls[0]![0])).toBe('atelier:main');
    fireEvent.click(screen.getByRole('button', { name: 'OpenRig (onglet)' }));
    expect(keyOf(onTab.mock.calls[1]![0])).toBe('openrig:local');
    fireEvent.click(screen.getByRole('button', { name: 'Réglages (onglet)' }));
    expect(keyOf(onTab.mock.calls[2]![0])).toBe('settings:main');
    fireEvent.click(screen.getByRole('button', { name: /À toi/ }));
    expect(onLayout).toHaveBeenLastCalledWith({ type: 'view', view: 'atoi' });
  });

  it('the active view is on only while the sidebar is open; tabs are on by activeTab', () => {
    const { unmount } = activity();
    expect(screen.getByRole('button', { name: 'Projets' })).toHaveClass('on');
    expect(screen.getByRole('button', { name: 'Rigs OpenRig' })).not.toHaveClass('on');
    unmount();
    activity({ ...L, sideOpen: false });
    expect(screen.getByRole('button', { name: 'Projets' })).not.toHaveClass('on');
    cleanup();
    activity(L, none, { activeTab: { kind: 'atelier', ref: 'main' } });
    expect(screen.getByRole('button', { name: 'Atelier (onglet)' })).toHaveClass('on');
  });

  it('À toi badge', () => {
    const { unmount } = activity(L, { perm: 2, ask: 1 });
    const red = screen.getByText('2');
    expect(red.className).not.toMatch(/amber/);
    unmount();
    const { unmount: u2 } = activity(L, { perm: 0, ask: 3 });
    expect(screen.getByText('3').className).toMatch(/amber/);
    u2();
    activity(L, none);
    expect(document.querySelector('.ide-badge')).toBeNull();
  });

  it('activity order: views, OpenRig and Atelier, the grow zone, then Réglages alone', () => {
    activity();
    const nav = screen.getByRole('navigation');
    const names = Array.from(nav.children).map(e => e.classList.contains('grow') ? 'grow' : e.getAttribute('aria-label'));
    expect(names).toEqual(['Projets', 'Rigs OpenRig', 'À toi', 'OpenRig (onglet)', 'Atelier (onglet)', 'grow', 'Réglages (onglet)']);
  });

  it('no MR et PR yet', () => {
    activity();
    expect(screen.queryByRole('button', { name: /MR/ })).toBeNull();
  });

  it('status bar waiting', () => {
    const onNext = vi.fn();
    const two = [fakeSession('a'), fakeSession('b')];
    const { unmount } = fr(<IdeStatusBar footer={<span>pied</span>} waiting={two} onNextWaiting={onNext} />);
    expect(screen.getByText('pied')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /2 demandes/ }));
    expect(onNext).toHaveBeenCalledOnce();
    unmount();
    fr(<IdeStatusBar footer={null} waiting={[]} onNextWaiting={onNext} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
