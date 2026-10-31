import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { activeCount } from '../src/nav/agents';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, listSessions, TWO_PROJECTS } from './helpers';
import { MESSAGES } from '../src/i18n/messages';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const banner = () => within(screen.getByRole('banner'));

describe('the sidebar shell', () => {
  it('has Ledge’s line and Atelier, and neither question field, New session button, brand nor search', async () => {
    const sessions = listSessions();
    const { side } = await boot({ projects: TWO_PROJECTS, sessions });
    expect(side.queryByRole('button', { name: /^New session N/ })).toBeNull();
    expect(document.querySelector('.st-brand')).toBeNull();
    // OpenRig spec §8.1: the « Ask Ledge… » field left the sidebar; Ledge's line (mockup 1a) opens its screen.
    expect(side.getByRole('button', { name: /^Home: Ledge, the operator · Ledge\./ })).toBeVisible();
    expect(side.queryByRole('textbox', { name: 'Ask Ledge' })).toBeNull();
    expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent(String(activeCount(sessions)));
    expect(document.querySelector('.sidebar [data-brand]')).toBeNull();
    expect(side.queryByRole('button', { name: /Search/ })).toBeNull();
  });

  it('Ledge’s line (OpenRig spec §8.1): its live preview, and a click goes to the home view, lit, with its composer focused', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    const entry = side.getByRole('button', { name: /^Home: Ledge, the operator · Ledge\./ });
    expect(entry).toHaveTextContent('Nothing is waiting for you');
    await user.click(entry);
    const home = await screen.findByRole('region', { name: 'Home: Ledge, the operator' });
    await waitFor(() => expect(within(home).getByRole('textbox', { name: 'Ask Ledge' })).toHaveFocus());
    expect(entry).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
  });

  it('Your turn lists open asks after the waiting sessions, and the Ledge line counts the decisions waiting for the user', async () => {
    const at = new Date().toISOString();
    const near = fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'idle', context: { used: 170_000, window: 200_000, at } });
    const { d, side, user } = await boot({ projects: TWO_PROJECTS, sessions: [...listSessions(), near] });
    const entry = side.getByRole('button', { name: /^Home: Ledge, the operator · Ledge\./ });
    d.push({ type: 'asks', asks: [{ id: 'a1b2c34', from: 'nova', fromName: 'Nova', question: 'Which database?', options: 'A or B (I recommend B)', at, state: 'open' }] });
    const yours = within(side.getByRole('region', { name: 'Your turn' }));
    await yours.findByText('Which database?');
    // What Ledge raised (an OpenRig escalation) is counted on its line, with the rig it comes from.
    d.push({ type: 'rig.snapshot', machine: 'local', rigs: [{ id: 'r1', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: null, offProject: false, lifecycle: 'running', kernel: false, seats: [], repos: [] }] });
    d.push({ type: 'escalation.updated', escalation: { id: 'q1', source: 'rig', machine: 'local', rigId: 'r1', from: 'orch-lead@factory', intent: 'decision', summary: 'JSON or SQLite?', questions: [], createdAt: at, state: 'pending' } });
    await waitFor(() => expect(entry).toHaveTextContent('A decision is waiting for you · factory'));
    expect(entry).toHaveAccessibleName(/1 unread$/);
    const cards = [...document.querySelectorAll('.st-attn .st-card')];
    expect(cards.map(c => (c.matches('[data-ask]') ? 'ask' : c.matches('[data-near]') ? 'near' : c.matches('[data-escalation]') ? 'escalation' : 'session'))).toEqual(['session', 'session', 'escalation', 'ask', 'near']);
    const card = document.querySelector<HTMLElement>('[data-ask="a1b2c34"]')!;
    expect(within(card).getByText('Decision')).toBeVisible();
    expect(within(card).getByText('from Nova')).toBeVisible();
    expect(within(card).getByText('A or B (I recommend B)')).toBeVisible();
    await user.type(within(card).getByPlaceholderText('Your answer…'), ' B ');
    await user.click(within(card).getByRole('button', { name: 'Answer' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'ask.answer', rid: expect.any(String), id: 'a1b2c34', text: 'B' }));
  });

  it('the tree draws no team row; every session of a project sits under it by branch', async () => {
    const seat = (id: string, name: string, branch: string) => fakeSession(id, { name, cwd: '/w/ledge', state: 'working', branch, ...{ team: 'team-a1b2', role: 'build' } });
    const { d, side } = await boot({ projects: TWO_PROJECTS, sessions: [seat('otto', 'Otto', 'desktop'), seat('nova', 'Nova', 'main')] });
    // An older daemon still speaks of teams: the front ignores them.
    d.push({ type: 'teams', teams: [{ id: 'team-a1b2', name: 'ledge-dev', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', seats: [{ role: 'build', sessionId: 'otto' }], createdAt: '2026-10-26T08:00:00.000Z', updatedAt: '2026-10-26T08:00:00.000Z' }] } as never);
    const tree = within(side.getByRole('tree'));
    expect(await tree.findByRole('button', { name: /^Otto/ })).toBeVisible();
    expect(tree.getByRole('button', { name: /^Nova/ })).toBeVisible();
    expect(document.querySelector('.st-team, .st-common')).toBeNull();
    expect(tree.queryByText('ledge-dev')).toBeNull();
    expect(tree.getByText('desktop')).toBeVisible();
    expect(tree.getByText('main')).toBeVisible();
  });

  it('no question field in the sidebar any more: / goes home, its composer focused, and Enter there sends ledge.say', async () => {
    // One machine: with two, the fleet sends chat.route instead of chat.ask (chat.test boots the same way).
    const { d, user, side } = await boot({ projects: TWO_PROJECTS, sessions: listSessions(), machines: [{ id: 'local', label: 'Local' }] });
    expect(side.queryByRole('textbox')).toBeNull();
    await user.keyboard('/');
    const home = await screen.findByRole('region', { name: 'Home: Ledge, the operator' });
    const field = within(home).getByRole('textbox', { name: 'Ask Ledge' });
    await waitFor(() => expect(field).toHaveFocus());
    await user.keyboard('hello{Enter}');
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
    await waitFor(() => expect(d.received).toContainEqual({ type: 'ledge.say', rid: expect.any(String), text: 'hello' }));
    expect(d.received.some(m => m.type === 'chat.ask')).toBe(false);
  });

  it('a ? beside Settings lists the shortcuts in its tooltip and opens their dialog', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    const help = side.getByRole('button', { name: 'Keyboard shortcuts', exact: true });
    expect(help.closest('.st-foot')).toBe(side.getByRole('button', { name: 'Settings' }).closest('.st-foot'));
    // The tooltip describes the button, for a mouse and for the keyboard alike: it is in the DOM, CSS shows it on hover and focus.
    const tip = document.getElementById(help.getAttribute('aria-describedby')!)!;
    expect(tip).toHaveAttribute('role', 'tooltip');
    expect(within(tip).getByText('Search and open a session')).toBeInTheDocument();
    expect(within(tip).getByText('Ctrl / ⌘ K')).toBeInTheDocument();
    expect(within(tip).getByText('Show these shortcuts')).toBeInTheDocument();
    await user.click(help);
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  });

  it('the shortcuts tooltip shows on hover and on keyboard focus', () => {
    const css = readFileSync(resolve(__dirname, '../src/styles/sidebar.css'), 'utf8');
    expect(css).toMatch(/\.st-keys:hover \.st-keys-tip/);
    expect(css).toMatch(/\.st-keys:focus-within \.st-keys-tip/);
  });

  it('no shortcut reminder at the foot of the sidebar, in the overview or in a session: the ? holds them (#51)', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    const reminder = () => {
      expect(document.querySelector('.st-hint')).toBeNull();
      for (const text of ['new session', 'move', 'fold', 'Ctrl ⇧ E']) expect(side.queryByText(text, { ignore: '.st-keys-tip *' })).toBeNull();
    };
    reminder();
    await user.click(side.getByRole('button', { name: /^Nova/ }));
    expect(banner().getByText('Nova')).toBeVisible();
    reminder();
    expect(readFileSync(resolve(__dirname, '../src/styles/sidebar.css'), 'utf8')).not.toMatch(/st-hint/);
  });

  it('the sidebar keys join the shortcuts list: in the ? tooltip and in its dialog, in English and in French (#51)', async () => {
    const sidebarRows = { en: [['← / →', 'Fold / unfold a project (sidebar)'], ['E', 'Archive the selected session'], ['H', 'Show / hide the finished sessions'], ['Ctrl ⇧ E', 'Focus the sidebar']], fr: [['← / →', 'Plier / déplier un projet (barre latérale)'], ['E', 'Archiver la session sélectionnée'], ['H', 'Afficher / masquer les sessions terminées'], ['Ctrl ⇧ E', 'Aller à la barre latérale']] } as const;
    for (const lang of ['en', 'fr'] as const) for (const row of sidebarRows[lang]) expect(MESSAGES[lang].shortcuts.rows).toContainEqual(row);
    const { side, user } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    const help = side.getByRole('button', { name: 'Keyboard shortcuts', exact: true });
    const tip = document.getElementById(help.getAttribute('aria-describedby')!)!;
    await user.click(help);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    // The tooltip's row holds its keys; the dialog's keys sit beside the action.
    for (const [keys, action] of sidebarRows.en) {
      expect(within(tip).getByText(action).querySelector('kbd')).toHaveTextContent(keys);
      expect(within(dialog).getByText(action).parentElement!.querySelector('kbd')).toHaveTextContent(keys);
    }
  });

  it('the machine chips open Settings › Machines; the gear opens Settings', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    await user.click(side.getByRole('button', { name: /Local/ }));
    expect(banner().getByText('Machines')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Machines' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(side.getByRole('button', { name: /^Settings/ }));
    expect(banner().getByText('General')).toBeVisible();
  });
});
