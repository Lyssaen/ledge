import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Session } from '@ledge/protocol';
import { SESSION_KEY, viewShown } from '../src/session/prefs';
import { boot, closeDaemons } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); await closeDaemons(); });

/** docs/mockups/ledge-openrig-omp.html: OMP seats of OpenRig under their rig, their page on their terminal, a stopped one greyed. */
const omp = (id: string, name: string, rig: string, role: string, extra: Partial<Session> = {}): Session =>
  fakeSession(id, { name, tool: 'omp', cwd: `/w/${rig}`, project: rig, title: `${name} · ${role}`, state: 'idle', source: 'rig', tmuxSession: `${role.replace('.', '-')}@${rig}`,
    rig: { seat: `${role.replace('.', '-')}@${rig}`, name: rig, role }, ...extra });
const IVO = omp('rig-ivo', 'Ivo', 'dev-omp', 'dev.agent', { state: 'working' });
const PIA = omp('rig-pia', 'Pia', 'dev-omp', 'review.reviewer');
const TOM = omp('rig-tom', 'Tom', 'split-omp', 'split.splitter', { state: 'exited', exitedAt: '2026-11-03T09:00:00.000Z' });
const ANA = omp('rig-ana', 'Ana', 'split-omp', 'analysis.analyst');


describe('the view an OMP seat’s page shows (Fil | Terminal, design-ux 2026-11-03 12:23Z)', () => {
  it('the preference, for any session but an OMP seat of OpenRig', () => {
    const claude = fakeSession('a');
    expect(viewShown(claude, 'thread', null)).toBe('thread');
    expect(viewShown(claude, 'terminal', { id: 'a', view: 'thread' })).toBe('terminal');
    expect(viewShown(null, 'terminal', null)).toBe('terminal');
    // An OMP session Ledge launched itself (omp-rpc) is not a seat.
    expect(viewShown({ ...IVO, source: 'launcher', backend: 'omp-rpc' }, 'thread', null)).toBe('thread');
  });

  it('running: its Terminal view, unless this visit chose « Fil »; stopped: « Fil »', () => {
    expect(viewShown(IVO, 'thread', null)).toBe('terminal');
    expect(viewShown(IVO, 'thread', { id: 'rig-ivo', view: 'thread' })).toBe('thread');
    expect(viewShown(IVO, 'thread', { id: 'rig-pia', view: 'thread' })).toBe('terminal');
    expect(viewShown(TOM, 'terminal', null)).toBe('thread');
    expect(viewShown({ ...PIA, archivedAt: '2026-11-03T09:30:00.000Z' }, 'terminal', null)).toBe('thread');
  });
});

describe('an OMP seat’s page', () => {
  // The IDE (lot 12b): a seat opens in a tab from its seat in the Atelier; the tab's own view, flipped from its menu.
  const dvTab = (name: string) => screen.getAllByRole('tab').find(t => t.closest('.dv-tabs-container') && t.getAttribute('aria-label') === name)!;
  const onTerminal = () => !!document.querySelector('.ide-pane .session-thread[hidden]') || !!screen.queryByRole('region', { name: 'Terminal' });
  const openSeat = (user: Awaited<ReturnType<typeof boot>>['user'], name: string) => user.click(screen.getByRole('button', { name: new RegExp(`^${name},`) }));
  async function flip(user: Awaited<ReturnType<typeof boot>>['user'], name: string, to: RegExp) {
    fireEvent.contextMenu(dvTab(name));
    await user.click(within(await screen.findByRole('menu', { name: new RegExp(name) })).getByRole('menuitem', { name: to }));
  }

  it('running: it opens on its Terminal view; « Fil » says why there is no thread, with no reply; the preference stays', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ view: 'thread', terminal: false, split: 0.5, termWidth: 0.46 }));
    const { d, user } = await boot({ sessions: [IVO, PIA], projects: { projects: [] } as never });
    d.preview('rig-ivo', ['you > Story ST7-412']);
    await openSeat(user, 'Ivo');
    expect(await screen.findByRole('region', { name: 'Terminal' })).toBeVisible();
    await flip(user, 'Ivo', /Back to the thread/);
    await waitFor(() => expect(document.querySelector('.seat-note')).toHaveTextContent('No thread for this seat. Ledge does not read the conversation of an OMP seat launched by OpenRig. Its Terminal view shows its screen: what you type there is sent to it.'));
    expect(screen.queryByRole('textbox', { name: 'Reply to the agent' })).toBeNull();
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).view).toBe('thread');
    // Another seat opens on its Terminal too; the preference is never written.
    await user.click(screen.getByRole('button', { name: 'Atelier (tab)' }));
    await openSeat(user, 'Pia');
    await waitFor(() => expect(dvTab('Pia')).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(onTerminal()).toBe(true));
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).view).toBe('thread');
  });

  it('a seat’s view never writes the preference: a Claude session keeps its own', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ view: 'thread', terminal: false, split: 0.5, termWidth: 0.46 }));
    const LUC = fakeSession('rig-lu', { name: 'Lu', cwd: '/w/ledge', state: 'idle', source: 'rig', tmuxSession: 'pilot-lead@ledge-dev', rig: { seat: 'pilot-lead@ledge-dev', name: 'ledge-dev', role: 'pilot.lead' } });
    const { user } = await boot({ sessions: [IVO, LUC], projects: { projects: [] } as never });
    await openSeat(user, 'Ivo');
    await screen.findByRole('region', { name: 'Terminal' });
    await flip(user, 'Ivo', /Back to the thread/);
    await flip(user, 'Ivo', /Switch to the terminal/);
    await user.click(screen.getByRole('button', { name: 'Atelier (tab)' }));
    await openSeat(user, 'Lu');
    await waitFor(() => expect(document.querySelector<HTMLElement>('.session-page')?.dataset.session).toBe('local:rig-lu'));
    expect(document.querySelector('.session-page .session-thread')).not.toHaveAttribute('hidden');
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).view).toBe('thread');
  });

  it('stopped: « Fil » says its terminal is gone, no Terminal view to switch to, the OpenRig page one click away', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ view: 'terminal', terminal: false, split: 0.5, termWidth: 0.46 }));
    const { user } = await boot({ sessions: [ANA, TOM], projects: { projects: [] } as never });
    await openSeat(user, 'Tom');
    await waitFor(() => expect(document.querySelector('.seat-note')).toHaveTextContent('Seat stopped. Its terminal is gone: the OpenRig page shows its rig.'));
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();
    fireEvent.contextMenu(dvTab('Tom'));
    const menu = await screen.findByRole('menu', { name: /Tom/ });
    expect(within(menu).queryByRole('menuitem', { name: /Switch to the terminal/ })).toBeNull();
    await user.keyboard('{Escape}');
    // The IDE opens the machine's OpenRig tab.
    await user.click(screen.getByRole('button', { name: 'Open the OpenRig page' }));
    await waitFor(() => expect(screen.getAllByRole('tab').some(t => t.closest('.dv-tabs-container') && /^OpenRig · /.test(t.getAttribute('aria-label') ?? ''))).toBe(true));
  });

  it('a session that turns OMP under the same id comes to its Terminal view, its « Fil » to the note (review)', async () => {
    const seatOf = { seat: 'dev-agent@dev-omp', name: 'dev-omp', role: 'dev.agent' };
    const CLAUDE = fakeSession('rig-dev', { name: 'Ivo', cwd: '/w/dev-omp', state: 'idle', source: 'rig', tmuxSession: 'dev-agent@dev-omp', rig: seatOf });
    const { d, user } = await boot({ sessions: [CLAUDE], projects: { projects: [] } as never });
    await openSeat(user, 'Ivo');
    await waitFor(() => expect(document.querySelector('.session-page .session-thread')).not.toHaveAttribute('hidden'));
    d.upsert({ ...CLAUDE, tool: 'omp' });
    expect(await screen.findByRole('region', { name: 'Terminal' })).toBeVisible();
    await flip(user, 'Ivo', /Back to the thread/);
    await waitFor(() => expect(document.querySelector('.seat-note')).toHaveTextContent('No thread for this seat.'));
  });
});

