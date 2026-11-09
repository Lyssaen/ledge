import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Session } from '@ledge/protocol';
import { LangProvider } from '../../src/i18n/lang';
import { IdeExplorer } from '../../src/ide/IdeExplorer';
import { initialNav } from '../../src/nav/state';
import { Sidebar } from '../../src/shell/sidebar/Sidebar';
import type { ContextMenuState } from '../../src/manage/useContextMenu';
import type { SessionActions } from '../../src/manage/useSessionActions';
import type { Decisions } from '../../src/fleet/decisions';
import type { Filing } from '../../src/atelier/filing';

afterEach(cleanup);
const fr = (ui: React.ReactElement) => render(<LangProvider lang="fr">{ui}</LangProvider>);

describe('IdeExplorer', () => {
  const mount = () => {
    const onLayout = vi.fn();
    fr(<IdeExplorer width={248} onLayout={onLayout}><p>contenu</p></IdeExplorer>);
    const root = screen.getByText('contenu').closest('.ide-explorer') as HTMLElement;
    root.getBoundingClientRect = () => ({ left: 48, right: 296, top: 0, bottom: 0, width: 248, height: 0, x: 48, y: 0, toJSON: () => ({}) });
    return { onLayout };
  };

  it('dragging the edge sends drag, then drop, with the width from the sidebar\'s left edge', () => {
    const { onLayout } = mount();
    const edge = screen.getByTitle('Glisser pour redimensionner · double-clic : largeur par défaut');
    expect(edge).toHaveClass('ide-resize');
    fireEvent.mouseDown(edge, { clientX: 296 });
    fireEvent.mouseMove(window, { clientX: 300 });
    expect(onLayout).toHaveBeenLastCalledWith({ type: 'drag', width: 252 });
    fireEvent.mouseUp(window, { clientX: 300 });
    expect(onLayout).toHaveBeenLastCalledWith({ type: 'drop', width: 252 });
    onLayout.mockClear();
    fireEvent.mouseMove(window, { clientX: 400 });
    expect(onLayout).not.toHaveBeenCalled();
  });

  it('a double click resets the width', () => {
    const { onLayout } = mount();
    fireEvent.doubleClick(screen.getByTitle(/Glisser pour redimensionner/));
    expect(onLayout).toHaveBeenCalledWith({ type: 'resetWidth' });
  });

  it('no « Réduire » foot (the user, 2026-11-09): Ctrl + B and the title bar fold the sidebar', () => {
    mount();
    expect(screen.queryByRole('button', { name: /Réduire/ })).toBeNull();
    expect(document.querySelector('.ide-explorer-foot')).toBeNull();
  });
});

describe('Sidebar section', () => {
  const waiting: Session = fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } });
  const sidebar = (section?: 'projects' | 'rigs' | 'atoi') => render(<LangProvider lang="en">
    <Sidebar nav={initialNav({ helpers: [], paused: false } as never)} dispatch={vi.fn()} sessions={[waiting]} archived={[]} machines={[]} projects={null} order={[waiting]} projectIdOf={() => null}
      filing={{ dragging: null } as unknown as Filing} actions={{ pending: null, allowed: () => true } as unknown as SessionActions} decisions={{ decide: vi.fn() } as unknown as Decisions}
      waits={new Map()} menu={{ menu: null } as unknown as ContextMenuState} notify={vi.fn()} onTerminal={vi.fn()} revealArchives={0} revealCurrent={0} {...(section ? { section } : {})} /></LangProvider>);

  it('atoi: the waiting session shows, neither the tree nor the Archives, nor the chrome', () => {
    sidebar('atoi');
    expect(screen.getByRole('region', { name: 'Your turn' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Archives' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Projects' })).toBeNull();
    expect(document.querySelector('.st-ledge, .st-views, .st-foot')).toBeNull();
  });

  it('atoi with nothing waiting: one line, « Rien ne t’attend. », in the middle (the user, 2026-11-09)', () => {
    render(<LangProvider lang="fr">
      <Sidebar section="atoi" nav={initialNav({ helpers: [], paused: false } as never)} dispatch={vi.fn()} sessions={[]} archived={[]} machines={[]} projects={null} order={[]} projectIdOf={() => null}
        filing={{ dragging: null } as unknown as Filing} actions={{ pending: null, allowed: () => true } as unknown as SessionActions} decisions={{ decide: vi.fn() } as unknown as Decisions}
        waits={new Map()} menu={{ menu: null } as unknown as ContextMenuState} notify={vi.fn()} onTerminal={vi.fn()} revealArchives={0} revealCurrent={0} /></LangProvider>);
    const line = screen.getByText('Rien ne t’attend.');
    expect(line).toHaveClass('st-attn-none');
    expect(line.parentElement).toHaveClass('st-scroll-atoi');
  });

  it('atoi: no usage card, the IDE tells it once in a toast', () => {
    const alert = { id: 'claude|five_hour|1', harness: 'claude', level: 'threshold', at: new Date().toISOString(), window: { kind: 'five_hour', pct: 84 } } as never;
    render(<LangProvider lang="en">
      <Sidebar section="atoi" nav={initialNav({ helpers: [], paused: false } as never)} dispatch={vi.fn()} sessions={[]} archived={[]} machines={[]} projects={null} order={[]} projectIdOf={() => null}
        filing={{ dragging: null } as unknown as Filing} actions={{ pending: null, allowed: () => true } as unknown as SessionActions} decisions={{ decide: vi.fn() } as unknown as Decisions}
        waits={new Map()} menu={{ menu: null } as unknown as ContextMenuState} notify={vi.fn()} onTerminal={vi.fn()} revealArchives={0} revealCurrent={0} usageAlerts={[alert]} /></LangProvider>);
    expect(document.querySelector('.st-usage')).toBeNull();
    expect(screen.getByText('Nothing waits for you.')).toBeVisible();
  });

  it('projects: Archives, without Ledge\'s entry', () => {
    sidebar('projects');
    expect(screen.getByRole('region', { name: 'Archives' })).toBeVisible();
    expect(document.querySelector('.st-ledge, .st-views, .st-grouping, .st-foot')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Your turn' })).toBeNull();
  });

  it('without a section, the sidebar is the whole one', () => {
    sidebar();
    expect(document.querySelector('.st-ledge')).not.toBeNull();
    expect(document.querySelector('.st-foot')).not.toBeNull();
  });
});
