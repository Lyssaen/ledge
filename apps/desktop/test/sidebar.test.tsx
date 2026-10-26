import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { activeCount } from '../src/nav/agents';
import { boot, closeDaemons, listSessions, TWO_PROJECTS } from './helpers';
import { MESSAGES } from '../src/i18n/messages';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const banner = () => within(screen.getByRole('banner'));

describe('the sidebar shell', () => {
  it('has Ask Ledge and Atelier, and neither New session button, brand nor search', async () => {
    const sessions = listSessions();
    const { side } = await boot({ projects: TWO_PROJECTS, sessions });
    expect(side.queryByRole('button', { name: /^New session N/ })).toBeNull();
    expect(document.querySelector('.st-brand')).toBeNull();
    expect(side.getByRole('textbox', { name: 'Ask Ledge' })).toBeVisible();
    expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent(String(activeCount(sessions)));
    expect(document.querySelector('.sidebar [data-brand]')).toBeNull();
    expect(side.queryByRole('button', { name: /Search/ })).toBeNull();
  });

  it('Ledge’s entry (ledge home spec §2.1): its live line, and a click goes to the home view, lit, with its composer focused', async () => {
    const { side, user, d } = await boot({ projects: TWO_PROJECTS, sessions: listSessions() });
    const entry = side.getByRole('button', { name: 'Home: Ledge, the operator' });
    expect(entry).toHaveTextContent(/\d+ yours · 0 active teams/);
    await user.click(entry);
    const home = await screen.findByRole('region', { name: 'Home: Ledge, the operator' });
    await waitFor(() => expect(within(home).getByRole('textbox', { name: 'Ask Ledge' })).toHaveFocus());
    expect(entry).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
    // A team at work shows in the line.
    d.push({ type: 'teams', teams: [{ id: 'team-a1b2', name: 'ledge-roles', project: null, machine: 'local', cwd: '/w/ledge', state: 'active', seats: [], createdAt: '2026-10-26T08:00:00.000Z', updatedAt: '2026-10-26T08:00:00.000Z' }] });
    await waitFor(() => expect(entry).toHaveTextContent('· 1 active team'));
  });

  it('the question field under the entry: Enter with text goes home and sends chat.ask', async () => {
    // One machine: with two, the fleet sends chat.route instead of chat.ask (chat.test boots the same way).
    const { d, user, side } = await boot({ projects: TWO_PROJECTS, sessions: listSessions(), machines: [{ id: 'local', label: 'Local' }] });
    await user.type(side.getByRole('textbox', { name: 'Ask Ledge' }), 'hello{Enter}');
    expect(await screen.findByRole('region', { name: 'Home: Ledge, the operator' })).toBeVisible();
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
    expect(d.received).toContainEqual({ type: 'chat.ask', qid: expect.stringMatching(/^q-/), text: 'hello', tool: 'claude' });
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
