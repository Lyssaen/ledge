import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MESSAGE_MAX, type ClientMessage, type DaemonInfo } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, PROJECTS, type MockDaemon } from './helpers';
/** The app's notice (the IDE has another status region, its editor's « … opened »). */
const notice = () => document.querySelector<HTMLElement>('.toast-region')!;

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const SESSIONS = [
  fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }),
  fakeSession('bix', { name: 'Bix', cwd: '/w/ledge', state: 'working' }),
  fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working' })
];
/** A daemon that takes `session.broadcast`; `OLD`, one from before it. */
const NEW: DaemonInfo = { version: '0.35.0', install: 'npm', systemd: true, broadcast: true };
const OLD: DaemonInfo = { version: '0.34.0', install: 'npm', systemd: true };
type Broadcast = Extract<ClientMessage, { type: 'session.broadcast' }>;
const broadcasts = (d: MockDaemon) => d.received.filter((m): m is Broadcast => m.type === 'session.broadcast');
/** The front tab of the IDE's editor, when it is a session's (Lot 12b: the IDE has no top bar naming the page). */
const activeTab = () => screen.queryAllByRole('tab').find(t => t.closest('.dv-tabs-container') && t.getAttribute('aria-selected') === 'true' && t.getAttribute('aria-label') !== 'Atelier');
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
    const { d, user } = await boot({ sessions: SESSIONS, projects: PROJECTS, daemon: NEW });
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
    expect(notice()).toHaveTextContent('Delivered to 2 sessions: Otto, Bix');
    expect(notice()).toHaveTextContent('Refused: Zed n’a pas été lancée par Ledge');
  });

  it('the sidebar’s project row has a ✉ beside +, which opens the same dialog', async () => {
    const { side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS, daemon: NEW });
    await user.click(side.getByRole('button', { name: 'Write to Payment Service Platform Migration Europe' }));
    expect(await screen.findByRole('dialog', { name: 'Write to Payment Service Platform Migration Europe' })).toBeVisible();
    expect(side.getByRole('button', { name: 'New session in Ledge' })).toBeVisible();
  });

  it('nothing went: the dialog stays open with the daemon’s reason', async () => {
    const { d, side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS, daemon: NEW });
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
  it('the selection is kept until a send reaches someone, then emptied', async () => {
    const { d, side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS, daemon: NEW });
    let reach = false;
    d.onMessage(m => { if (m.type === 'session.broadcast') d.reply({ type: 'session.broadcast.result', rid: m.rid, sent: reach ? [{ id: 'otto', name: 'Otto' }] : [], refused: [], reason: reach ? undefined : 'personne à qui écrire' }); });
    const rows = tree(side);
    await user.keyboard('{Shift>}');
    await user.click(rows.getByRole('button', { name: /^Otto/ })); await user.click(rows.getByRole('button', { name: /^Bix/ }));
    await user.keyboard('{/Shift}');
    await user.click(within(side.getByRole('region', { name: 'Selected sessions' })).getByRole('button', { name: 'Write to the 2 sessions…' }));
    let dialog = within(await screen.findByRole('dialog', { name: 'Write to Otto, Bix' }));
    await user.type(dialog.getByRole('textbox'), 'Hello');
    await user.click(dialog.getByRole('button', { name: 'Send' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('personne à qui écrire');
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    // Not sent: still picked, the bar still there.
    expect(within(side.getByRole('region', { name: 'Selected sessions' })).getByRole('button', { name: 'Write to the 2 sessions…' })).toBeVisible();
    reach = true;
    await user.click(within(side.getByRole('region', { name: 'Selected sessions' })).getByRole('button', { name: 'Write to the 2 sessions…' }));
    dialog = within(await screen.findByRole('dialog', { name: 'Write to Otto, Bix' }));
    await user.type(dialog.getByRole('textbox'), 'Hello');
    await user.click(dialog.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(side.queryByRole('region', { name: 'Selected sessions' })).toBeNull());
    expect(document.querySelector('.st .picked')).toBeNull();
  });

  it('Escape with a session’s menu open closes the menu and keeps the selection', async () => {
    const { side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS, daemon: NEW });
    const rows = tree(side);
    await user.keyboard('{Shift>}');
    await user.click(rows.getByRole('button', { name: /^Otto/ })); await user.click(rows.getByRole('button', { name: /^Bix/ }));
    await user.keyboard('{/Shift}');
    fireEvent.contextMenu(rows.getByRole('button', { name: /^Otto/ }));
    await screen.findByRole('menu', { name: 'Manage Otto' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(side.getByRole('region', { name: 'Selected sessions' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(side.queryByRole('region', { name: 'Selected sessions' })).toBeNull();
  });

  it('Shift + click picks sessions (Ctrl + click opens to the right in the IDE); from two, the bar writes to them', async () => {
    const { d, side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS, daemon: NEW });
    answering(d);
    const rows = tree(side);
    await user.keyboard('{Shift>}');
    await user.click(rows.getByRole('button', { name: /^Otto/ }));
    expect(side.queryByRole('region', { name: 'Selected sessions' })).toBeNull();
    await user.click(rows.getByRole('button', { name: /^Bix/ }));
    await user.keyboard('{/Shift}');
    // A Shift + click opens nothing.
    expect(activeTab()).toBeUndefined();
    expect(rows.getByRole('button', { name: /^Otto/ }).closest('[role="treeitem"]')).toHaveClass('picked');
    const bar = within(side.getByRole('region', { name: 'Selected sessions' }));
    await user.click(bar.getByRole('button', { name: 'Write to the 2 sessions…' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Write to Otto, Bix' }));
    await user.type(dialog.getByRole('textbox'), 'Rebase on main');
    await user.click(dialog.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(broadcasts(d)).toEqual([{ type: 'session.broadcast', rid: expect.any(String), to: { sessions: ['otto', 'bix'] }, text: 'Rebase on main' }]));
    await waitFor(() => expect(notice()).toHaveTextContent('Delivered to 2 sessions: Otto, Bix'));
  });

  it('a second Shift + click takes a session out; Escape and Cancel empty the selection', async () => {
    const { side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS, daemon: NEW });
    const rows = tree(side);
    const pick = async (name: RegExp) => { await user.keyboard('{Shift>}'); await user.click(rows.getByRole('button', { name })); await user.keyboard('{/Shift}'); };
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
    const { side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS, daemon: NEW });
    await user.click(tree(side).getByRole('button', { name: /^Otto/ }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    expect(side.queryByRole('region', { name: 'Selected sessions' })).toBeNull();
  });
});

describe('a local daemon that does not take a broadcast', () => {
  it('offers no ✉, no room menu item and no selection', async () => {
    const { side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS, daemon: OLD });
    expect(side.queryByRole('button', { name: 'Write to Ledge' })).toBeNull();
    expect(side.getByRole('button', { name: 'New session in Ledge' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Actions of the Ledge room' }));
    expect(screen.queryByRole('menuitem', { name: 'Write to the whole project…' })).toBeNull();
    await user.keyboard('{Escape}');
    const rows = tree(side);
    await user.keyboard('{Shift>}');
    await user.click(rows.getByRole('button', { name: /^Otto/ })); await user.click(rows.getByRole('button', { name: /^Bix/ }));
    await user.keyboard('{/Shift}');
    expect(side.queryByRole('region', { name: 'Selected sessions' })).toBeNull();
  });
});

describe('the dialog', () => {
  it('takes at most MESSAGE_MAX characters', async () => {
    const { side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS, daemon: NEW });
    await user.click(side.getByRole('button', { name: 'Write to Ledge' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Write to Ledge' }));
    expect(dialog.getByRole('textbox')).toHaveAttribute('maxlength', String(MESSAGE_MAX));
  });

  it('an answer after it was closed does not close the dialog opened since', async () => {
    const { d, side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS, daemon: NEW });
    const asked: Broadcast[] = [];
    d.onMessage(m => { if (m.type === 'session.broadcast') asked.push(m); });
    await user.click(side.getByRole('button', { name: 'Write to Ledge' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Write to Ledge' }));
    await user.type(dialog.getByRole('textbox'), 'Hello');
    await user.click(dialog.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(asked).toHaveLength(1));
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    await user.click(side.getByRole('button', { name: 'Write to Payment Service Platform Migration Europe' }));
    await screen.findByRole('dialog', { name: 'Write to Payment Service Platform Migration Europe' });
    d.reply({ type: 'session.broadcast.result', rid: asked[0]!.rid, sent: [{ id: 'otto', name: 'Otto' }], refused: [] });
    await new Promise(r => setTimeout(r, 100));
    expect(screen.getByRole('dialog', { name: 'Write to Payment Service Platform Migration Europe' })).toBeVisible();
  });

  it('a resend after one machine was silent keeps the rid', async () => {
    const { d, side, user } = await boot({ sessions: SESSIONS, projects: PROJECTS, daemon: NEW });
    const asked: Broadcast[] = [];
    d.onMessage(m => { if (m.type === 'session.broadcast') { asked.push(m); d.reply({ type: 'session.broadcast.result', rid: m.rid, sent: [], refused: [{ name: 'Dev SSH', reason: 'Dev SSH : pas de réponse' }], reason: 'personne à qui écrire' }); } });
    await user.click(side.getByRole('button', { name: 'Write to Ledge' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Write to Ledge' }));
    await user.type(dialog.getByRole('textbox'), 'Hello');
    await user.click(dialog.getByRole('button', { name: 'Send' }));
    await dialog.findByRole('alert');
    await user.click(dialog.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]!.rid).toBe(asked[0]!.rid);
  });
});
