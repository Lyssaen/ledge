import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { DaemonInfo, Session } from '@ledge/protocol';
import { createDesktopFleet } from '../../src/fleet/useFleet';
import { App } from '../../src/App';
import { loadWorkspace } from '../../src/session/lazy';
import { loadSettings } from '../../src/settings/lazy';
import { loadChat } from '../../src/chat/lazy';
import { loadIde } from '../../src/ide/lazy';
import { saveResumeOnStart } from '../../src/workspace/prefs';
import { empty, open, serialize } from '../../src/workspace/model';
import { WORKSPACE_KEY } from '../../src/workspace/store';
import { LIVE_TABS_KEY, loadLiveTabs } from '../../src/workspace/resume';
import { PROJECTS } from '../helpers';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
/** A daemon that can resume a session (`archive`: the session management of lot 8). */
const CAN: DaemonInfo = { version: '0.7.0', install: 'npm', systemd: true, archive: true };
const daemons: Daemon[] = [];
beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'fr'); });
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); localStorage.clear(); });

async function mount(sessions: Session[] = [
  fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', branch: 'feat/ide', lastActivityAt: '2026-11-07T10:00:00.000Z' }),
  fakeSession('nova', { name: 'Nova', tool: 'codex', cwd: '/w/ledge', state: 'idle', lastActivityAt: '2026-11-07T09:00:00.000Z' })
]) {
  await Promise.all([loadWorkspace(), loadSettings(), loadChat(), loadIde()]);
 
  const d = await createMockDaemon(); daemons.push(d);
  d.extras.daemon = CAN;
  d.machines([{ id: 'local', label: 'Local' }]);
  d.projects(PROJECTS);
  for (const s of sessions) d.upsert(s);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  await screen.findByRole('complementary', { name: 'Barre latérale' });
  return { d, user: userEvent.setup() };
}

const tabs = () => screen.queryAllByRole('tab').filter(t => t.closest('.dv-tabs-container'));
const welcome = () => document.querySelector<HTMLElement>('.ide-welcome');
const recent = () => within(within(welcome()!).getByRole('region', { name: 'Récentes' }));
const start = () => within(within(welcome()!).getByRole('region', { name: 'Démarrer' }));
const saveTabs = (...refs: string[]) => {
  let w = empty();
  for (const ref of refs) w = open(w, { kind: 'session', ref });
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serialize(w)));
};

describe('the welcome (a group without tabs)', () => {
  it('first run: no tab, the welcome with Ledge\'s mark, what to start and the last sessions, the last active first', async () => {
    await mount();
    await waitFor(() => expect(welcome()).not.toBeNull());
    expect(tabs()).toHaveLength(0);
    expect(welcome()!.querySelector('[data-ledge-mark]')).toHaveAttribute('viewBox', '0 0 64 64');
    await waitFor(() => expect(recent().getAllByRole('button').map(b => b.querySelector('b')?.textContent ?? null)).toEqual(['Otto', 'Nova', null]));
    const otto = recent().getByRole('button', { name: /^Otto/ });
    expect(otto.querySelector('.logo')).toHaveAttribute('title', 'Anthropic');
    expect(recent().getByRole('button', { name: /^Nova/ }).querySelector('.logo')).toHaveAttribute('title', 'OpenAI');
    expect(otto).toHaveTextContent('feat/ide');
    expect(start().queryByRole('button', { name: 'Prochaine demande' })).toBeNull();
    expect(start().getByRole('button', { name: 'Nouvelle session' })).toHaveAttribute('aria-keyshortcuts', 'N');
  });

  it('a recent session opens in this group; closing its tab brings the welcome back', async () => {
    const { user } = await mount();
    await waitFor(() => expect(welcome()).not.toBeNull());
    await user.click(await recent().findByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(tabs().map(t => t.getAttribute('aria-label'))).toEqual(['Otto']));
    expect(welcome()).toBeNull();
    fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    await waitFor(() => expect(welcome()).not.toBeNull());
    expect(tabs()).toHaveLength(0);
  });

  it('« Prochaine demande » only while a session waits; it opens that one', async () => {
    const { d, user } = await mount();
    await waitFor(() => expect(welcome()).not.toBeNull());
    act(() => d.upsert(fakeSession('nova', { name: 'Nova', tool: 'codex', cwd: '/w/ledge', state: 'waiting_input' })));
    await user.click(await start().findByRole('button', { name: 'Prochaine demande' }));
    await waitFor(() => expect(tabs().map(t => t.getAttribute('aria-label'))).toEqual(['Nova']));
  });

  it('« Nouvelle session » opens the launch dialog; « Aller à une session » the search', async () => {
    const { user } = await mount();
    await waitFor(() => expect(welcome()).not.toBeNull());
    await user.click(start().getByRole('button', { name: 'Nouvelle session' }));
    expect(await screen.findByRole('dialog', { name: 'Nouvelle session' })).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nouvelle session' })).toBeNull());
    await user.click(start().getByRole('button', { name: 'Aller à une session' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  });
});

describe('resuming at start the sessions whose tab was open', () => {
  const resumed = (d: Daemon) => d.received.filter(m => m.type === 'session.resume').map(m => (m as { id: string }).id);

  it('a session alive with its tab at the stop, found ended: resumed once, in its tab, said in a toast', async () => {
    saveTabs('local:otto');
    localStorage.setItem(LIVE_TABS_KEY, JSON.stringify(['local:otto']));
    const { d } = await mount([fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'exited' })]);
    await waitFor(() => expect(resumed(d)).toEqual(['otto']));
    expect(await screen.findByText('1 session reprise')).toBeVisible();
    expect(tabs().map(t => t.getAttribute('aria-label'))).toEqual(['Otto']);
    act(() => d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'exited', lastActivityAt: '2026-11-07T11:00:00.000Z' })));
    await new Promise(r => setTimeout(r, 100));
    expect(resumed(d)).toEqual(['otto']);
  });

  it('the setting off: nothing is resumed', async () => {
    saveTabs('local:otto');
    localStorage.setItem(LIVE_TABS_KEY, JSON.stringify(['local:otto']));
    saveResumeOnStart(false);
    const { d } = await mount([fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'exited' })]);
    await waitFor(() => expect(tabs().map(t => t.getAttribute('aria-label'))).toEqual(['Otto']));
    await new Promise(r => setTimeout(r, 300));
    expect(resumed(d)).toEqual([]);
  });

  it('a session ended during the run leaves the memo: the next start does not resume it', async () => {
    saveTabs('local:otto');
    const { d } = await mount([fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' })]);
    await waitFor(() => expect(loadLiveTabs()).toEqual(['local:otto']));
    act(() => d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'exited' })));
    await waitFor(() => expect(loadLiveTabs()).toEqual([]));
    expect(resumed(d)).toEqual([]);
  });
});
