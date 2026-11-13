import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { boot, closeDaemons, listSessions } from './helpers';
import { DEFAULT_VIEW_KEY, getDefaultView, hasLiveScreen, reloadDefaultView, setDefaultView, startViewOf } from '../src/session/defaultView';
import { loadSessionPrefs, saveSessionPrefs, SESSION_KEY } from '../src/session/prefs';
import { routeNav } from '../src/workspace/route';
import { empty, focused, open } from '../src/workspace/model';

/** « Vue par défaut d'une session » (#300, docs/mockups/ledge-session-view-default.html, validated 2026-11-13). */
beforeEach(() => { localStorage.clear(); reloadDefaultView(); });
afterEach(async () => { cleanup(); localStorage.clear(); reloadDefaultView(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await closeDaemons(); });

const shown = () => document.querySelector<HTMLElement>('.session-page')?.dataset.session;
const ctx = (startView?: (id: string) => 'terminal' | undefined) => ({ isSeat: () => false, modalOpen: false, openSession: 'active' as const, ...(startView ? { startView } : {}) });

describe('the setting’s value', () => {
  it('absent or invalid: Fil (the behaviour before); set: kept under its own key', () => {
    expect(getDefaultView()).toBe('thread');
    localStorage.setItem(DEFAULT_VIEW_KEY, 'changes');
    reloadDefaultView();
    expect(getDefaultView()).toBe('thread');
    setDefaultView('terminal');
    expect(localStorage.getItem(DEFAULT_VIEW_KEY)).toBe('terminal');
    reloadDefaultView();
    expect(getDefaultView()).toBe('terminal');
  });

  it('it replaces the memory of the last view: the session page’s preferences no longer keep a view', () => {
    saveSessionPrefs({ view: 'terminal', terminal: true, split: 0.5, termWidth: 0.46 });
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).not.toHaveProperty('view');
    expect(loadSessionPrefs().view).toBe('thread');
  });
});

describe('the view a session starts on (review #300: Terminal only where there is a screen)', () => {
  const base = listSessions().find(s => s.name === 'Nova')!;
  it('a live screen takes the setting; no screen (OMP native, offline, ended, archived, outside tmux): Fil', () => {
    expect(hasLiveScreen(base)).toBe(true);
    expect(startViewOf(base, 'terminal')).toBe('terminal');
    expect(startViewOf(base, 'thread')).toBe('thread');
    expect(startViewOf(base, 'terminal', false)).toBe('thread');
    for (const s of [{ ...base, tool: 'omp' as const, backend: 'omp-rpc' as const, tmuxSession: null }, { ...base, offline: true }, { ...base, state: 'exited' as const },
      { ...base, archivedAt: new Date().toISOString() }, { ...base, tmuxSession: null }]) expect(startViewOf(s, 'terminal')).toBe('thread');
  });
});

describe('a new IDE tab starts on it; an open tab keeps its own', () => {
  it('a machine with no terminal backend (no pseudo-terminal, its daemon streams no pane) opens on the Fil', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true, daemon: { version: '1', install: 'unknown', systemd: false, terminalStream: false } });
    act(() => setDefaultView('terminal'));
    await user.click(within(screen.getByRole('tree', { name: 'Projects, branches and sessions' })).getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(shown()).toBe('local:nova'));
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();
  });
  it('an OMP native session (no screen of its own) opens on the Fil with the setting on Terminal', async () => {
    const sessions = listSessions().map(s => s.name === 'Nova' ? { ...s, tool: 'omp' as const, backend: 'omp-rpc' as const, tmuxSession: null } : s);
    const { user } = await boot({ sessions, list: true });
    act(() => setDefaultView('terminal'));
    await user.click(within(screen.getByRole('tree', { name: 'Projects, branches and sessions' })).getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(shown()).toBe('local:nova'));
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();
  });

  it('routeNav: a new session tab gets startView’s view; a tab already open keeps what it has', () => {
    const w = routeNav({ type: 'open', id: 'b' }, ctx(() => 'terminal')).ws!(empty());
    expect(focused(w).tabs[0]).toEqual({ kind: 'session', ref: 'b', view: 'terminal' });
    const base = open(empty(), { kind: 'session', ref: 'a' });
    const again = routeNav({ type: 'open', id: 'a' }, ctx(() => 'terminal')).ws!(base);
    expect(focused(again).tabs[0]).toEqual({ kind: 'session', ref: 'a' });
    // Fil (or no terminal): no view written, the tab's own rule (the thread) applies.
    expect(focused(routeNav({ type: 'open', id: 'c' }, ctx(() => undefined)).ws!(empty())).tabs[0]).toEqual({ kind: 'session', ref: 'c' });
  });

  it('in the app: on Terminal, a session opens on its Terminal view; a tab opened before the change stays on the thread', async () => {
    // A daemon that streams panes: the machine has a terminal backend (its xterm asks matchMedia, which jsdom lacks).
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
    const { user } = await boot({ sessions: listSessions(), list: true, daemon: { version: '1', install: 'unknown', systemd: false, terminalStream: true } });
    await user.click(screen.getByRole('button', { name: /^Otto,/ }));
    await waitFor(() => expect(shown()).toBe('local:otto'));
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();
    act(() => setDefaultView('terminal'));
    // Otto's tab, open before: unchanged.
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();
    await user.click(within(screen.getByRole('tree', { name: 'Projects, branches and sessions' })).getByRole('button', { name: /^Nova/ }));
    await waitFor(() => expect(shown()).toBe('local:nova'));
    expect(await screen.findByRole('region', { name: 'Terminal' })).toBeInTheDocument();
  });
});

describe('Settings › General', () => {
  it('« Default session view », under « Default agent »: Thread by default; Terminal is kept and says so', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    await user.keyboard('{Control>},{/Control}');
    const group = await screen.findByRole('radiogroup', { name: 'Default session view' });
    const agent = screen.getByRole('radiogroup', { name: 'Default agent' });
    expect(agent.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(group).getByRole('radio', { name: 'Thread' })).toBeChecked();
    expect(screen.getByText('The view a new session opens on. A running OMP seat always opens on the Terminal; a machine without a terminal, on the Thread.')).toBeInTheDocument();
    await user.click(within(group).getByRole('radio', { name: 'Terminal' }));
    expect(localStorage.getItem(DEFAULT_VIEW_KEY)).toBe('terminal');
    expect(await screen.findByText(/Default view: Terminal/)).toBeInTheDocument();
  });
});
