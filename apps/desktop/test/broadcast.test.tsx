import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { ClientMessage } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, PROJECTS, type MockDaemon } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const SESSIONS = [
  fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }),
  fakeSession('bix', { name: 'Bix', cwd: '/w/ledge', state: 'working' }),
  fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working' })
];
type Broadcast = Extract<ClientMessage, { type: 'session.broadcast' }>;
const broadcasts = (d: MockDaemon) => d.received.filter((m): m is Broadcast => m.type === 'session.broadcast');
const banner = () => within(screen.getByRole('banner'));
const tree = (side: ReturnType<typeof within>) => within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));

/** The local daemon answers each broadcast: Otto and Bix got it, Zed refused. */
function answering(d: MockDaemon) {
  d.onMessage(m => {
    if (m.type !== 'session.broadcast') return;
    d.reply({ type: 'session.broadcast.result', rid: m.rid, sent: [{ id: 'otto', name: 'Otto' }, { id: 'bix', name: 'Bix' }], refused: [{ name: 'Zed', reason: 'Zed n’a pas été lancée par Ledge : impossible de lui écrire' }] });
  });
}

describe('writing to a whole project', () => {
  it('the room’s plaque menu opens the dialog; Send writes to the project and says who got it', async () => {
    const { d, user } = await boot({ sessions: SESSIONS, projects: PROJECTS });
    answering(d);
    await user.click(screen.getByRole('button', { name: 'Actions of the Ledge room' }));
    await user.click(screen.getByRole('menuitem', { name: 'Write to the whole project…' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Write to Ledge' }));
    const send = dialog.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await user.type(dialog.getByRole('textbox'), 'Pause the deploys');
    await user.click(send);
    await waitFor(() => expect(broadcasts(d)).toEqual([{ type: 'session.broadcast', rid: expect.any(String), to: { project: 'ledge' }, text: 'Pause the deploys' }]));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Write to Ledge' })).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Delivered to 2 sessions: Otto, Bix');
    expect(screen.getByRole('status')).toHaveTextContent('Refused: Zed n’a pas été lancée par Ledge');
  });

  it('the sidebar’s project row has a ✉ beside +, which opens the same dialog', async () => {
    const { side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS });
    await user.click(side.getByRole('button', { name: 'Write to Payment Service Platform Migration Europe' }));
    expect(await screen.findByRole('dialog', { name: 'Write to Payment Service Platform Migration Europe' })).toBeVisible();
    expect(side.getByRole('button', { name: 'New session in Ledge' })).toBeVisible();
  });

  it('nothing went: the dialog stays open with the daemon’s reason', async () => {
    const { d, side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS });
    d.onMessage(m => { if (m.type === 'session.broadcast') d.reply({ type: 'session.broadcast.result', rid: m.rid, sent: [], refused: [], reason: 'personne d’autre dans le projet Ledge' }); });
    await user.click(side.getByRole('button', { name: 'Write to Ledge' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Write to Ledge' }));
    await user.type(dialog.getByRole('textbox'), 'Hello');
    await user.click(dialog.getByRole('button', { name: 'Send' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('personne d’autre dans le projet Ledge');
    expect(screen.getByRole('dialog', { name: 'Write to Ledge' })).toBeVisible();
  });
});

describe('writing to the sessions selected in the sidebar', () => {
  it('Ctrl + click picks sessions; from two, the bar writes to them', async () => {
    const { d, side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS });
    answering(d);
    const rows = tree(side);
    await user.keyboard('{Control>}');
    await user.click(rows.getByRole('button', { name: /^Otto/ }));
    expect(side.queryByRole('region', { name: 'Selected sessions' })).toBeNull();
    await user.click(rows.getByRole('button', { name: /^Bix/ }));
    await user.keyboard('{/Control}');
    // A Ctrl + click opens nothing.
    expect(banner().queryByText('Otto')).toBeNull();
    expect(rows.getByRole('button', { name: /^Otto/ }).closest('[role="treeitem"]')).toHaveClass('picked');
    const bar = within(side.getByRole('region', { name: 'Selected sessions' }));
    await user.click(bar.getByRole('button', { name: 'Write to the 2 sessions…' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Write to Otto, Bix' }));
    await user.type(dialog.getByRole('textbox'), 'Rebase on main');
    await user.click(dialog.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(broadcasts(d)).toEqual([{ type: 'session.broadcast', rid: expect.any(String), to: { sessions: ['otto', 'bix'] }, text: 'Rebase on main' }]));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Delivered to 2 sessions: Otto, Bix'));
  });

  it('a second Ctrl + click takes a session out; Escape and Cancel empty the selection', async () => {
    const { side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS });
    const rows = tree(side);
    const pick = async (name: RegExp) => { await user.keyboard('{Control>}'); await user.click(rows.getByRole('button', { name })); await user.keyboard('{/Control}'); };
    await pick(/^Otto/); await pick(/^Bix/); await pick(/^Nova/);
    expect(within(side.getByRole('region', { name: 'Selected sessions' })).getByRole('button', { name: 'Write to the 3 sessions…' })).toBeVisible();
    await pick(/^Nova/);
    expect(within(side.getByRole('region', { name: 'Selected sessions' })).getByRole('button', { name: 'Write to the 2 sessions…' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(side.queryByRole('region', { name: 'Selected sessions' })).toBeNull();
    expect(document.querySelector('.st .picked')).toBeNull();
    await pick(/^Otto/); await pick(/^Bix/);
    await user.click(within(side.getByRole('region', { name: 'Selected sessions' })).getByRole('button', { name: 'Cancel' }));
    expect(side.queryByRole('region', { name: 'Selected sessions' })).toBeNull();
  });

  it('a plain click still opens the session', async () => {
    const { side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS });
    await user.click(tree(side).getByRole('button', { name: /^Otto/ }));
    expect(banner().getByText('Otto')).toBeVisible();
    expect(side.queryByRole('region', { name: 'Selected sessions' })).toBeNull();
  });
});
