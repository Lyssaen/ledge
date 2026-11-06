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
afterEach(async () => { cleanup(); vi.restoreAllMocks(); for (const d of daemons.splice(0)) await d.close(); saveIdeEnabled(false); localStorage.clear(); });
const shownSid = () => (store as unknown as { shown: { sid: string } | null } | null)?.shown?.sid ?? null;

const PERMISSION = { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } } as const satisfies Partial<Session>;

async function mount({ ide = true }: { ide?: boolean } = {}) {
  await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde()]);
  if (ide) saveIdeEnabled(true);
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }]);
  d.projects(PROJECTS);
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }));
  d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'working' }));
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
  await waitFor(() => expect(within(tabOf(name)).getByTitle('Vue terminal')).toBeInTheDocument());
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
    await waitFor(() => expect(shownSid()).toMatch(/otto/));
    await user.click(screen.getByRole('button', { name: 'Fermer Nova' }));
    await waitFor(() => expect(tabs()).toHaveLength(2));
    expect(shownSid()).toMatch(/otto/);
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

  it('O opens no right panel in the IDE', async () => {
    const { user } = await twoTabs();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('o');
    await new Promise(r => setTimeout(r, 50));
    expect(document.querySelector('.conversation-workspace.with-terminal')).toBeNull();
  });
});
