import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LangProvider } from '../../src/i18n/lang';
import { DockHost } from '../../src/ide/DockHost';
import { activate, beside, deserialize, empty, keyOf, open, serialize, split as splitGroup, type Tab } from '../../src/workspace/model';
import { createWorkspaceStore, useWorkspace, type WorkspaceStore } from '../../src/workspace/store';
import { useTabPlace } from '../../src/workspace/tabPlace';

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
    expect(square().closest('.dv-left-actions-container')).not.toBeNull();
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
    const store = createWorkspaceStore(ws);
    render(<Host store={store} />);
    await waitFor(() => expect(groupviews()).toHaveLength(4));
    // dockview's own element (.ide-dockview) fills the sized box, which its scroller lets overflow the editing area.
    const dock = document.querySelector<HTMLElement>('.ide-dock-sized')!;
    expect(dock.style.minWidth).toBe('1200px');
    expect(dock.parentElement).toHaveClass('ide-dock-scroll');
    expect(dock.querySelector('.ide-dockview')).not.toBeNull();
    act(() => store.update(w => splitGroup(w, w.focus)));
    await waitFor(() => expect(dock.style.minWidth).toBe('1500px'));
  });
});
