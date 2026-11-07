import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../../src/fleet/useFleet';
import { App } from '../../src/App';
import { loadWorkspace } from '../../src/session/lazy';
import { loadSettings } from '../../src/settings/lazy';
import { loadHome, loadChat } from '../../src/chat/lazy';
import { loadIde } from '../../src/ide/lazy';
import { saveIdeEnabled } from '../../src/workspace/prefs';
import { TermStore } from '../../src/term/store';
import { PROJECTS } from '../helpers';
import { agentTerminalTab, empty, open, serialize, type Tab } from '../../src/workspace/model';
import { WORKSPACE_KEY } from '../../src/workspace/store';
import { fakeBackend, fakeSurface } from '../term-fakes';
import type { PtyBackend } from '../../src/term/backend';

const env = vi.hoisted(() => ({ backend: null as PtyBackend | null, readOnly: [] as boolean[] }));
vi.mock('../../src/term/backend', () => ({ ptyBackend: () => env.backend }));
vi.mock('../../src/term/surface', () => ({
  createSurface: () => { const s = fakeSurface(); s.setReadOnly = (v: boolean) => { env.readOnly.push(v); }; return s; }
}));

/** Lot 3, task 3: an agent's terminal in a tab of its own (`terminal:agent:<id>`). */
type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
let store: TermStore | null = null;
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('desktop.lang', 'fr');
  store = null; env.readOnly = [];
  const show = TermStore.prototype.showAgent;
  vi.spyOn(TermStore.prototype, 'showAgent').mockImplementation(function (this: TermStore, ...a: Parameters<TermStore['showAgent']>) { store = this; return show.apply(this, a); });
});
afterEach(async () => { env.backend = null; cleanup(); vi.restoreAllMocks(); for (const d of daemons.splice(0)) await d.close(); saveIdeEnabled(false); localStorage.clear(); });

async function mount(tabs: Tab[], rig = false, pty = true, side = true, terminalStream = true) {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serialize(tabs.reduce((w, t, i) => open(w, t, i && side ? 'right' : undefined), empty()))));
  await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde()]);
  saveIdeEnabled(true);
  const d = await createMockDaemon(); daemons.push(d);
  d.extras.daemon = { version: '0.49.0', install: 'npm', systemd: true, terminalStream }; d.extras.launcher = ['ledge']; env.backend = pty ? fakeBackend() : null;
  d.machines([{ id: 'local', label: 'Local' }]);
  d.projects(PROJECTS);
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', ...(rig ? { rig: { seat: 'dev@r', name: 'ledge-dev' } } : {}) }));
  d.thread('otto', []);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  return d;
}
const tabs = () => screen.queryAllByRole('tab').filter(t => t.closest('.dv-tabs-container'));
const view = () => document.querySelector<HTMLElement>('.ide-term');

describe('an agent\'s terminal tab', () => {
  it('terminal:agent:local:otto draws Otto\'s screen under the « attaché » chip, titled « >_ Otto · tmux »', async () => {
    await mount([agentTerminalTab('local:otto')]);
    await waitFor(() => expect(tabs().map(t => t.getAttribute('aria-label'))).toEqual(['>_ Otto · tmux']));
    await waitFor(() => expect(view()!.querySelector('[data-terminal]')).not.toBeNull());
    expect(within(view()!).getByText('attaché')).toBeInTheDocument();
    expect(view()!.querySelector('.ide-term-kind')).toBeTruthy();
    // No footer (lot 3 follow-up): its state and tmux target sit on the kind's row, on its right, muted.
    expect(view()!.querySelector('.terminal-footer')).toBeNull();
    await waitFor(() => expect(view()!.querySelector('.ide-term-kind .ide-term-where')).toHaveTextContent('tmux · ledge-otto'));
    // Attached, the chip says it: the state is not said twice (review).
    expect(view()!.querySelector('.ide-term-kind .ide-term-state')).toBeNull();
    expect(store?.viewerOf('local:otto')).toMatch(/^terminal:agent:/);
    expect(env.readOnly).not.toContain(true);
  });

  it('a seat\'s terminal is a capture: « lecture seule », and its screen refuses typing', async () => {
    await mount([agentTerminalTab('local:otto')], true);
    await waitFor(() => expect(view()!.querySelector('[data-terminal]')).not.toBeNull());
    expect(within(view()!).getAllByText('lecture seule').length).toBeGreaterThan(0);
    expect(within(view()!).queryByText('attaché')).toBeNull();
    expect(env.readOnly).toContain(true);
    expect(view()!.querySelector('.agent-view')).toHaveAttribute('data-typeable', 'false');
  });

  it('a capture over the pseudo-terminal attaches read-only: `attach --read-only`, the screen set read-only, nothing streamed', async () => {
    const d = await mount([agentTerminalTab('local:otto')], true, true, true, false);
    const backend = env.backend as ReturnType<typeof fakeBackend>;
    await waitFor(() => expect(backend.opens).toHaveLength(1));
    expect(backend.opens[0]!.argv.slice(-3)).toEqual(['attach', '--read-only', 'otto']);
    expect(env.readOnly).toContain(true);
    expect(env.readOnly).not.toContain(false);
    expect(d.received.filter(m => m.type === 'term.watch')).toEqual([]);
  });

  it('a capture over the daemon\'s stream attaches read-only: term.watch says readOnly, the screen set read-only, no pseudo-terminal', async () => {
    const d = await mount([agentTerminalTab('local:otto')], true);
    await waitFor(() => expect(d.received.filter(m => m.type === 'term.watch')).toHaveLength(1));
    expect(d.received.find(m => m.type === 'term.watch')).toMatchObject({ id: 'otto', readOnly: true });
    expect(env.readOnly).toContain(true);
    expect(env.readOnly).not.toContain(false);
    expect((env.backend as ReturnType<typeof fakeBackend>).opens).toEqual([]);
  });

  it('Otto removed: its terminal tab closes', async () => {
    const d = await mount([agentTerminalTab('local:otto')]);
    await waitFor(() => expect(tabs()).toHaveLength(1));
    act(() => d.remove('otto'));
    await waitFor(() => expect(tabs()).toHaveLength(0));
  });

  it('a stream-only machine (no pseudo-terminal, a daemon that streams panes) draws the screen in the terminal tab and in the session tab on Terminal', async () => {
    await mount([agentTerminalTab('local:otto'), { kind: 'session', ref: 'local:otto', view: 'terminal' }], false, false);
    await waitFor(() => expect(document.querySelectorAll('.ide-dock .dv-groupview')).toHaveLength(2));
    // Both views of Otto: one holds the screen, the other says so (R2); the screen is a real one, not the browser's preview.
    await waitFor(() => expect(document.querySelectorAll('.ide-dock [data-terminal]')).toHaveLength(1));
    expect(store?.viewerOf('local:otto')).not.toBeNull();
  });

  it('a session tab on Terminal and its terminal tab: one holds the screen, the other shows the R2 note', async () => {
    await mount([agentTerminalTab('local:otto'), { kind: 'session', ref: 'local:otto', view: 'terminal' }]);
    await waitFor(() => expect(document.querySelectorAll('.ide-dock .dv-groupview')).toHaveLength(2));
    await waitFor(() => expect(document.querySelectorAll('.ide-dock [data-terminal]')).toHaveLength(1));
    expect(screen.getAllByText('Terminal affiché dans l’autre groupe')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Afficher ici' })).toBeInTheDocument();
  });

  it('dragged onto the bottom panel: a tile holding the same screen (its own place, no reconnect), its kind said once', async () => {
    // jsdom has no PointerEvent, which dockview tells drags apart with.
    const hadPointer = 'PointerEvent' in globalThis;
    if (!hadPointer) (globalThis as { PointerEvent?: unknown }).PointerEvent = class extends MouseEvent {};
    onTestFinished(() => { if (!hadPointer) delete (globalThis as { PointerEvent?: unknown }).PointerEvent; });
    // Over the pseudo-terminal (no stream): each attachment is an `attach` the backend opens.
    await mount([agentTerminalTab('local:otto'), { kind: 'settings', ref: '' } as Tab], false, true, false, false);
    await waitFor(() => expect(tabs()).toHaveLength(2));
    const front = tabs().find(t => /tmux$/.test(t.getAttribute('aria-label') ?? ''))!;
    act(() => { front.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); });
    await waitFor(() => expect(store?.viewerOf('local:otto')).toMatch(/^terminal:agent:/));
    const xterm = document.querySelector('.ide-dock [data-terminal]');
    expect(xterm).not.toBeNull();
    const attaches = () => (env.backend as ReturnType<typeof fakeBackend>).opens.filter(o => o.argv.includes('attach') && o.argv.at(-1) === 'otto').length;
    await waitFor(() => expect(attaches()).toBeGreaterThan(0));
    const before = attaches();
    act(() => { fireEvent.keyDown(window, { key: 'j', ctrlKey: true }); });
    const panel = await screen.findByRole('region', { name: 'Panneau du bas' });
    await waitFor(() => expect(panel.querySelectorAll('.ide-btile')).toHaveLength(1));
    fireEvent.dragStart(front.closest('.dv-tab') ?? front);
    fireEvent.dragOver(panel);
    fireEvent.drop(panel);
    await waitFor(() => expect(panel.querySelectorAll('.ide-btile')).toHaveLength(2));
    const tile = panel.querySelectorAll<HTMLElement>('.ide-btile')[1]!;
    await waitFor(() => expect(store?.viewerOf('local:otto')).toBe('panel:agent:local:otto'));
    await waitFor(() => expect(tile.querySelector('[data-terminal]')).toBe(xterm));
    expect(tile.querySelector('.ide-term-kind')).toBeNull();
    expect(within(tile).getAllByText('attaché')).toHaveLength(1);
    expect(attaches()).toBe(before);
    expect(tabs().map(t => t.getAttribute('aria-label'))).toEqual(['Réglages']);

    // And back into a new group: its tab holds the same screen, still without a reconnect.
    const tileTab = within(tile).getByText('>_ Otto · tmux');
    fireEvent.dragStart(tileTab);
    const zone = document.querySelector<HTMLElement>('.ide-dropnew')!;
    fireEvent.dragOver(zone);
    fireEvent.drop(zone);
    await waitFor(() => expect(tabs().map(t => t.getAttribute('aria-label'))).toEqual(['Réglages', '>_ Otto · tmux']));
    await waitFor(() => expect(store?.viewerOf('local:otto')).toBe('terminal:agent:local:otto'));
    await waitFor(() => expect(document.querySelector('.ide-dock .ide-term [data-terminal]')).toBe(xterm));
    expect(panel.querySelectorAll('.ide-btile')).toHaveLength(1);
    expect(attaches()).toBe(before);
  });

  it('in a tile, a state no banner says (connecting) shows on a row of its own, without the kind chip; attached, the row goes', async () => {
    const hadPointer = 'PointerEvent' in globalThis;
    if (!hadPointer) (globalThis as { PointerEvent?: unknown }).PointerEvent = class extends MouseEvent {};
    onTestFinished(() => { if (!hadPointer) delete (globalThis as { PointerEvent?: unknown }).PointerEvent; });
    await mount([agentTerminalTab('local:otto'), { kind: 'settings', ref: '' } as Tab], false, true, false, false);
    const backend = env.backend as ReturnType<typeof fakeBackend>;
    backend.hold(true);   // Otto's attachment and the shell stay opening
    await waitFor(() => expect(tabs()).toHaveLength(2));
    act(() => { fireEvent.keyDown(window, { key: 'j', ctrlKey: true }); });
    const panel = await screen.findByRole('region', { name: 'Panneau du bas' });
    await waitFor(() => expect(panel.querySelectorAll('.ide-btile')).toHaveLength(1));
    const tab = tabs().find(t => /tmux$/.test(t.getAttribute('aria-label') ?? ''))!;
    fireEvent.dragStart(tab.closest('.dv-tab') ?? tab);
    fireEvent.dragOver(panel);
    fireEvent.drop(panel);
    await waitFor(() => expect(panel.querySelectorAll('.ide-btile')).toHaveLength(2));
    const tile = panel.querySelectorAll<HTMLElement>('.ide-btile')[1]!;
    await waitFor(() => expect(tile.querySelector('.ide-term-kind .ide-term-state')).toHaveTextContent('Connexion…'));
    expect(tile.querySelector('.ide-term-kind .chip-k')).toBeNull();
    act(() => { for (const o of backend.opens) o.resolve(true); });
    await waitFor(() => expect(tile.querySelector('.ide-term-kind')).toBeNull());
    expect(within(tile).getAllByText('attaché')).toHaveLength(1);
  });

  it('a hidden terminal tab releases its screen; brought back, it attaches again', async () => {
    await mount([agentTerminalTab('local:otto'), { kind: 'settings', ref: '' } as Tab], false, true, false);
    const held = () => store?.viewerOf('local:otto') ?? null;
    const front = (name: RegExp) => act(() => { tabs().find(t => name.test(t.getAttribute('aria-label') ?? ''))!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })); });
    await waitFor(() => expect(tabs()).toHaveLength(2));
    front(/tmux$/);
    await waitFor(() => expect(held()).not.toBeNull());
    front(/^Réglages$/);
    await waitFor(() => expect(held()).toBeNull());
    front(/tmux$/);
    await waitFor(() => expect(held()).not.toBeNull());
  });

  it('an OMP session\'s terminal tab offers no shell button (it has no screen, and the shell lives in the session)', async () => {
    const d = await mount([agentTerminalTab('local:otto')]);
    act(() => d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', backend: 'omp-rpc' } as never)));
    await waitFor(() => expect(document.querySelector('.agent-native')).not.toBeNull());
    expect(within(document.querySelector<HTMLElement>('.agent-native')!).queryByRole('button')).toBeNull();
  });
});
