import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

async function mount(tabs: Tab[], rig = false, pty = true, side = true) {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serialize(tabs.reduce((w, t, i) => open(w, t, i && side ? 'right' : undefined), empty()))));
  await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde()]);
  saveIdeEnabled(true);
  const d = await createMockDaemon(); daemons.push(d);
  d.extras.daemon = { version: '0.49.0', install: 'npm', systemd: true, terminalStream: true }; env.backend = pty ? fakeBackend() : null;
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
