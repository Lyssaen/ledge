import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LangProvider } from '../../src/i18n/lang';
import { DockviewComponent } from 'dockview-react';
import { DockHost, GROUP_MIN_WIDTH, keepScroll } from '../../src/ide/DockHost';
import { activate, agentTerminalTab, beside, deserialize, empty, keyOf, moveTo, open, serialize, sessionOf, split as splitGroup, type Tab, type Workspace } from '../../src/workspace/model';
import { createWorkspaceStore, useWorkspace, type WorkspaceStore } from '../../src/workspace/store';
import { useTabPlace } from '../../src/workspace/tabPlace';
import { useAgentScreen } from '../../src/session/useAgentScreen';
import { agentTabId, TermStore } from '../../src/term/store';
import { TermStoreContext } from '../../src/term/useTerms';
import type { AgentMode } from '../../src/term/mode';
import { fakeBackend, fakeSurface } from '../term-fakes';

afterEach(() => { cleanup(); localStorage.clear(); });

const A: Tab = { kind: 'session', ref: 'local:a' };
const B: Tab = { kind: 'session', ref: 'local:b' };

function Place({ tab }: { tab: Tab }) {
  const p = useTabPlace();
  return <p data-testid={keyOf(tab)}>{p ? JSON.stringify(p) : 'none'}</p>;
}
function Host({ store }: { store: WorkspaceStore }) {
  const ws = useWorkspace(store);
  return <LangProvider lang="fr"><DockHost ws={ws} store={store} title={keyOf} label={keyOf} alert={() => null} onTabMenu={() => {}} onNewSession={() => {}} body={tab => <Place tab={tab} />}
    emptyGroup={id => <p data-testid={`empty-${id}`}>vide</p>} /></LangProvider>;
}
const read = (ref: string) => JSON.parse(screen.getByTestId(ref).textContent!) as { key: string; group: string; visible: boolean; active: boolean };

describe('the dock host gives each tab its place', () => {
  it('the front tab is visible and active; activating the other swaps them, the first staying mounted but hidden', async () => {
    const both = open(open(empty(), A), B);
    const gid = both.focus;
    const store = createWorkspaceStore(activate(both, gid, 0));
    render(<Host store={store} />);
    await waitFor(() => expect(read('session:local:a')).toEqual({ key: 'session:local:a', group: gid, visible: true, active: true }));
    const a = screen.getByTestId('session:local:a');   // kept after it hides: its DOM is detached, its React tree is not
    // dockview renders a panel on its first showing only: the other tab has no content yet.
    expect(screen.queryByTestId('session:local:b')).toBeNull();
    act(() => store.update(w => activate(w, gid, 1)));
    await waitFor(() => expect(read('session:local:b')).toMatchObject({ visible: true, active: true }));
    await waitFor(() => expect(JSON.parse(a.textContent!)).toMatchObject({ visible: false, active: false }));
  });
});

const groupviews = () => document.querySelectorAll('.dv-groupview');
const tabIn = (g: Element, name: string) => [...g.querySelectorAll('.dv-tab')].find(t => t.textContent?.includes(name));

describe('the dock host draws the main window\'s groups side by side', () => {
  /** Session a, then its Changes beside it: two model groups. */
  function split() {
    const ws = open(empty(), A);
    return beside(ws, ws.focus, 'changes', 'local:a');
  }

  it('« beside » gives a second dockview group holding changes:a; closing it leaves one group, in dockview and the model', async () => {
    const store = createWorkspaceStore(open(empty(), A));
    render(<Host store={store} />);
    await waitFor(() => expect(groupviews()).toHaveLength(1));
    act(() => store.update(w => beside(w, w.focus, 'changes', 'local:a')));
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    expect(tabIn(groupviews()[1]!, 'changes:local:a')).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fermer changes:local:a' }));
    await waitFor(() => expect(groupviews()).toHaveLength(1));
    expect(store.get().groups).toHaveLength(1);
    expect(store.get().groups[0]!.tabs).toEqual([A]);
  });

  it('a click on the second group\'s tab focuses it: its content reads active, the first stays visible but not active', async () => {
    const ws = split();
    const [g1, g2] = ws.groups.map(g => g.id);
    const store = createWorkspaceStore({ ...ws, focus: g1! });
    render(<Host store={store} />);
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    await waitFor(() => expect(read('session:local:a')).toMatchObject({ group: g1, visible: true, active: true }));
    await userEvent.setup().click(tabIn(groupviews()[1]!, 'changes:local:a')!);
    await waitFor(() => expect(store.get().focus).toBe(g2));
    expect(groupviews()[1]).toHaveClass('dv-active-group');   // what the focus line hangs on (ide.css)
    await waitFor(() => expect(read('changes:local:a')).toMatchObject({ group: g2, visible: true, active: true }));
    // The tab visible in a group that is not ws.focus is not active.
    await waitFor(() => expect(read('session:local:a')).toMatchObject({ group: g1, visible: true, active: false }));
  });

  it('a layout read back with two groups mounts two dockview groups', async () => {
    const ws = deserialize(serialize(split()))!;
    const store = createWorkspaceStore(ws);
    render(<Host store={store} />);
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    expect(tabIn(groupviews()[0]!, 'session:local:a')).toBeDefined();
    expect(tabIn(groupviews()[1]!, 'changes:local:a')).toBeDefined();
  });
});

describe('split, the empty group, the link square, many groups', () => {
  it('« Diviser à droite » at the end of the strip, after « + »: an empty group right, drawn, focused, with its content', async () => {
    const store = createWorkspaceStore(open(empty(), A));
    render(<Host store={store} />);
    await waitFor(() => expect(groupviews()).toHaveLength(1));
    const tools = groupviews()[0]!.querySelector('.ide-strip-tools')!;
    const buttons = [...tools.querySelectorAll('button')];
    expect(buttons.map(b => b.getAttribute('title'))).toEqual(['Nouvelle session (N)', 'Diviser à droite (Ctrl+\\)']);
    await userEvent.setup().click(buttons[1]!);
    expect(store.get().groups.map(g => g.tabs.length)).toEqual([1, 0]);
    const g2 = store.get().groups[1]!.id;
    expect(store.get().focus).toBe(g2);
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    // The empty group carries dockview's focus (the focus line hangs on it) and shows what the host gives it.
    await waitFor(() => expect(groupviews()[1]).toHaveClass('dv-active-group'));
    expect(groupviews()[0]).not.toHaveClass('dv-active-group');
    expect(within(groupviews()[1] as HTMLElement).getByTestId(`empty-${g2}`)).toBeInTheDocument();
  });

  it('an empty group\'s strip ends with « Fermer le groupe (Ctrl+W) », which closes it; none on a group with tabs, nor on the last group', async () => {
    const store = createWorkspaceStore(splitGroup(open(empty(), A), 'g1'));
    render(<Host store={store} />);
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    const titles = (g: Element) => [...g.querySelectorAll('.ide-strip-tools button')].map(b => b.getAttribute('title'));
    expect(titles(groupviews()[0]!)).toEqual(['Nouvelle session (N)', 'Diviser à droite (Ctrl+\\)']);
    expect(titles(groupviews()[1]!)).toEqual(['Nouvelle session (N)', 'Diviser à droite (Ctrl+\\)', 'Fermer le groupe (Ctrl+W)']);
    await userEvent.setup().click(within(groupviews()[1] as HTMLElement).getByRole('button', { name: 'Fermer le groupe (Ctrl+W)' }));
    await waitFor(() => expect(groupviews()).toHaveLength(1));
    expect(store.get().groups.map(g => g.id)).toEqual(['g1']);
    expect(store.get().focus).toBe('g1');
    // The window's last group, emptied: it stays, without the button.
    act(() => store.update(w => ({ ...w, groups: w.groups.map(g => ({ ...g, tabs: [] })) })));
    await waitFor(() => expect(screen.getByTestId('empty-g1')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Fermer le groupe/ })).toBeNull();
  });

  it('a tab closed by its × is remembered: the store\'s reopen brings it back', async () => {
    const store = createWorkspaceStore(open(open(empty(), A), B));
    render(<Host store={store} />);
    await waitFor(() => expect(tabIn(groupviews()[0]!, 'session:local:b')).toBeDefined());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fermer session:local:b' }));
    await waitFor(() => expect(tabIn(groupviews()[0]!, 'session:local:b')).toBeUndefined());
    act(() => store.reopen());
    await waitFor(() => expect(tabIn(groupviews()[0]!, 'session:local:b')).toBeDefined());
    expect(store.get().groups[0]!.tabs).toEqual([A, B]);
  });

  it('a layout read back with an empty group draws it; a pointer in it focuses it; a tab opened there fills it', async () => {
    const ws = activate(splitGroup(open(empty(), A), 'g1'), 'g1', 0);
    const store = createWorkspaceStore(deserialize(serialize(ws))!);
    render(<Host store={store} />);
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    await waitFor(() => expect(groupviews()[0]).toHaveClass('dv-active-group'));
    const content = screen.getByTestId('empty-g2');
    fireEvent.pointerDown(content);
    await waitFor(() => expect(store.get().focus).toBe('g2'));
    await waitFor(() => expect(groupviews()[1]).toHaveClass('dv-active-group'));
    act(() => store.update(w => open(w, B)));
    await waitFor(() => expect(tabIn(groupviews()[1]!, 'session:local:b')).toBeDefined());
    expect(screen.queryByTestId('empty-g2')).toBeNull();
    expect(groupviews()).toHaveLength(2);
  });

  it('the link square, left of the tabs: three clicks → violet, teal, none', async () => {
    const store = createWorkspaceStore(open(empty(), A));
    render(<Host store={store} />);
    await waitFor(() => expect(groupviews()).toHaveLength(1));
    const square = () => screen.getByRole('button', { name: 'Lier ce groupe (violet, vert d’eau, aucun)' });
    // dockview's prefix slot comes before the tabs (its left actions would come after them).
    const pre = square().closest('.dv-pre-actions-container');
    expect(pre).not.toBeNull();
    expect(pre!.nextElementSibling).toHaveClass('dv-scrollable');
    const swatch = () => square().querySelector('.ide-lk')!;
    expect(swatch()).toHaveClass('none');
    const user = userEvent.setup();
    const seen: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      await user.click(square());
      seen.push(store.get().groups[0]!.link);
      await waitFor(() => expect(swatch()).toHaveClass(seen[i] ?? 'none'));
    }
    expect(seen).toEqual(['violet', 'teal', null]);
  });

  it('each group is 300 px wide at least: the dock is as wide as its groups need, and scrolls inside its area', async () => {
    let ws = open(empty(), A);
    ws = splitGroup(ws, ws.focus);
    ws = splitGroup(ws, ws.focus);
    ws = splitGroup(ws, ws.focus);
    // The dockview the host draws in, caught as it adds a group: each group's constraint is read there.
    let dock: DockviewComponent | null = null;
    const addGroup = DockviewComponent.prototype.addGroup;
    const spy = vi.spyOn(DockviewComponent.prototype, 'addGroup').mockImplementation(function (this: DockviewComponent, ...a: Parameters<DockviewComponent['addGroup']>) { dock = this; return addGroup.apply(this, a); });
    onTestFinished(() => spy.mockRestore());
    const store = createWorkspaceStore(ws);
    render(<Host store={store} />);
    await waitFor(() => expect(groupviews()).toHaveLength(4));
    expect(GROUP_MIN_WIDTH).toBe(300);
    expect(dock!.groups.map(g => g.minimumWidth)).toEqual([300, 300, 300, 300]);
    // dockview's own element (.ide-dockview) fills the sized box, which its scroller lets overflow the editing area.
    const sized = document.querySelector<HTMLElement>('.ide-dock-sized')!;
    expect(sized.style.minWidth).toBe('1200px');
    expect(sized.parentElement).toHaveClass('ide-dock-scroll');
    expect(sized.querySelector('.ide-dockview')).not.toBeNull();
    act(() => store.update(w => splitGroup(w, w.focus)));
    await waitFor(() => expect(sized.style.minWidth).toBe('1500px'));
    expect(dock!.groups.map(g => g.minimumWidth)).toEqual([300, 300, 300, 300, 300]);
  });
});

/** Counts its mounts and keeps a draft in its own state: what a session page holds that a remount would lose. */
const mounts = new Map<string, number>();
function Counted({ tab }: { tab: Tab }) {
  const key = keyOf(tab);
  const [draft, setDraft] = useState('');
  useEffect(() => { mounts.set(key, (mounts.get(key) ?? 0) + 1); }, [key]);
  return <input data-testid={`draft-${key}`} value={draft} onChange={e => setDraft(e.target.value)} />;
}
function CountedHost({ store }: { store: WorkspaceStore }) {
  const ws = useWorkspace(store);
  return <LangProvider lang="fr"><DockHost ws={ws} store={store} title={keyOf} label={keyOf} alert={() => null} onTabMenu={() => {}} onNewSession={() => {}} body={tab => <Counted tab={tab} />}
    emptyGroup={id => <p data-testid={`empty-${id}`}>vide</p>} /></LangProvider>;
}

describe('dragging a tab: every arrival goes through the model, the panel is moved, never remade', () => {
  // These stand-ins (sizes, PointerEvent, DragEvent's place) target dockview-react 8.6.1 (dockview-core 8.8.3 under it): its
  // drop targets measure offsetWidth/offsetHeight and read clientX/clientY. Another version may need others.
  // jsdom lays nothing out: dockview's drop targets measure 300 × 300 boxes at the origin, so (150,150) is a centre and
  // (290,150) a right edge.
  const size = (el: HTMLElement) => (el.classList.contains('dv-tab') ? 80 : 300);
  let restore: (() => void) | null = null;
  beforeEach(() => {
    mounts.clear();
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;
    const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return size(this as HTMLElement); } });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return size(this as HTMLElement); } });
    // jsdom has no PointerEvent, which dockview tells drags apart with.
    const hadPointer = 'PointerEvent' in globalThis;
    if (!hadPointer) (globalThis as { PointerEvent?: unknown }).PointerEvent = class extends MouseEvent {};
    restore = () => { if (!hadPointer) delete (globalThis as { PointerEvent?: unknown }).PointerEvent; Object.defineProperty(HTMLElement.prototype, 'offsetWidth', w); Object.defineProperty(HTMLElement.prototype, 'offsetHeight', h); };
  });
  afterEach(() => { restore?.(); restore = null; });

  /** a in g1, b in g2: both on show, so both mounted. */
  function two() {
    let ws = open(empty(), A);
    ws = splitGroup(ws, ws.focus);
    return open(ws, B);
  }
  const content = (g: Element) => g.querySelector<HTMLElement>('.dv-content-container')!;
  /** jsdom has no DragEvent: its stand-in drops the pointer's place, which dockview reads, so it is set by hand. */
  function at(type: 'dragEnter' | 'dragOver' | 'drop', el: Element, x: number, y: number) {
    const ev = createEvent[type](el);
    Object.defineProperties(ev, { clientX: { value: x }, clientY: { value: y } });
    fireEvent(el, ev);
  }
  /** dockview's HTML5 drag: the tab picked up, carried over `to` at (x, y), dropped there, the drag ended. */
  function drag(from: Element, to: Element, x = 150, y = 150) {
    const tab = from.closest('.dv-tab') ?? from;
    fireEvent.dragStart(tab);
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) at(type, to, x, y);
    fireEvent.dragEnd(tab);
  }
  async function mounted(store: WorkspaceStore) {
    render(<CountedHost store={store} />);
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    await waitFor(() => expect(mounts.get('session:local:a')).toBe(1));
    await waitFor(() => expect(mounts.get('session:local:b')).toBe(1));
  }

  it('the model moving a tab to another group moves its panel: same content, mounted once, its draft kept', async () => {
    const store = createWorkspaceStore(two());
    await mounted(store);
    const input = screen.getByTestId('draft-session:local:a') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'brouillon' } });
    act(() => store.update(w => moveTo(w, 'session:local:a', { group: 'g2' })));
    await waitFor(() => expect(groupviews()).toHaveLength(1));
    expect(tabIn(groupviews()[0]!, 'session:local:a')).toBeDefined();
    await waitFor(() => expect(screen.getByTestId('draft-session:local:a')).toBe(input));
    expect(input.value).toBe('brouillon');
    expect(mounts.get('session:local:a')).toBe(1);
    expect(mounts.get('session:local:b')).toBe(1);
  });

  it('the model moving a tab to a new group right of the last: drawn on the right, the panel moved, not remade', async () => {
    const store = createWorkspaceStore(two());
    await mounted(store);
    act(() => store.update(w => moveTo(w, 'session:local:a', { rightOf: 'g2' })));
    // g1 emptied goes; g2 then the new group.
    await waitFor(() => expect(store.get().groups.map(g => g.tabs.map(keyOf))).toEqual([['session:local:b'], ['session:local:a']]));
    await waitFor(() => expect(tabIn(groupviews()[1] ?? document.body, 'session:local:a')).toBeDefined());
    expect(groupviews()).toHaveLength(2);
    expect(tabIn(groupviews()[0]!, 'session:local:b')).toBeDefined();
    expect(mounts.get('session:local:a')).toBe(1);
  });

  it('a tab dropped on another group\'s content joins it at the end; the emptied group goes', async () => {
    const store = createWorkspaceStore(two());
    await mounted(store);
    drag(tabIn(groupviews()[0]!, 'session:local:a')!, content(groupviews()[1]!));
    await waitFor(() => expect(store.get().groups.map(g => g.tabs.map(keyOf))).toEqual([['session:local:b', 'session:local:a']]));
    await waitFor(() => expect(groupviews()).toHaveLength(1));
    expect(mounts.get('session:local:a')).toBe(1);
    expect(store.get().groups[0]!.tabs[store.get().groups[0]!.active]).toEqual(A);
  });

  it('a tab dropped on another group\'s tab goes in at that tab\'s place', async () => {
    const store = createWorkspaceStore(two());
    await mounted(store);
    drag(tabIn(groupviews()[0]!, 'session:local:a')!, tabIn(groupviews()[1]!, 'session:local:b')!, 10, 15);
    await waitFor(() => expect(store.get().groups.map(g => g.tabs.map(keyOf))).toEqual([['session:local:a', 'session:local:b']]));
    expect(mounts.get('session:local:a')).toBe(1);
  });

  it('a tab dropped on a group\'s right edge opens a new group right of it', async () => {
    const C: Tab = { kind: 'session', ref: 'local:c' };
    const store = createWorkspaceStore(open(two(), C));   // g2: b, c
    await mounted(store);
    drag(tabIn(groupviews()[1]!, 'session:local:b')!, content(groupviews()[0]!), 290, 150);
    await waitFor(() => expect(store.get().groups.map(g => g.tabs.map(keyOf))).toEqual([['session:local:a'], ['session:local:b'], ['session:local:c']]));
    await waitFor(() => expect(groupviews()).toHaveLength(3));
    expect(tabIn(groupviews()[1]!, 'session:local:b')).toBeDefined();
    expect(mounts.get('session:local:b')).toBe(1);
  });

  it('the left, top and bottom edges are refused: nothing moves', async () => {
    const store = createWorkspaceStore(two());
    await mounted(store);
    const before = store.get();
    for (const [x, y] of [[10, 150], [150, 10], [150, 290]] as const) drag(tabIn(groupviews()[0]!, 'session:local:a')!, content(groupviews()[1]!), x, y);
    await new Promise(r => setTimeout(r, 20));
    expect(store.get()).toBe(before);
    expect(groupviews()).toHaveLength(2);
    expect(tabIn(groupviews()[0]!, 'session:local:a')).toBeDefined();
    expect(tabIn(groupviews()[1]!, 'session:local:a')).toBeUndefined();
    expect(store.get().groups.map(g => g.tabs.map(keyOf))).toEqual([['session:local:a'], ['session:local:b']]);
  });

  it('« Déposer ici : nouveau groupe » shows only while a tab is dragged; a drop there opens a group at the right end', async () => {
    const store = createWorkspaceStore(two());
    await mounted(store);
    const zone = document.querySelector<HTMLElement>('.ide-dropnew')!;
    expect(zone.textContent).toBe('Déposer ici :nouveau groupe');
    const root = document.querySelector('.ide-dock-scroll')!;
    expect(root).not.toHaveClass('tab-dragging');
    const tab = tabIn(groupviews()[0]!, 'session:local:a')!;
    fireEvent.dragStart(tab);
    await waitFor(() => expect(root).toHaveClass('tab-dragging'));
    fireEvent.dragOver(zone);
    fireEvent.drop(zone);
    fireEvent.dragEnd(tab);
    await waitFor(() => expect(store.get().groups.map(g => g.tabs.map(keyOf))).toEqual([['session:local:b'], ['session:local:a']]));
    await waitFor(() => expect(root).not.toHaveClass('tab-dragging'));
    await waitFor(() => expect(tabIn(groupviews()[1] ?? document.body, 'session:local:a')).toBeDefined());
    expect(mounts.get('session:local:a')).toBe(1);
  });

  it('the drop zone also goes when the drag ends without a dragend: a drop anywhere, a pointer or mouse let go', async () => {
    const store = createWorkspaceStore(two());
    await mounted(store);
    const root = document.querySelector('.ide-dock-scroll')!;
    const tab = tabIn(groupviews()[0]!, 'session:local:a')!;
    for (const end of [() => fireEvent(window, new Event('drop')), () => fireEvent.pointerUp(window), () => fireEvent.mouseUp(window)]) {
      fireEvent.dragStart(tab);
      await waitFor(() => expect(root).toHaveClass('tab-dragging'));
      end();
      await waitFor(() => expect(root).not.toHaveClass('tab-dragging'));
    }
    expect(store.get().groups.map(g => g.tabs.map(keyOf))).toEqual([['session:local:a'], ['session:local:b']]);
  });

  it('a drop on the zone that is not a tab of the dock (a file, say) does nothing', async () => {
    const store = createWorkspaceStore(two());
    await mounted(store);
    const before = store.get();
    const zone = document.querySelector<HTMLElement>('.ide-dropnew')!;
    fireEvent.dragOver(zone);
    fireEvent.drop(zone);
    expect(store.get()).toBe(before);
  });
});

/** An agent's screen in a tab (as AgentTerminalTab and the session page on Terminal ask for it): the real TermStore over a
 *  backend that counts what it opens and closes, so a move that let the screen go and took it again shows as a reconnect. */
function Screen({ tab, sid }: { tab: Tab; sid: string }) {
  useAgentScreen(sid, LIVE, tab.kind === 'terminal' || tab.view === 'terminal');
  const terms = useContext(TermStoreContext)!;
  const holder = useSyncExternalStore(fn => terms.subscribe(fn), () => terms.viewerOf(sid));
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const s = terms.surface(agentTabId(sid));
    if (holder === keyOf(tab) && s && host.current && s.host.parentElement !== host.current) host.current.appendChild(s.host);
  });
  return <div ref={host} data-testid={`screen-${keyOf(tab)}`} />;
}
function ScreenHost({ store, terms }: { store: WorkspaceStore; terms: TermStore }) {
  const ws = useWorkspace(store);
  return <LangProvider lang="fr"><TermStoreContext.Provider value={terms}>
    <DockHost ws={ws} store={store} title={keyOf} label={keyOf} alert={() => null} onTabMenu={() => {}} onNewSession={() => {}}
      body={tab => (sessionOf(tab) ? <Screen tab={tab} sid={sessionOf(tab)!} /> : <Place tab={tab} />)} emptyGroup={id => <p data-testid={`empty-${id}`}>vide</p>} />
  </TermStoreContext.Provider></LangProvider>;
}
const LIVE: AgentMode = { kind: 'live' };
/** A TermStore over a backend that records what it opens (`argv[1]` is the session) and counts the attachments closed. */
function counted() {
  const backend = fakeBackend();
  const closed: string[] = [];
  const opening = backend.open;
  backend.open = (argv, size, on) => opening(argv, size, on).then(h => (h ? { ...h, close: () => { closed.push(argv[1]!); } } : h));
  const terms = new TermStore({ backend, surface: fakeSurface, agentArgv: id => ['attach', id], shellArgv: () => null, shellPlace: () => ({ dir: '/', remote: false }) });
  return { terms, closed, opened: (sid: string) => backend.opens.filter(o => o.argv[1] === sid).length };
}

describe('a moved tab keeps its agent screen: no reconnect, the same xterm, still attached', () => {
  const T = agentTerminalTab('local:a');
  /** `first` alone in g1 (holding a's screen), B in g2. */
  async function mountTwo(first: Tab) {
    let ws = open(empty(), first);
    ws = splitGroup(ws, ws.focus);
    const store = createWorkspaceStore(open(ws, B));
    const { terms, closed, opened } = counted();
    render(<ScreenHost store={store} terms={terms} />);
    const key = keyOf(first);
    await waitFor(() => expect(terms.viewerOf('local:a')).toBe(key));
    await waitFor(() => expect(terms.link('local:a').state).toBe('attached'));
    const xterm = terms.surface(agentTabId('local:a'))!.host;
    await waitFor(() => expect(screen.getByTestId(`screen-${key}`)).toContainElement(xterm));
    expect(opened('local:a')).toBe(1);
    return { store, terms, closed, opened, key, xterm };
  }
  /** Still the one attachment (none closed, none opened), the same xterm in the same tab's content. */
  async function kept({ terms, closed, opened, key, xterm }: Awaited<ReturnType<typeof mountTwo>>) {
    // Let any effect a move set off run: a hide and a show again would close the attachment and open another.
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(terms.viewerOf('local:a')).toBe(key);
    expect(terms.link('local:a').state).toBe('attached');
    expect(opened('local:a')).toBe(1);
    expect(closed).toEqual([]);
    expect(terms.surface(agentTabId('local:a'))!.host).toBe(xterm);
    expect(screen.getByTestId(`screen-${key}`)).toContainElement(xterm);
  }

  for (const [name, first] of [['the terminal tab', T], ['a session tab on its terminal', { ...A, view: 'terminal' } as Tab]] as const) {
    it(`${name} moved to group B`, async () => {
      const t = await mountTwo(first);
      act(() => t.store.update(w => moveTo(w, t.key, { group: 'g2' })));
      await waitFor(() => expect(groupviews()).toHaveLength(1));
      await kept(t);
    });

    it(`${name} moved to a new group right of the last`, async () => {
      const t = await mountTwo(first);
      act(() => t.store.update(w => moveTo(w, t.key, { rightOf: 'g2' })));
      await waitFor(() => expect(t.store.get().groups.map(g => g.tabs.map(keyOf))).toEqual([[keyOf(B)], [t.key]]));
      await waitFor(() => expect(tabIn(groupviews()[1] ?? document.body, t.key)).toBeDefined());
      await kept(t);
    });
  }

  it('beside() re-homing the terminal tab into a group of another colour', async () => {
    // a's session tab in g2 (teal), the terminal tab in g1 (violet): « Son terminal » from g2 moves it into a teal group.
    const t = await mountTwo(T);
    act(() => t.store.update(w => ({ ...w, groups: w.groups.map(g => ({ ...g, link: g.id === 'g1' ? 'violet' : 'teal' })) })));
    act(() => t.store.update(w => beside(w, 'g2', 'terminal', 'local:a')));
    await waitFor(() => expect(t.store.get().groups.find(g => g.tabs.some(x => keyOf(x) === t.key))!.link).toBe('teal'));
    await waitFor(() => expect(groupviews()).toHaveLength(2));
    await kept(t);
  });
});

describe('a tab mounted by follow does not take a screen a visible view holds', () => {
  const X: Tab = { kind: 'session', ref: 'local:x' };
  it('x chosen in a linked group, on its terminal: the peer\'s terminal follows to x, and x\'s own tab keeps its screen', async () => {
    // g1 (violet): a in front, x behind on its terminal view; g2 (violet): a's terminal, holding a's screen.
    const ws: Workspace = { version: 1, windows: ['main'], focus: 'g1', next: 3, groups: [
      { id: 'g1', window: 'main', tabs: [A, { ...X, view: 'terminal' }], active: 0, link: 'violet' },
      { id: 'g2', window: 'main', tabs: [agentTerminalTab('local:a')], active: 0, link: 'violet' }
    ] };
    const store = createWorkspaceStore(ws);
    const { terms, opened } = counted();
    render(<ScreenHost store={store} terms={terms} />);
    await waitFor(() => expect(terms.viewerOf('local:a')).toBe('terminal:agent:local:a'));
    // x brought forward in g1: x's tab, shown in the focused group, takes x's screen; g2 follows, its front now x's
    // terminal, mounted at the same time, visible but in a group not focused: it leaves the screen to x's tab (R2 note).
    act(() => store.update(w => activate(w, 'g1', 1)));
    await waitFor(() => expect(store.get().groups[1]!.tabs.map(keyOf)).toEqual(['terminal:agent:local:x']));
    await waitFor(() => expect(screen.getByTestId('screen-terminal:agent:local:x')).toBeInTheDocument());
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(terms.viewerOf('local:x')).toBe('session:local:x');
    expect(opened('local:x')).toBe(1);
  });

  it('a terminal tab opened in the focused group takes the screen, as an asked-for view does', async () => {
    const store = createWorkspaceStore(open(empty(), { ...X, view: 'terminal' }));
    const { terms } = counted();
    render(<ScreenHost store={store} terms={terms} />);
    await waitFor(() => expect(terms.viewerOf('local:x')).toBe('session:local:x'));
    act(() => store.update(w => open(w, agentTerminalTab('local:x'), 'right')));
    await waitFor(() => expect(terms.viewerOf('local:x')).toBe('terminal:agent:local:x'));
  });
});

describe('keepScroll puts back the scroll of the known scrollers only', () => {
  it('a [data-keep-scroll] element gets its scroll back; any other is left alone (a move need not walk the whole page)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="kept" data-keep-scroll></div><div class="other"><div class="deep" data-keep-scroll></div></div>';
    const [kept, other, deep] = ['.kept', '.other', '.deep'].map(q => root.querySelector<HTMLElement>(q)!);
    kept!.scrollTop = 120; deep!.scrollLeft = 30; other!.scrollTop = 40;
    const back = keepScroll(root);
    for (const el of [kept!, other!, deep!]) { el.scrollTop = 0; el.scrollLeft = 0; }
    back();
    expect([kept!.scrollTop, deep!.scrollLeft, other!.scrollTop]).toEqual([120, 30, 0]);
  });
});
