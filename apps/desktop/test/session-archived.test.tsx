import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import type { DaemonInfo } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, type MockDaemon } from './helpers';

// « Open in Ledge » is the way to a session no seat shows (the archives have no list yet): the test fires it by hand.
let openTarget: ((raw: string) => void) | null = null;
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), onOpenTarget: (fn: (raw: string) => void) => { openTarget = fn; return () => { openTarget = null; }; } }));

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const CAN: DaemonInfo = { version: '0.7.0', install: 'npm', systemd: true, archive: true };
const ARCHIVED_AT = new Date(Date.now() - 3 * 60_000).toISOString();
const otto = fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', topic: 'Wire the list' });
const bix = fakeSession('bix', { name: 'Bix', cwd: '/w/ledge', state: 'exited', topic: 'Review the PR' });
const old = fakeSession('old', { name: 'Old', cwd: '/w/ledge', state: 'exited', topic: 'Long ago', archivedAt: ARCHIVED_AT });

const sent = (d: MockDaemon) => d.received.filter(m => m.type !== 'snapshot.request');
const showSession = async (id: string) => { await waitFor(() => expect(openTarget).not.toBeNull()); act(() => openTarget!(JSON.stringify({ kind: 'session', id: `local:${id}` }))); };

describe('the page of an archived session', () => {
  it('opens read-only with the banner and the pill; Reprendre sends session.resume', async () => {
    const { d, user } = await boot({ sessions: [otto, bix, old], daemon: CAN });
    await showSession('old');
    const banner = (await screen.findByText('Archived session')).closest<HTMLElement>('.archived-banner')!;
    expect(within(banner).getByText(/3 min ago · the agent is stopped, the conversation is read-only\./)).toBeVisible();
    expect(screen.queryByRole('textbox', { name: /reply/i })).toBeNull();
    expect(document.querySelector('.session-reply')).toBeNull();
    await user.click(within(banner).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(sent(d)).toContainEqual({ type: 'session.resume', id: 'old' }));
    await user.click(within(banner).getByRole('button', { name: 'Put back at the table' }));
    await waitFor(() => expect(sent(d)).toContainEqual({ type: 'session.restore', id: 'old' }));
  });

  it('Delete… on the banner asks, then sends session.delete', async () => {
    const { d, user } = await boot({ sessions: [otto, bix, old], daemon: CAN });
    await showSession('old');
    await user.click(await screen.findByRole('button', { name: 'Delete…' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete for good' }));
    await waitFor(() => expect(sent(d)).toContainEqual({ type: 'session.delete', id: 'old' }));
  });

  it('a page stays open when another client archives its session, and shows the banner', async () => {
    const { d } = await boot({ sessions: [otto, bix], daemon: CAN });
    await showSession('bix');
    await waitFor(() => expect(document.querySelector('.session-reply')).not.toBeNull());
    expect(document.querySelector('.archived-banner')).toBeNull();
    act(() => d.upsert({ ...bix, archivedAt: new Date().toISOString() }));
    expect(await screen.findByText('Archived session')).toBeVisible();
    expect(document.querySelector('.session-page')).not.toBeNull();
    expect(document.querySelector('.session-reply')).toBeNull();
    // Back from the archive: the reply is there again.
    act(() => d.upsert(bix));
    await waitFor(() => expect(document.querySelector('.archived-banner')).toBeNull());
    await waitFor(() => expect(document.querySelector('.session-reply')).not.toBeNull());
  });
});

// The IDE has no page header (lot 12b): a session's « … » is its seat's in the Atelier tab.
describe('the session menu « … »', () => {
  it('opens under its button; Delete… then confirm sends session.delete; the session\'s tab goes with it', async () => {
    const { d, user } = await boot({ sessions: [otto, bix], daemon: CAN });
    await showSession('bix');
    await waitFor(() => expect(document.querySelector('.session-page')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Atelier (tab)' }));
    const more = await screen.findByRole('button', { name: 'Manage Bix' });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(more);
    const menu = await screen.findByRole('menu', { name: 'Manage Bix' });
    expect(menu).toHaveStyle({ position: 'fixed' });
    expect(within(menu).getByRole('menuitem', { name: 'Delete…' })).toHaveTextContent('Del');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(more);
    await user.click(within(await screen.findByRole('menu', { name: 'Manage Bix' })).getByRole('menuitem', { name: 'Delete…' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Delete Bix?' })).getByRole('button', { name: 'Delete for good' }));
    await waitFor(() => expect(sent(d)).toContainEqual({ type: 'session.delete', id: 'bix' }));
    // The daemon drops it: its tab closes.
    act(() => d.remove('bix'));
    await waitFor(() => expect(screen.queryAllByRole('tab').filter(t => t.closest('.dv-tabs-container') && t.getAttribute('aria-label') === 'Bix')).toHaveLength(0));
    expect(screen.getAllByRole('region', { name: 'Atelier' })[0]).toBeVisible();
  });

  it('a live session shows its reply, not the archived banner', async () => {
    await boot({ sessions: [otto, bix], daemon: CAN });
    await showSession('bix');
    await waitFor(() => expect(document.querySelector('.session-reply')).not.toBeNull());
    expect(document.querySelector('.archived-banner')).toBeNull();
  });
});
