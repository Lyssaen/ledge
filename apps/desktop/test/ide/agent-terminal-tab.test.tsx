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
import { agentTerminalTab, empty, open, serialize } from '../../src/workspace/model';
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

async function mount(tabs: ReturnType<typeof agentTerminalTab>[], rig = false) {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serialize(tabs.reduce((w, t) => open(w, t), empty()))));
  await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde()]);
  saveIdeEnabled(true);
  const d = await createMockDaemon(); daemons.push(d);
  d.extras.daemon = { version: '0.49.0', install: 'npm', systemd: true, terminalStream: true }; env.backend = fakeBackend();
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
});
