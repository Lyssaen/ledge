import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Session } from '@ledge/protocol';
import { createDesktopFleet } from '../../src/fleet/useFleet';
import { App } from '../../src/App';
import { loadWorkspace } from '../../src/session/lazy';
import { loadSettings } from '../../src/settings/lazy';
import { loadHome, loadChat } from '../../src/chat/lazy';
import { loadIde } from '../../src/ide/lazy';
import { saveIdeEnabled } from '../../src/workspace/prefs';
import { TermStore } from '../../src/term/store';
import { PROJECTS } from '../helpers';
import { empty, open, serialize } from '../../src/workspace/model';
import { WORKSPACE_KEY } from '../../src/workspace/store';
import { fakeBackend, fakeSurface } from '../term-fakes';
import type { PtyBackend } from '../../src/term/backend';

// The agent's xterm: jsdom draws none, the fake stands in where a test streams a pane. The app is the desktop one there (a
// pseudo-terminal backend), else the browser build, as the other tests expect.
const env = vi.hoisted(() => ({ backend: null as PtyBackend | null }));
vi.mock('../../src/term/backend', () => ({ ptyBackend: () => env.backend }));
vi.mock('../../src/term/surface', () => ({ createSurface: () => fakeSurface() }));

/** Lot 2, task 5: each session tab keeps its own view, scroll and draft; the keys and the agent's screen follow the active tab. */
type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
// The App's terminal store, caught on its first showAgent: which session's screen it holds.
let store: TermStore | null = null;
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('desktop.lang', 'fr');
  store = null;
  const show = TermStore.prototype.showAgent;
  vi.spyOn(TermStore.prototype, 'showAgent').mockImplementation(function (this: TermStore, ...a: Parameters<TermStore['showAgent']>) { store = this; return show.apply(this, a); });
});
afterEach(async () => { env.backend = null; cleanup(); vi.restoreAllMocks(); for (const d of daemons.splice(0)) await d.close(); saveIdeEnabled(false); localStorage.clear(); });
/** Which tab holds the session's agent screen (R2), null while none shows it. */
const holder = (name: string) => store?.viewerOf(`local:${name}`) ?? null;

const PERMISSION = { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } } as const satisfies Partial<Session>;

/** `stream`: the machine streams the agents' panes (their xterm a fake one), so their screens attach in the test. */
async function mount({ ide = true, stream = false }: { ide?: boolean; stream?: boolean } = {}) {
  await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde()]);
  if (ide) saveIdeEnabled(true);
  const d = await createMockDaemon(); daemons.push(d);
  if (stream) { d.extras.daemon = { version: '0.49.0', install: 'npm', systemd: true, terminalStream: true }; env.backend = fakeBackend(); }
  d.machines([{ id: 'local', label: 'Local' }]);
  d.projects(PROJECTS);
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }));
  d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'working' }));
  // Their threads (empty) arrive: the page's scrolling waits for one.
  d.thread('otto', []); d.thread('nova', []);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  const side = within(await screen.findByRole('complementary', { name: 'Barre latérale' }));
  const tree = within(await side.findByRole('tree', { name: 'Projets, branches et sessions' }));
  await tree.findByRole('button', { name: /^Otto/ });
  return { d, side, tree, user: userEvent.setup() };
}

const tabs = () => screen.queryAllByRole('tab').filter(t => t.closest('.dv-tabs-container'));
const activeTab = () => tabs().find(t => t.getAttribute('aria-selected') === 'true');
const tabOf = (name: string) => tabs().find(t => t.getAttribute('aria-label') === name)!;
const front = (name: string) => act(() => { tabOf(name).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); });
const page = () => document.querySelector<HTMLElement>('.ide-pane .session-page');
const ctrlBackquote = () => fireEvent.keyDown(document.body, { key: '`', code: 'Backquote', ctrlKey: true });
const decided = (d: Daemon) => d.received.filter(m => m.type === 'session.decide') as Array<{ id: string; decision: string }>;

/** Otto and Nova open in tabs, Nova in front. */
async function twoTabs() {
  const m = await mount();
  await m.user.click(m.tree.getByRole('button', { name: /^Otto/ }));
  await m.user.click(m.tree.getByRole('button', { name: /^Nova/ }));
  await waitFor(() => expect(activeTab()).toHaveAccessibleName('Nova'));
  await waitFor(() => expect(page()?.dataset.session).toMatch(/nova/));
  return m;
}

async function toTerminal(user: ReturnType<typeof userEvent.setup>, name: string) {
  fireEvent.contextMenu(tabOf(name));
  await user.click(within(await screen.findByRole('menu', { name: new RegExp(name) })).getByRole('menuitem', { name: /Basculer sur le terminal/ }));
  await waitFor(() => expect(within(tabOf(name)).getByTitle(/^Vue terminal/)).toBeInTheDocument());
}

describe('the session page in an IDE tab', () => {
  it('has no « Vue de la session » switch nor the heading\'s meta; switched off, today\'s page has the switch', async () => {
    const { tree, user } = await mount();
    await user.click(tree.getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(page()?.dataset.session).toMatch(/otto/));
    expect(within(page()!).queryByRole('tablist', { name: 'Vue de la session' })).toBeNull();
    expect(page()!.querySelector('.pane-meta')).toBeNull();
    // Nothing left for the heading: it is not drawn at all.
    expect(page()!.querySelector('.pane-heading')).toBeNull();
    act(() => saveIdeEnabled(false));
    expect(await screen.findByRole('tablist', { name: 'Vue de la session' })).toBeVisible();
  });

  it('each tab keeps its own view; the stored preference is left alone', async () => {
    const { user } = await twoTabs();
    const before = localStorage.getItem('desktop.session');
    await toTerminal(user, 'Otto');
    front('Otto');
    await waitFor(() => expect(page()?.dataset.session).toMatch(/otto/));
    await waitFor(() => expect(page()!.querySelector('.session-thread')).toHaveAttribute('hidden'));
    front('Nova');
    await waitFor(() => expect(page()?.dataset.session).toMatch(/nova/));
    expect(page()!.querySelector('.session-thread')).not.toHaveAttribute('hidden');
    front('Otto');
    await waitFor(() => expect(page()?.dataset.session).toMatch(/otto/));
    expect(page()!.querySelector('.session-thread')).toHaveAttribute('hidden');
    expect(localStorage.getItem('desktop.session')).toBe(before);
  });

  it('a draft typed in Otto\'s reply is there again after Nova; Nova\'s is empty', async () => {
    const { user } = await twoTabs();
    front('Otto');
    await waitFor(() => expect(page()?.dataset.session).toMatch(/otto/));
    await user.type(within(page()!).getByRole('textbox', { name: 'Répondre à l’agent' }), 'Bonjour Otto');
    front('Nova');
    await waitFor(() => expect(page()?.dataset.session).toMatch(/nova/));
    expect(within(page()!).getByRole('textbox', { name: 'Répondre à l’agent' })).toHaveValue('');
    front('Otto');
    await waitFor(() => expect(page()?.dataset.session).toMatch(/otto/));
    expect(within(page()!).getByRole('textbox', { name: 'Répondre à l’agent' })).toHaveValue('Bonjour Otto');
  });

  it('Review Focus 1: Y decides only for the tab in front', async () => {
    const { d, user } = await twoTabs();
    front('Otto');
    await waitFor(() => expect(page()?.dataset.session).toMatch(/otto/));
    act(() => d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', ...PERMISSION })));
    await waitFor(() => expect(tabOf('Nova')).toHaveClass('alert'));
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('y');
    await new Promise(r => setTimeout(r, 50));
    expect(decided(d)).toEqual([]);
    front('Nova');
    await waitFor(() => expect(page()?.dataset.session).toMatch(/nova/));
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('y');
    await waitFor(() => expect(decided(d)).toEqual([expect.objectContaining({ id: 'nova', decision: 'accept' })]));
  });

  it('Review Focus 2: a hidden tab closed on its thread leaves the front tab\'s screen attached', async () => {
    const { user } = await twoTabs();
    await toTerminal(user, 'Otto');
    front('Otto');
    await waitFor(() => expect(holder('otto')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Fermer Nova' }));
    await waitFor(() => expect(tabs()).toHaveLength(2));
    expect(holder('otto')).not.toBeNull();
  });

  it('Y on the terminal view (the focus outside the xterm) accepts the waiting permission', async () => {
    const { d, user } = await twoTabs();
    act(() => d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', ...PERMISSION })));
    await toTerminal(user, 'Otto');
    front('Otto');
    await waitFor(() => expect(page()!.querySelector('.session-thread')).toHaveAttribute('hidden'));
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('y');
    await waitFor(() => expect(decided(d)).toEqual([expect.objectContaining({ id: 'otto', decision: 'accept' })]));
  });

  it('Y on the terminal view of an archived session decides nothing (its thread offers no decision)', async () => {
    const { d, user } = await twoTabs();
    await toTerminal(user, 'Otto');
    act(() => d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', ...PERMISSION, archivedAt: '2026-11-01T10:00:00.000Z' })));
    front('Otto');
    await waitFor(() => expect(page()?.dataset.session).toMatch(/otto/));
    await waitFor(() => expect(page()!.querySelector('.session-thread')).toHaveAttribute('hidden'));
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('y');
    await new Promise(r => setTimeout(r, 50));
    expect(decided(d)).toEqual([]);
  });

  describe('R6: the thread comes back where it was left', () => {
    /** jsdom lays nothing out: the scroller gets a height and a scroll position of its own (1000 px of thread, 100 shown). */
    const sized = () => {
      const el = page()!.querySelector<HTMLElement>('.session-thread')!;
      let top = 0;
      Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1000 });
      Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 100 });
      Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = v; } });
      el.scrollTop = 300;
      fireEvent.scroll(el);
      return el;
    };

    it('after a view set from the tab\'s menu (Terminal, then back to the thread)', async () => {
      const { user } = await twoTabs();
      front('Otto');
      await waitFor(() => expect(page()?.dataset.session).toMatch(/otto/));
      const el = sized();
      await toTerminal(user, 'Otto');
      await waitFor(() => expect(el).toHaveAttribute('hidden'));
      el.scrollTop = 0;   // what Chromium does to a scroller it stops laying out
      fireEvent.contextMenu(tabOf('Otto'));
      await user.click(within(await screen.findByRole('menu', { name: /Otto/ })).getByRole('menuitem', { name: /Revenir au fil/ }));
      await waitFor(() => expect(el).not.toHaveAttribute('hidden'));
      expect(el.scrollTop).toBe(300);
    });

    it('after another tab was in front', async () => {
      await twoTabs();
      front('Otto');
      await waitFor(() => expect(page()?.dataset.session).toMatch(/otto/));
      const el = sized();
      front('Nova');
      await waitFor(() => expect(page()?.dataset.session).toMatch(/nova/));
      el.scrollTop = 0;   // dockview detached it: its position is lost
      front('Otto');
      await waitFor(() => expect(page()?.dataset.session).toMatch(/otto/));
      await waitFor(() => expect(el.scrollTop).toBe(300));
    });
  });

  it('O opens no right panel in the IDE', async () => {
    const { user } = await twoTabs();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('o');
    await new Promise(r => setTimeout(r, 50));
    expect(document.querySelector('.conversation-workspace.with-terminal')).toBeNull();
  });
  it('Ctrl+` flips the front session tab between thread and terminal; on the Atelier it changes no tab', async () => {
    const { user } = await twoTabs();
    front('Otto');
    await waitFor(() => expect(page()?.dataset.session).toMatch(/otto/));
    (document.activeElement as HTMLElement | null)?.blur();
    ctrlBackquote();
    await waitFor(() => expect(within(tabOf('Otto')).getByTitle(/^Vue terminal/)).toBeInTheDocument());
    expect(within(tabOf('Nova')).queryByTitle(/^Vue terminal/)).toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
    ctrlBackquote();
    await waitFor(() => expect(within(tabOf('Otto')).queryByTitle(/^Vue terminal/)).toBeNull());
    // The Atelier in front: no tab changes.
    act(() => { tabOf('Atelier').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); });
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Atelier'));
    (document.activeElement as HTMLElement | null)?.blur();
    ctrlBackquote();
    await new Promise(r => setTimeout(r, 50));
    expect(tabs().some(t => within(t).queryByTitle(/^Vue terminal/))).toBe(false);
  });

  it('N denies the front session\'s waiting permission without opening the launch dialog; without one, N opens it', async () => {
    const { d, user } = await twoTabs();
    act(() => d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', ...PERMISSION })));
    await waitFor(() => expect(tabOf('Nova')).toHaveClass('alert'));
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('n');
    await waitFor(() => expect(decided(d)).toEqual([expect.objectContaining({ id: 'nova', decision: 'deny' })]));
    expect(screen.queryByRole('dialog', { name: 'Nouvelle session' })).toBeNull();
    front('Otto');
    await waitFor(() => expect(page()?.dataset.session).toMatch(/otto/));
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('n');
    expect(await screen.findByRole('dialog', { name: 'Nouvelle session' })).toBeVisible();
  });

  it('Review Focus 1, lot 3: two groups each on a terminal keep both screens, whichever is focused; an update of one asks nothing of the other', async () => {
    // Otto's tab in the first group, Nova's in a second (focused), both on their terminal view, their machine streaming panes.
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serialize(open(open(empty(), { kind: 'session', ref: 'local:otto', view: 'terminal' }), { kind: 'session', ref: 'local:nova', view: 'terminal' }, 'right'))));
    const { d } = await mount({ stream: true });
    await waitFor(() => expect(document.querySelectorAll('.ide-dock .dv-groupview')).toHaveLength(2));
    const watched = () => d.received.filter(m => m.type === 'term.watch').map(m => (m as { id: string }).id);
    const unwatched = () => d.received.filter(m => m.type === 'term.unwatch');
    await waitFor(() => expect(watched().sort()).toEqual(['nova', 'otto']));
    const screens = () => [...document.querySelectorAll('.ide-dock .agent-view')].map(v => v.querySelector('[data-terminal]') !== null);
    await waitFor(() => expect(screens()).toEqual([true, true]));
    front('Otto');
    await waitFor(() => expect(document.querySelector('.dv-active-group')).toContainElement(tabOf('Otto')));
    front('Nova');
    await waitFor(() => expect(document.querySelector('.dv-active-group')).toContainElement(tabOf('Nova')));
    expect(screens()).toEqual([true, true]);
    expect([holder('otto'), holder('nova')].every(h => h !== null)).toBe(true);
    const shows = vi.mocked(TermStore.prototype.showAgent).mock.calls.length;
    act(() => d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'idle' })));
    await new Promise(r => setTimeout(r, 100));
    expect(vi.mocked(TermStore.prototype.showAgent).mock.calls.slice(shows).filter(([sid]) => /otto/.test(sid))).toEqual([]);
    expect(watched()).toHaveLength(2);
    expect(unwatched()).toEqual([]);
    expect(screens()).toEqual([true, true]);
  });

  it('a tab hidden in its group lets its agent screen go; brought back, it attaches again', async () => {
    // Otto's and Nova's tabs in one group, both on their terminal view, Nova in front.
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serialize(open(open(empty(), { kind: 'session', ref: 'local:otto', view: 'terminal' }), { kind: 'session', ref: 'local:nova', view: 'terminal' }))));
    const { d } = await mount({ stream: true });
    const watched = () => d.received.filter(m => m.type === 'term.watch').map(m => (m as { id: string }).id);
    const unwatched = () => d.received.filter(m => m.type === 'term.unwatch').map(m => (m as { id: string }).id);
    await waitFor(() => expect(holder('nova')).not.toBeNull());
    expect(holder('otto')).toBeNull();
    front('Otto');
    await waitFor(() => expect(holder('otto')).not.toBeNull());
    expect(holder('nova')).toBeNull();
    expect(unwatched()).toEqual(['nova']);
    front('Nova');
    await waitFor(() => expect(holder('nova')).not.toBeNull());
    expect(holder('otto')).toBeNull();
    expect(unwatched()).toEqual(['nova', 'otto']);
    expect(watched()).toEqual(['nova', 'otto', 'nova']);
  });

  it('R2: the same session in two groups; the tab holding its screen goes back to its thread, the other takes the screen', async () => {
    // Otto as a session tab in the first group and as a seat tab in a second, both on the terminal view.
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serialize(open(open(empty(), { kind: 'session', ref: 'local:otto', view: 'terminal' }), { kind: 'seat', ref: 'local:otto', view: 'terminal' }, 'right'))));
    await mount({ stream: true });
    const groups = () => [...document.querySelectorAll<HTMLElement>('.ide-dock .dv-groupview')];
    await waitFor(() => expect(groups()).toHaveLength(2));
    await waitFor(() => expect(holder('otto')).not.toBeNull());
    const views = () => [...document.querySelectorAll<HTMLElement>('.ide-dock .agent-view')];
    await waitFor(() => expect(views()).toHaveLength(2));
    const held = holder('otto')!;
    const byKey = (k: string) => views().find(v => (k.startsWith('seat:') ? groups()[1] : groups()[0])!.contains(v))!;
    const other = held.startsWith('seat:') ? 'session:local:otto' : 'seat:local:otto';
    await waitFor(() => expect(byKey(held).querySelector('[data-terminal]')).not.toBeNull());
    expect(byKey(other)).toHaveTextContent('Terminal affiché dans l’autre groupe');
    // The holder's tab in front of the focused group, then Ctrl+`: back to its thread.
    const holderTab = within(held.startsWith('seat:') ? groups()[1]! : groups()[0]!).getAllByRole('tab')[0]!;
    act(() => { holderTab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); });
    await waitFor(() => expect(document.querySelector('.dv-active-group')).toContainElement(holderTab));
    ctrlBackquote();
    await waitFor(() => expect(holder('otto')).toBe(other));
    await waitFor(() => expect(byKey(other).querySelector('[data-terminal]')).not.toBeNull());
    expect(byKey(other)).not.toHaveTextContent('Terminal affiché dans l’autre groupe');
  });

  it('the tab menu reads the tab as it is now; it goes when its tab goes', async () => {
    const { d, tree, user } = await twoTabs();
    front('Otto');
    await waitFor(() => expect(page()?.dataset.session).toMatch(/otto/));
    fireEvent.contextMenu(tabOf('Otto'));
    const menu = await screen.findByRole('menu', { name: /Otto/ });
    expect(within(menu).getByRole('menuitem', { name: /Basculer sur le terminal/ })).toBeInTheDocument();
    // The view changes while the menu is open (Ctrl + ` on the front tab): the menu follows.
    ctrlBackquote();
    await waitFor(() => expect(within(tabOf('Otto')).getByTitle(/^Vue terminal/)).toBeInTheDocument());
    await waitFor(() => expect(within(screen.getByRole('menu', { name: /Otto/ })).getByRole('menuitem', { name: /Revenir au fil/ })).toBeInTheDocument());
    // Its tab gone (the session deleted), the menu goes and stays gone when a tab of that name comes back.
    act(() => d.remove('otto'));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    act(() => d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' })));
    await user.click(await tree.findByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Y typed in the reply is written, and decides nothing', async () => {
    const { d, user } = await twoTabs();
    act(() => d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', ...PERMISSION })));
    await waitFor(() => expect(tabOf('Nova')).toHaveClass('alert'));
    const box = within(page()!).getByRole('textbox', { name: 'Répondre à l’agent' });
    await user.type(box, 'yn');
    expect(box).toHaveValue('yn');
    expect(decided(d)).toEqual([]);
  });

});
