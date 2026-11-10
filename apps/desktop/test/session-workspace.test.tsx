import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { boot, closeDaemons, declarations, listSessions } from './helpers';
import { clampTermWidth, loadSessionPrefs, SESSION_KEY } from '../src/session/prefs';
import { setTheme } from '../src/shell/theme';
import { TermStore } from '../src/term/store';
import { OBSOLETE_KEYS } from '../src/state/obsolete';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); await closeDaemons(); });

const tree = () => within(screen.getByRole('tree', { name: 'Projects, branches and sessions' }));
/** The session shown in the front tab's page. */
const shown = () => document.querySelector<HTMLElement>('.session-page')?.dataset.session;
/** A dock tab of the IDE, by its name. */
const dvTab = (name: string) => screen.getAllByRole('tab').find(t => t.closest('.dv-tabs-container') && t.getAttribute('aria-label') === name)!;
async function openOtto() {
  const env = await boot({ sessions: listSessions(), list: true });
  await env.user.click(screen.getByRole('button', { name: /^Otto,/ }));
  await waitFor(() => expect(shown()).toBe('local:otto'));
  return env;
}
/** The IDE flips a session tab's view from its menu (right click on the tab). */
async function flip(user: Awaited<ReturnType<typeof openOtto>>['user'], name: string, to: RegExp) {
  fireEvent.contextMenu(dvTab(name));
  await user.click(within(await screen.findByRole('menu', { name: new RegExp(name) })).getByRole('menuitem', { name: to }));
}

describe('the session place, the subagent page, the terminal', () => {
  it("no rail of the project's agents beside the thread: the sidebar tree switches agent", async () => {
    const { user } = await openOtto();
    expect(screen.queryByRole('navigation', { name: /^Agents of the project/ })).toBeNull();
    expect(document.querySelector('.project-rail')).toBeNull();
    await user.click(tree().getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(shown()).toBe('local:nova'));
  });

  it('session prefs are read field by field, and the key is new', () => {
    expect(loadSessionPrefs()).toEqual({ view: 'thread', terminal: false, split: 0.5, termWidth: 0.46 });
    localStorage.setItem(SESSION_KEY, JSON.stringify({ view: 'changes', terminal: 'yes', split: 0.9, termWidth: 0.9 }));
    expect(loadSessionPrefs()).toEqual({ view: 'thread', terminal: false, split: 0.5, termWidth: 0.46 });
    localStorage.setItem(SESSION_KEY, JSON.stringify({ view: 'terminal', terminal: true, split: 0.65, termWidth: 0.6 }));
    expect(loadSessionPrefs()).toEqual({ view: 'terminal', terminal: true, split: 0.65, termWidth: 0.6 });
    expect(OBSOLETE_KEYS).not.toContain(SESSION_KEY);
  });

  it('the page takes the whole width the sidebar leaves; with the panel, the two share it by --term-width; enlarged, the panel lies under the page\'s heading', () => {
    expect(declarations('session.css', '.conversation-workspace')).toContain('grid-template-columns:minmax(0,1fr)');
    expect(declarations('session.css', '.conversation-workspace.with-terminal')).toBe('grid-template-columns:minmax(0,1fr)0minmax(0,calc(var(--term-width)*100%))');
    expect(declarations('session.css', '.conversation-workspace.term-maxed')).toBe('grid-template-columns:minmax(0,1fr);grid-template-rows:autominmax(0,1fr)');
    expect(declarations('session.css', '.term-maxed>.conversation')).toBe('display:contents');
    expect(declarations('session.css', '.term-maxed>.conversation>:not(.pane-heading)')).toBe('display:none');
  });

  it('the width persists and is clamped; old prefs get the default', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ terminal: true, split: 0.5 }));
    expect(loadSessionPrefs().termWidth).toBe(0.46);
    expect(clampTermWidth(0.9)).toBe(0.7); expect(clampTermWidth(0.1)).toBe(0.28);
    expect(clampTermWidth(0.5 + 0.02)).toBe(0.52);
  });

  it('the agent attaches while the Terminal view shows the session, and detaches back on the thread', async () => {
    const show = vi.spyOn(TermStore.prototype, 'showAgent');
    const hide = vi.spyOn(TermStore.prototype, 'hideAgent');
    const { user } = await openOtto();
    expect(show).not.toHaveBeenCalled();                                              // the thread alone attaches nothing
    await flip(user, 'Otto', /Switch to the terminal/);
    await screen.findByRole('region', { name: 'Terminal' });
    const otto = document.querySelector<HTMLElement>('.session-page')!.dataset.session!;
    // The browser build has no pseudo-terminal: the view and the store agree on it.
    // In the IDE the tab holding the screen is named too.
    expect(show).toHaveBeenLastCalledWith(otto, { kind: 'browser' }, `session:${otto}`);
    const calls = hide.mock.calls.length;
    await flip(user, 'Otto', /Back to the thread/);
    await waitFor(() => expect(hide.mock.calls.length).toBeGreaterThan(calls));
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
