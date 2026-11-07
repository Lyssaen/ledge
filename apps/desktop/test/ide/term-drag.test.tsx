import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../../src/i18n/lang';
import { DockHost } from '../../src/ide/DockHost';
import { BottomPanel } from '../../src/ide/BottomPanel';
import { termDrag } from '../../src/ide/termDrag';
import { empty, keyOf, open, split as splitGroup, type Tab } from '../../src/workspace/model';
import { createWorkspaceStore, useWorkspace, type WorkspaceStore } from '../../src/workspace/store';
import { useTabPlace } from '../../src/workspace/tabPlace';
import type { Panel } from '../../src/workspace/panel';
import { createDesktopFleet } from '../../src/fleet/useFleet';
import { App } from '../../src/App';
import { loadWorkspace } from '../../src/session/lazy';
import { loadSettings } from '../../src/settings/lazy';
import { loadHome, loadChat } from '../../src/chat/lazy';
import { loadIde } from '../../src/ide/lazy';
import { saveIdeEnabled } from '../../src/workspace/prefs';
import { TermStore } from '../../src/term/store';
import { PROJECTS } from '../helpers';

/** The App test's pseudo-terminals and xterms: what each shell opened, what was typed into it, each xterm's typing. */
const pty = vi.hoisted(() => ({ opens: [] as string[][], typed: [] as string[], inputs: new Map<Element, (d: string) => void>() }));
vi.mock('../../src/term/backend', async importActual => ({
  ...await importActual<typeof import('../../src/term/backend')>(),
  ptyBackend: () => ({ open: async (argv: string[]) => { pty.opens.push(argv); return { write: (d: string) => { pty.typed.push(d); }, resize: () => {}, close: () => {} }; } })
}));
vi.mock('../../src/session/lazy', async importActual => {
  const actual = await importActual<typeof import('../../src/session/lazy')>();
  const { fakeSurface } = await import('../term-fakes');
  return {
    ...actual,
    loadedWorkspace: () => {
      const m = actual.loadedWorkspace();
      return m && { ...m, createSurface: () => { const s = fakeSurface(); s.onInput = cb => { pty.inputs.set(s.host, cb); }; return s; } };
    }
  };
});

afterEach(() => { cleanup(); termDrag.set(null); localStorage.clear(); pty.opens.length = 0; pty.typed.length = 0; pty.inputs.clear(); });
// jsdom has no PointerEvent, which dockview tells drags apart with.
const hadPointer = 'PointerEvent' in globalThis;
beforeAll(() => { if (!hadPointer) (globalThis as { PointerEvent?: unknown }).PointerEvent = class extends MouseEvent {}; });
afterAll(() => { if (!hadPointer) delete (globalThis as { PointerEvent?: unknown }).PointerEvent; });

const A: Tab = { kind: 'session', ref: 'local:a' };
const B: Tab = { kind: 'session', ref: 'local:b' };
const groupviews = () => document.querySelectorAll('.dv-groupview');
const tabIn = (g: Element, name: string) => [...g.querySelectorAll('.dv-tab')].find(t => t.textContent?.includes(name));
const content = (g: Element) => g.querySelector<HTMLElement>('.dv-content-container')!;

function Host({ store, onPanelDrop }: { store: WorkspaceStore; onPanelDrop(ref: string, to: unknown): void }) {
  const ws = useWorkspace(store);
  return <LangProvider lang="fr"><DockHost ws={ws} store={store} title={keyOf} label={keyOf} alert={() => null} onTabMenu={() => {}} onNewSession={() => {}}
    body={tab => <p data-testid={keyOf(tab)}>{keyOf(tab)}</p>} emptyGroup={id => <p data-testid={`empty-${id}`}>vide</p>} onPanelDrop={onPanelDrop} /></LangProvider>;
}

describe('a panel tile dragged over the dock', () => {
  // The same stand-ins as dock.test.tsx (dockview-react 8.6.1 / dockview-core 8.8.3): 300 × 300 boxes at the origin, tabs 80 wide.
  let restore: (() => void) | null = null;
  beforeEach(() => {
    const size = (el: HTMLElement) => (el.classList.contains('dv-tab') ? 80 : 300);
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;
    const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return size(this as HTMLElement); } });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return size(this as HTMLElement); } });
    restore = () => { Object.defineProperty(HTMLElement.prototype, 'offsetWidth', w); Object.defineProperty(HTMLElement.prototype, 'offsetHeight', h); };
  });
  afterEach(() => { restore?.(); restore = null; });

  function at(type: 'dragEnter' | 'dragOver' | 'dragLeave' | 'drop', el: Element, x: number, y: number) {
    const ev = createEvent[type](el);
    Object.defineProperties(ev, { clientX: { value: x }, clientY: { value: y } });
    fireEvent(el, ev);
  }
  /** Carried over `to` at (x, y): true when dockview shows its drop overlay there (the drag accepted; dockview prevents every
   *  dragover's default itself, so that says nothing). */
  function over(to: Element, x = 150, y = 150): boolean {
    at('dragEnter', to, x, y); at('dragOver', to, x, y);
    return to.closest('.dv-groupview')!.querySelector('.dv-drop-target-selection') !== null;
  }
  async function mount() {
    let ws = open(empty(), A);
    ws = open(splitGroup(ws, ws.focus), B);   // a in g1, b in g2
    const store = createWorkspaceStore(ws);
    const onPanelDrop = vi.fn();
    render(<Host store={store} onPanelDrop={onPanelDrop} />);
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    return { store, onPanelDrop };
  }

  it('dropped on a group\'s centre: onPanelDrop(ref, { group }); the model is left to the host', async () => {
    const { store, onPanelDrop } = await mount();
    const before = store.get();
    termDrag.set({ from: 'panel', ref: 'shell:1' });
    over(content(groupviews()[0]!));
    at('drop', content(groupviews()[0]!), 150, 150);
    expect(onPanelDrop).toHaveBeenCalledWith('shell:1', { group: 'g1' });
    expect(store.get()).toBe(before);
  });

  it('dropped on a group\'s right edge: { rightOf }', async () => {
    const { onPanelDrop } = await mount();
    termDrag.set({ from: 'panel', ref: 'shell:1' });
    over(content(groupviews()[0]!), 290, 150);
    at('drop', content(groupviews()[0]!), 290, 150);
    expect(onPanelDrop).toHaveBeenCalledWith('shell:1', { rightOf: 'g1' });
  });

  it('dropped on a tab of a strip: that group, at that tab\'s place', async () => {
    const { onPanelDrop } = await mount();
    termDrag.set({ from: 'panel', ref: 'agent:local:a' });
    const tab = tabIn(groupviews()[1]!, 'session:local:b')!;
    over(tab, 10, 15);
    at('drop', tab, 10, 15);
    expect(onPanelDrop).toHaveBeenCalledWith('agent:local:a', { group: 'g2', index: 0 });
  });

  it('accepted only while a panel tile is dragged: nothing else (a file, say) is taken, nothing is dropped', async () => {
    const { store, onPanelDrop } = await mount();
    const before = store.get();
    expect(over(content(groupviews()[0]!))).toBe(false);
    at('drop', content(groupviews()[0]!), 150, 150);
    at('dragLeave', content(groupviews()[0]!), 150, 150);
    termDrag.set({ from: 'dock', key: 'session:local:b' });
    at('drop', content(groupviews()[0]!), 150, 150);
    expect(onPanelDrop).not.toHaveBeenCalled();
    expect(store.get()).toBe(before);
    termDrag.set({ from: 'panel', ref: 'shell:1' });
    expect(over(content(groupviews()[1]!))).toBe(true);
  });

  it('the left, top and bottom edges are refused', async () => {
    const { onPanelDrop } = await mount();
    termDrag.set({ from: 'panel', ref: 'shell:1' });
    for (const [x, y] of [[10, 150], [150, 10], [150, 290]] as const) { over(content(groupviews()[0]!), x, y); at('drop', content(groupviews()[0]!), x, y); }
    expect(onPanelDrop).not.toHaveBeenCalled();
  });

  it('« nouveau groupe » shows while a tile is dragged and takes it: right of the last group; the drag then ends', async () => {
    const { onPanelDrop } = await mount();
    const root = document.querySelector('.ide-dock-scroll')!;
    act(() => termDrag.set({ from: 'panel', ref: 'shell:1' }));
    await waitFor(() => expect(root).toHaveClass('tab-dragging'));
    const zone = document.querySelector<HTMLElement>('.ide-dropnew')!;
    expect(fireEvent.dragOver(zone)).toBe(false);
    fireEvent.drop(zone);
    expect(onPanelDrop).toHaveBeenCalledWith('shell:1', { rightOf: 'g2' });
    await waitFor(() => expect(root).not.toHaveClass('tab-dragging'));
    expect(termDrag.get()).toBeNull();
  });

  it('a dock tab picked up is told to the panel (from: dock), and forgotten when the drag ends', async () => {
    await mount();
    const tab = tabIn(groupviews()[0]!, 'session:local:a')!;
    fireEvent.dragStart(tab);
    expect(termDrag.get()).toEqual({ from: 'dock', key: 'session:local:a' });
    fireEvent.dragEnd(tab);
    expect(termDrag.get()).toBeNull();
  });
});

function TilePlace({ id }: { id: string }) {
  const p = useTabPlace();
  return <p data-testid={`place-${id}`}>{p ? JSON.stringify(p) : 'none'}</p>;
}
function mountPanel(panel: Panel) {
  const p = {
    panel, onTab: vi.fn(), outputCount: 0, output: null, menu: [], onNewShell: vi.fn(),
    tile: (ref: string) => <TilePlace id={ref} />, tileTitle: (ref: string) => `>_ ${ref}`, tileKind: () => 'shell',
    onClose: vi.fn(), onHide: vi.fn(), onDockDrop: vi.fn(), onRefused: vi.fn()
  };
  render(<LangProvider lang="fr"><BottomPanel {...p} /></LangProvider>);
  return { p, region: screen.getByRole('region', { name: 'Panneau du bas' }) };
}

describe('the bottom panel and the drag', () => {
  it('a tile picked up says so (from: panel, its ref) with the Ledge drag type, and forgets it at dragend', () => {
    mountPanel({ terms: ['shell:1'], tab: 'term' });
    const tab = screen.getByText('>_ shell:1');
    const data = new Map<string, string>();
    fireEvent.dragStart(tab, { dataTransfer: { setData: (k: string, v: string) => data.set(k, v), effectAllowed: '' } });
    expect(termDrag.get()).toEqual({ from: 'panel', ref: 'shell:1' });
    expect(data.get('application/x-ledge-term')).toBe('shell:1');
    fireEvent.dragEnd(tab);
    expect(termDrag.get()).toBeNull();
  });

  it('a dock terminal tab over the panel: accepted, the frame outlined; dropped: onDockDrop(key)', () => {
    const { p, region } = mountPanel({ terms: ['shell:2'], tab: 'term' });
    termDrag.set({ from: 'dock', key: 'terminal:shell:1' });
    expect(fireEvent.dragOver(region)).toBe(false);
    expect(region).toHaveClass('drop-on');
    fireEvent.drop(region);
    expect(p.onDockDrop).toHaveBeenCalledWith('terminal:shell:1');
    expect(p.onRefused).not.toHaveBeenCalled();
    expect(region).not.toHaveClass('drop-on');
  });

  it('another dock tab (a session) dropped on the panel is refused: onRefused, nothing moves', () => {
    const { p, region } = mountPanel({ terms: ['shell:2'], tab: 'term' });
    termDrag.set({ from: 'dock', key: 'session:x' });
    fireEvent.dragOver(region);
    fireEvent.drop(region);
    expect(p.onRefused).toHaveBeenCalledTimes(1);
    expect(p.onDockDrop).not.toHaveBeenCalled();
  });

  it('nothing dragged from the dock (a file, a tile of its own): not accepted, not outlined', () => {
    const { p, region } = mountPanel({ terms: ['shell:2'], tab: 'term' });
    expect(fireEvent.dragOver(region)).toBe(true);
    termDrag.set({ from: 'panel', ref: 'shell:2' });
    expect(fireEvent.dragOver(region)).toBe(true);
    expect(region).not.toHaveClass('drop-on');
    fireEvent.drop(region);
    expect(p.onDockDrop).not.toHaveBeenCalled();
    expect(p.onRefused).not.toHaveBeenCalled();
  });

  it('each tile is a place of its own (panel:<ref>), shown, never the focused group\'s', () => {
    mountPanel({ terms: ['shell:1', 'agent:local:a'], tab: 'term' });
    expect(JSON.parse(screen.getByTestId('place-shell:1').textContent!)).toEqual({ key: 'panel:shell:1', group: '', visible: true, active: false });
    expect(JSON.parse(screen.getByTestId('place-agent:local:a').textContent!)).toMatchObject({ key: 'panel:agent:local:a', visible: true });
  });
});

describe('a shell dragged between the panel and the dock (App)', () => {
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
  }
  const tiles = () => [...document.querySelectorAll<HTMLElement>('.ide-btile')];
  const bottom = () => screen.queryByRole('region', { name: 'Panneau du bas' });

  it('the tile goes to a new group and back: the same shell (never killed, never reopened), the panel hidden then shown, said', async () => {
    const openFree = vi.spyOn(TermStore.prototype, 'openFree');
    const closeFree = vi.spyOn(TermStore.prototype, 'closeFree');
    await mountApp();
    act(() => { fireEvent.keyDown(window, { key: 'j', ctrlKey: true }); });
    await waitFor(() => expect(tiles()).toHaveLength(1));
    const host = () => document.querySelector('.ide-free-shell .terminal-screen')?.firstElementChild ?? null;
    await waitFor(() => expect(host()).not.toBeNull());
    const xterm = host()!;
    await waitFor(() => expect(pty.opens).toHaveLength(1));

    // Tile → « nouveau groupe »: the panel, emptied, hides without the « last terminal closed » note.
    const tab = within(tiles()[0]!).getByText('>_ WSL 1');
    fireEvent.dragStart(tab);
    const zone = document.querySelector<HTMLElement>('.ide-dropnew')!;
    fireEvent.dragOver(zone);
    fireEvent.drop(zone);
    fireEvent.dragEnd(tab);
    const groups = () => [...document.querySelectorAll<HTMLElement>('.dv-groupview')];
    await waitFor(() => expect(groups()).toHaveLength(2));
    const dockTab = await within(groups()[1]!).findByRole('tab', { name: '>_ WSL 1' });
    await waitFor(() => expect(bottom()).toBeNull());
    expect(screen.queryByText(/Dernier terminal fermé/)).toBeNull();
    await waitFor(() => expect(host()).toBe(xterm));

    // Back onto the panel: shown again (Ctrl+J), it opens its default shell; the dock tab then joins it.
    act(() => { fireEvent.keyDown(window, { key: 'j', ctrlKey: true }); });
    await waitFor(() => expect(tiles()).toHaveLength(1));   // the default shell of a panel shown empty
    fireEvent.dragStart(dockTab.closest('.dv-tab') ?? dockTab);
    fireEvent.dragOver(bottom()!);
    fireEvent.drop(bottom()!);
    await waitFor(() => expect(tiles()).toHaveLength(2));
    expect(within(tiles()[1]!).getByText('>_ WSL 1')).toBeVisible();   // at the end, beside the default shell
    expect(await screen.findByText('Terminal ramené dans le panneau du bas.')).toBeVisible();
    await waitFor(() => expect(groups()).toHaveLength(1));
    await waitFor(() => expect(tiles()[1]!.querySelector('.ide-free-shell .terminal-screen')?.firstElementChild).toBe(xterm));
    expect(closeFree).not.toHaveBeenCalled();
    expect(openFree).toHaveBeenCalledTimes(2);   // WSL 1, then the default shell of the panel shown empty: WSL 1 never again
    expect(pty.opens).toHaveLength(2);           // one process each, none relaunched
    // Typing in the moved xterm still reaches WSL 1's process.
    act(() => pty.inputs.get(xterm)!('ls\r'));
    expect(pty.typed).toContain('ls\r');
    // Not remembered as closed: Ctrl+Shift+T brings nothing back to the dock.
    act(() => { fireEvent.keyDown(window, { key: 'T', ctrlKey: true, shiftKey: true }); });
    expect(within(groups()[0]!).queryByRole('tab', { name: '>_ WSL 1' })).toBeNull();
  });

  it('a session tab dropped on the panel stays where it is, and says why', async () => {
    await mountApp();
    act(() => { fireEvent.keyDown(window, { key: 'j', ctrlKey: true }); });
    await waitFor(() => expect(tiles()).toHaveLength(1));
    const groups = () => [...document.querySelectorAll<HTMLElement>('.dv-groupview')];
    const atelier = [...groups()[0]!.querySelectorAll('.dv-tab')][0]!;
    fireEvent.dragStart(atelier);
    fireEvent.dragOver(bottom()!);
    fireEvent.drop(bottom()!);
    expect(await screen.findByText('Seuls les terminaux se rangent dans le panneau du bas.')).toBeVisible();
    expect(tiles()).toHaveLength(1);
    expect(groups()[0]!.querySelectorAll('.dv-tab')).toHaveLength(1);
  });
});
