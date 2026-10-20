import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { boot, closeDaemons, declarations, listSessions } from './helpers';
import { App } from '../src/App';
import { clampTermWidth, loadSessionPrefs, SESSION_KEY } from '../src/session/prefs';
import { setTheme } from '../src/shell/theme';
import { TermStore } from '../src/term/store';
import { OBSOLETE_KEYS } from '../src/state/obsolete';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); await closeDaemons(); });

const banner = () => within(screen.getByRole('banner'));
const tree = () => within(screen.getByRole('tree', { name: 'Projects, branches and sessions' }));
async function openOtto() {
  const env = await boot({ sessions: listSessions(), list: true });
  await env.user.click(screen.getByRole('button', { name: /^Otto,/ }));
  await waitFor(() => expect(banner().getByText('Otto')).toBeVisible());
  return env;
}
/** Otto's subagent, from the sidebar tree: it unfolds Otto, then opens Explore. */
async function openExplore(user: Awaited<ReturnType<typeof openOtto>>['user']) {
  await user.click(tree().getByRole('button', { name: /Show Otto.s subagents/ }));
  await user.click(await tree().findByRole('button', { name: /^Explore/ }));
}

describe('the session place, the subagent page, the terminal', () => {
  it("no rail of the project's agents beside the thread: the sidebar tree switches agent", async () => {
    const { user } = await openOtto();
    expect(screen.queryByRole('navigation', { name: /^Agents of the project/ })).toBeNull();
    expect(document.querySelector('.project-rail')).toBeNull();
    await user.click(tree().getByRole('button', { name: /^Nova/ }));
    expect(banner().getByText('Nova')).toBeVisible();
  });

  it('an empty task leaves no lone « · » in the crumb', async () => {
    const sessions = listSessions().map(s => (s.name === 'Otto' ? { ...s, topic: '', title: '' } : s));
    const { user } = await boot({ sessions, list: true });
    await user.click(screen.getByRole('button', { name: /^Otto,/ }));
    await waitFor(() => expect(banner().getByText('Otto')).toBeVisible());
    expect(screen.getByRole('banner').querySelector('.crumb-task')).toBeNull();
  });

  it("a subagent's page: the parent in the breadcrumb, which opens it back", async () => {
    const { user } = await openOtto();
    await openExplore(user);
    expect(banner().getByText('Explore')).toBeVisible();
    expect(banner().getByText('Lire le code')).toHaveClass('crumb-task');
    await user.click(banner().getByRole('button', { name: /Otto/ }));
    expect(banner().queryByText('Explore')).toBeNull();
    expect(banner().getByText('Otto')).toBeVisible();
  });

  it("a subagent's page: its own badge, its parent's title on the crumb, the parent's terminal", async () => {
    const { d, user } = await openOtto();
    await openExplore(user);
    d.preview('otto', ['$ npm test', 'PASS']);
    // Otto waits for an approval, its Explore works: the badge is the subagent's.
    expect(screen.getByRole('banner').querySelectorAll('[data-badge]')).toHaveLength(1);
    expect(screen.getByRole('banner').querySelector('[data-badge]')).toHaveAttribute('data-badge', 'working');
    expect(banner().getByRole('button', { name: /Otto/ })).toHaveAttribute('title', 'Open Otto’s conversation');
    await user.keyboard('o');
    const term = within(await screen.findByRole('region', { name: 'Terminal' }));
    expect(await term.findByText('PASS')).toBeVisible();
  });

  it('O shows the terminal with the preview; it follows to the next agent and is remembered; typing o in the reply does not toggle it', async () => {
    const { d, view, client, user } = await openOtto();
    d.preview('otto', ['$ npm test', 'PASS']); d.preview('bix', ['$ git log']);
    expect(banner().getByRole('button', { name: 'Show the terminal' })).toHaveAttribute('aria-pressed', 'false');
    await user.keyboard('o');
    const term = within(await screen.findByRole('region', { name: 'Terminal' }));
    expect(await term.findByText('PASS')).toBeVisible();
    expect(term.getByText('Read only')).toBeVisible();                              // the browser build: no screen to attach
    expect(JSON.parse(localStorage.getItem('desktop.session')!)).toEqual({ terminal: true, split: 0.5, termWidth: 0.46 });
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');                                  // Bix
    expect(within(screen.getByRole('region', { name: 'Terminal' })).getByText('$ git log')).toBeVisible();
    await user.click(screen.getByRole('textbox', { name: 'Reply to the agent' }));
    await user.keyboard('o');
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeVisible();
    view.unmount();
    render(<App client={client} />);
    await user.click(await screen.findByRole('button', { name: /^Otto,/ }));     // only the prefs survive, never the place
    expect(await screen.findByRole('region', { name: 'Terminal' })).toBeVisible();
  });

  it('session prefs are read field by field, and the key is new', () => {
    expect(loadSessionPrefs()).toEqual({ terminal: false, split: 0.5, termWidth: 0.46 });
    localStorage.setItem(SESSION_KEY, JSON.stringify({ terminal: 'yes', split: 0.9, termWidth: 0.9 }));
    expect(loadSessionPrefs()).toEqual({ terminal: false, split: 0.5, termWidth: 0.46 });
    localStorage.setItem(SESSION_KEY, JSON.stringify({ terminal: true, split: 0.65, termWidth: 0.6 }));
    expect(loadSessionPrefs()).toEqual({ terminal: true, split: 0.65, termWidth: 0.6 });
    expect(OBSOLETE_KEYS).not.toContain(SESSION_KEY);
  });

  it('the thread takes the whole width the sidebar leaves; with the terminal, the two share it by --term-width', () => {
    expect(declarations('session.css', '.conversation-workspace')).toContain('grid-template-columns:minmax(0,1fr)');
    expect(declarations('session.css', '.conversation-workspace.with-terminal')).toBe('grid-template-columns:minmax(0,1fr)0minmax(0,calc(var(--term-width)*100%))');
    expect(declarations('session.css', '.conversation-workspace.term-maxed')).toBe('grid-template-columns:minmax(0,1fr)');
    expect(declarations('session.css', '.term-maxed>.conversation')).toBe('display:none');
  });

  it('the width persists and is clamped; old prefs get the default', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ terminal: true, split: 0.5 }));
    expect(loadSessionPrefs().termWidth).toBe(0.46);
    expect(clampTermWidth(0.9)).toBe(0.7); expect(clampTermWidth(0.1)).toBe(0.28);
    expect(clampTermWidth(0.5 + 0.02)).toBe(0.52);
  });

  it('dragging or arrowing the handle resizes the column', async () => {
    const { user } = await openOtto();
    await user.keyboard('o');
    const handle = await screen.findByRole('separator', { name: 'Terminal width' });
    const workspace = handle.parentElement!;
    expect(workspace).toHaveClass('conversation-workspace', 'with-terminal');
    expect(workspace.style.getPropertyValue('--term-width')).toBe('0.46');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });                                  // the column grows to the left
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).termWidth).toBe(0.48);
    expect(workspace.style.getPropertyValue('--term-width')).toBe('0.48');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).termWidth).toBe(0.46);
    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1000, width: 1000, top: 0, bottom: 800, height: 800, x: 0, y: 0, toJSON: () => ({}) });
    const move = (clientX: number) => act(() => { handle.dispatchEvent(new MouseEvent('pointermove', { clientX, bubbles: true })); });
    fireEvent.pointerDown(handle, { pointerId: 1 });
    move(400);
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).termWidth).toBe(0.6);
    expect(workspace.style.getPropertyValue('--term-width')).toBe('0.6');
    move(50);
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).termWidth).toBe(0.7);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    move(500);
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).termWidth).toBe(0.7);
  });

  it('enlarging hides the thread, the button reduces it again; hiding the pane forgets it', async () => {
    const { user } = await openOtto();
    await user.keyboard('o');
    const term = within(await screen.findByRole('region', { name: 'Terminal' }));
    const workspace = document.querySelector('.conversation-workspace')!;
    await user.click(term.getByRole('button', { name: 'Enlarge the terminal' }));
    expect(workspace).toHaveClass('term-maxed');
    expect(screen.queryByRole('separator', { name: 'Terminal width' })).toBeNull();
    await user.click(term.getByRole('button', { name: 'Shrink the terminal' }));
    expect(workspace).not.toHaveClass('term-maxed');
    await user.click(term.getByRole('button', { name: 'Enlarge the terminal' }));
    await user.click(term.getByRole('button', { name: 'Hide the terminal' }));
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).terminal).toBe(false);
    await user.keyboard('o');
    await screen.findByRole('region', { name: 'Terminal' });
    expect(workspace).not.toHaveClass('term-maxed');
  });

  it('the agent attaches while the pane shows the session, and detaches when hidden', async () => {
    const show = vi.spyOn(TermStore.prototype, 'showAgent');
    const hide = vi.spyOn(TermStore.prototype, 'hideAgent');
    const { user } = await openOtto();
    expect(show).not.toHaveBeenCalled();
    await user.keyboard('o');
    await screen.findByRole('region', { name: 'Terminal' });
    const otto = document.querySelector<HTMLElement>('.session-page')!.dataset.session!;
    // The browser build has no pseudo-terminal: the pane and the store agree on it.
    expect(show).toHaveBeenLastCalledWith(otto, { kind: 'browser' });
    const calls = hide.mock.calls.length;
    await user.keyboard('o');
    expect(hide.mock.calls.length).toBeGreaterThan(calls);
  });

  it("shell 1 opens in the session's folder, on its machine", async () => {
    const show = vi.spyOn(TermStore.prototype, 'showAgent');
    const sessions = listSessions().map(s => (s.name === 'Otto' ? { ...s, workdir: '/w/ledge/.worktrees/desktop' } : s));
    const { user } = await boot({ sessions, list: true });
    await user.click(screen.getByRole('button', { name: /^Otto,/ }));
    await user.keyboard('o');
    await screen.findByRole('region', { name: 'Terminal' });
    const store = show.mock.contexts[0] as TermStore;
    const otto = document.querySelector<HTMLElement>('.session-page')!.dataset.session!;
    expect(store.tabs(otto)[1]).toMatchObject({ kind: 'shell', n: 1, dir: '/w/ledge/.worktrees/desktop', remote: false });
  });

  it('a theme change reaches the terminal store', async () => {
    const themed = vi.spyOn(TermStore.prototype, 'setTheme');
    await openOtto();
    act(() => setTheme('light'));
    await waitFor(() => expect(themed).toHaveBeenCalled());
    const calls = themed.mock.calls.length;
    act(() => setTheme('dark'));
    await waitFor(() => expect(themed.mock.calls.length).toBeGreaterThan(calls));
  });
});
